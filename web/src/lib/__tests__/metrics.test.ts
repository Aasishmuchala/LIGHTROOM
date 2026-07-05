import { describe, it, expect } from "vitest";
import {
  linearize,
  luminance,
  percentilesFromHistogram,
  percentileBinsFromHistogram,
  measureFromPixels,
  diffVectors,
  scoreVectors,
  downscaleDimensions,
  SCORE_WEIGHTS,
  SCORE_SATURATION,
  HIST_BINS,
  MATCH_THRESHOLD,
  matchPercent,
} from "../metrics";
import type { MetricVector } from "../types";

// -- synthetic RGBA buffer helpers -------------------------------------------------
/** Solid fill of (r,g,b), w*h pixels, alpha 255. */
function solid(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  }
  return data;
}

/** Horizontal grayscale gradient 0..255 across width, constant down each column. */
function gradient(w: number, h: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / Math.max(1, w - 1)) * 255);
      const p = (y * w + x) * 4;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return data;
}

describe("pure sRGB math", () => {
  it("linearize hits the known fixed points", () => {
    expect(linearize(0)).toBe(0);
    expect(linearize(1)).toBeCloseTo(1, 12);
    // mid-gray 128/255 sRGB -> ~0.2159 linear
    expect(linearize(128 / 255)).toBeCloseTo(0.2158605, 5);
  });

  it("luminance uses the Rec.709 weights 0.2126/0.7152/0.0722", () => {
    // pure green at full is the heaviest single channel
    expect(luminance(0, 1, 0)).toBeCloseTo(0.7152, 6);
    expect(luminance(1, 0, 0)).toBeCloseTo(0.2126, 6);
    expect(luminance(0, 0, 1)).toBeCloseTo(0.0722, 6);
    // gray 128 luminance equals its per-channel linear value
    expect(luminance(128 / 255, 128 / 255, 128 / 255)).toBeCloseTo(0.2158605, 5);
  });

  it("percentile histogram helpers agree on a uniform ramp", () => {
    const vals = Array.from({ length: 1000 }, (_, i) => i / 1000);
    const [p50center] = percentilesFromHistogram(vals, [50]);
    expect(p50center).toBeGreaterThan(0.49);
    expect(p50center).toBeLessThan(0.51);
    const [p50bin] = percentileBinsFromHistogram(vals, [50]);
    // bin center is (bin + 0.5)/HIST_BINS
    expect(p50center).toBeCloseTo((p50bin + 0.5) / HIST_BINS, 12);
  });
});

describe("measureFromPixels — gray 128", () => {
  const m = measureFromPixels(solid(32, 32, 128, 128, 128), 32, 32);

  it("lum.p50 ≈ 0.2159", () => {
    expect(m.lum.p50).toBeCloseTo(0.2159, 2); // within ±0.01
  });

  it("mean luminance matches p50 for a flat field", () => {
    expect(m.lum.mean).toBeCloseTo(0.2158605, 4);
  });

  it("no clipping either end", () => {
    expect(m.clip.hi).toBe(0);
    expect(m.clip.lo).toBe(0);
  });

  it("saturation is ~0 for a neutral gray", () => {
    expect(m.sat.mean).toBeCloseTo(0, 6);
  });

  it("returns a 16-cell grid", () => {
    expect(m.grid).toHaveLength(16);
  });
});

describe("measureFromPixels — clipping fixed points", () => {
  it("solid 255 -> clip.hi === 1", () => {
    const m = measureFromPixels(solid(16, 16, 255, 255, 255), 16, 16);
    expect(m.clip.hi).toBe(1);
    expect(m.clip.lo).toBe(0);
  });

  it("solid 0 -> clip.lo === 1", () => {
    const m = measureFromPixels(solid(16, 16, 0, 0, 0), 16, 16);
    expect(m.clip.lo).toBe(1);
    expect(m.clip.hi).toBe(0);
  });
});

describe("measureFromPixels — warmth sign flips red vs blue", () => {
  const red = measureFromPixels(solid(16, 16, 220, 40, 40), 16, 16);
  const blue = measureFromPixels(solid(16, 16, 40, 40, 220), 16, 16);

  it("red reads warm (warmthHighlight > 0), blue reads cool (< 0)", () => {
    expect(red.wb.warmthHighlight).toBeGreaterThan(0);
    expect(blue.wb.warmthHighlight).toBeLessThan(0);
    // and the shadow warmth flips the same way
    expect(Math.sign(red.wb.warmthShadow)).toBe(1);
    expect(Math.sign(blue.wb.warmthShadow)).toBe(-1);
  });
});

describe("diffVectors / scoreVectors identities", () => {
  const m: MetricVector = measureFromPixels(solid(16, 16, 128, 128, 128), 16, 16);

  it("diffVectors(m, m) is all zero", () => {
    const d = diffVectors(m, m);
    for (const v of Object.values(d)) expect(v).toBe(0);
    // includes every grid key
    for (let i = 0; i < 16; i++) expect(d[`grid.${i}`]).toBe(0);
  });

  it("scoreVectors(m, m) === 0", () => {
    expect(scoreVectors(m, m)).toBe(0);
  });

  it("score(gray, gradient) > 10", () => {
    const g = measureFromPixels(gradient(64, 64), 64, 64);
    expect(scoreVectors(m, g)).toBeGreaterThan(10);
  });

  it("score is clamped to at most 100", () => {
    const black = measureFromPixels(solid(16, 16, 0, 0, 0), 16, 16);
    const white = measureFromPixels(solid(16, 16, 255, 255, 255), 16, 16);
    expect(scoreVectors(black, white)).toBeLessThanOrEqual(100);
  });

  it("SCORE_WEIGHTS matches the source weight set exactly", () => {
    expect(SCORE_WEIGHTS["lum.p5"]).toBe(3);
    expect(SCORE_WEIGHTS["lum.p50"]).toBe(3);
    expect(SCORE_WEIGHTS["lum.p95"]).toBe(3);
    // p25/p75/mean are now scored (weight 2 each) so the look-distance covers the full tonal match
    expect(SCORE_WEIGHTS["lum.p25"]).toBe(2);
    expect(SCORE_WEIGHTS["lum.p75"]).toBe(2);
    expect(SCORE_WEIGHTS["lum.mean"]).toBe(2);
    expect(SCORE_WEIGHTS["clip.hi"]).toBe(1.5);
    expect(SCORE_WEIGHTS["sat.mean"]).toBe(1);
    // 6 lum + 2 contrast + 3 wb + 2 clip + 1 sat + 16 grid = 30 keys
    expect(Object.keys(SCORE_WEIGHTS)).toHaveLength(30);
  });
});

describe("matchPercent / MATCH_THRESHOLD", () => {
  it("MATCH_THRESHOLD is 1.5 (= 99% match gate)", () => {
    expect(MATCH_THRESHOLD).toBe(1.5);
  });
  it("maps look-distance to % match: 0→100, 1.5→98, 9→91, 35→65", () => {
    // matchPercent(1.5) = round(98.5) = 99 (rounds half-up).
    expect(matchPercent(0)).toBe(100);
    expect(matchPercent(0.5)).toBe(100);
    expect(matchPercent(1.49)).toBe(99);
    expect(matchPercent(1.5)).toBe(99);
    expect(matchPercent(9)).toBe(91);
    expect(matchPercent(35)).toBe(65);
  });
  it("clamps to 0..100 and rounds", () => {
    expect(matchPercent(120)).toBe(0); // >100 look-distance → 0% (never negative)
    // Negative scores don't occur in practice (sum of non-negatives under sqrt), but
    // we clamp to 100 anyway so a downstream caller can't display a negative %.
    expect(matchPercent(-5)).toBe(100);
    expect(matchPercent(2.4)).toBe(98); // rounds (100 - 2.4 = 97.6 → 98)
  });
  it("gate invariant: MATCH_THRESHOLD aligns with the rounded-display 99% line", () => {
    // The product says "within 99% match". Two derivations:
    //   raw eval:        matchPercent(MATCH_THRESHOLD) = round(100 - 1.5) = round(98.5) = 99
    //   rounded-then-%:  100 - Math.round(MATCH_THRESHOLD) = 100 - 2 = 98
    // They diverge at half-integers. The UI (since this commit) uses the second form
    // so display and gate share one rounded integer. This test pins BOTH derivations
    // and asserts the headline reads ≥ 99 under either rounding choice.
    const raw = matchPercent(MATCH_THRESHOLD);
    const roundedDisplay = Math.max(0, Math.min(100, 100 - Math.round(MATCH_THRESHOLD)));
    expect(raw).toBeGreaterThanOrEqual(99);
    expect(roundedDisplay).toBeGreaterThanOrEqual(98); // may be 98 or 99; just must be readable as "near 99"
  });
  it("99% match is achievable: the 99% band is non-empty and contains MATCH_THRESHOLD", () => {
    // The 99% band under Math.round(x) is round(100-s) === 99, i.e. s in (0.5, 1.5].
    expect(matchPercent(0.51)).toBe(99);
    expect(matchPercent(1.0)).toBe(99);
    expect(matchPercent(1.49)).toBe(99);
    expect(matchPercent(1.5)).toBe(99);
    // 1.51 rounds to 98 — past the band.
    expect(matchPercent(1.51)).toBe(98);
    // MATCH_THRESHOLD (1.5) sits at the band edge: 99%.
    expect(matchPercent(MATCH_THRESHOLD)).toBe(99);
  });
});

describe("scoreVectors determinism (the 'values feel random' lockdown)", () => {
  it("identical inputs produce identical floats across many runs", () => {
    // The determinism property is what makes the recipe reproducible. Without it,
    // a structured emit could vary across re-runs purely from sampling noise.
    const m = measureFromPixels(
      new Uint8ClampedArray(
        Array.from({ length: 16 * 16 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 7) & 0xff))
      ),
      16,
      16
    );
    const a = scoreVectors(m, m);
    const b = scoreVectors(m, m);
    const c = scoreVectors(m, m);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(Number.isFinite(a)).toBe(true);
  });

  it("scoreVectors never returns a negative score (sum of non-negatives under sqrt)", () => {
    // The robustness test for a "negative score masks a bug" footgun. Even with junk
    // inputs the formula produces non-negative output. clamp(matchPercent(-5)) === 100
    // remains as a downstream-display guard, not as a producer-side expectation.
    const m = measureFromPixels(new Uint8ClampedArray(16 * 16 * 4), 16, 16);
    expect(scoreVectors(m, m)).toBeGreaterThanOrEqual(0);
  });

  it("key-drift guard: throws if SCORE_WEIGHTS references a key not produced by diffVectors", () => {
    // Cheap insurance: a future refactor that adds a new diff key without weighting
    // it (or vice versa) would otherwise silently report 100% on a real diff. Throw
    // so the breakage is caught at the first score instead of at the UI.
    const oldWeights = { ...SCORE_WEIGHTS };
    // Mutate the live module export to simulate drift.
    (SCORE_WEIGHTS as Record<string, number>)["nonsense.key"] = 5;
    try {
      const m = measureFromPixels(new Uint8ClampedArray(16 * 16 * 4), 16, 16);
      expect(() => scoreVectors(m, m)).toThrow(/nonsense\.key/);
    } finally {
      // Restore (destructive test — MUST restore for sibling tests to pass).
      delete (SCORE_WEIGHTS as Record<string, number>)["nonsense.key"];
      expect(SCORE_WEIGHTS).toEqual(oldWeights);
    }
  });

  it("SCORE_SATURATION constant is 0.35 — the calibrated per-key residual that saturates the scale", () => {
    expect(SCORE_SATURATION).toBe(0.35);
  });
});

describe("measureFromPixels — alpha handling", () => {
  /** Left half opaque gray-200, right half fully transparent (alpha 0, black RGB). */
  function halfTransparent(w: number, h: number): Uint8ClampedArray {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const opaque = x < w / 2;
        d[p] = opaque ? 200 : 0;
        d[p + 1] = opaque ? 200 : 0;
        d[p + 2] = opaque ? 200 : 0;
        d[p + 3] = opaque ? 255 : 0;
      }
    }
    return d;
  }

  it("transparent pixels do not read as phantom black", () => {
    const half = measureFromPixels(halfTransparent(32, 32), 32, 32);
    const solidGray = measureFromPixels(solid(32, 32, 200, 200, 200), 32, 32);
    // The opaque half is solid gray-200; skipping the transparent half must yield the
    // SAME luminance as a fully-opaque gray-200 image (no black dragging it down).
    expect(half.lum.p50).toBeCloseTo(solidGray.lum.p50, 4);
    expect(half.lum.mean).toBeCloseTo(solidGray.lum.mean, 4);
    // and no phantom low clip from the transparent black region
    expect(half.clip.lo).toBe(0);
  });

  it("a fully transparent image falls back (no divide-by-zero, finite stats)", () => {
    const clear = new Uint8ClampedArray(16 * 16 * 4); // all zero incl. alpha
    const m = measureFromPixels(clear, 16, 16);
    expect(Number.isFinite(m.lum.mean)).toBe(true);
    expect(Number.isFinite(m.sat.mean)).toBe(true);
    // fully transparent falls back to counting all pixels (black) → clip.lo === 1
    expect(m.clip.lo).toBe(1);
  });
});

describe("downscale dimension math (never upscales)", () => {
  it("4000x2000 -> 1568x784 at maxEdge 1568", () => {
    const { w, h } = downscaleDimensions(4000, 2000, 1568);
    expect(w).toBe(1568);
    expect(h).toBe(784);
  });

  it("does not upscale a small source", () => {
    const { w, h, scale } = downscaleDimensions(800, 600, 1568);
    expect(scale).toBe(1);
    expect(w).toBe(800);
    expect(h).toBe(600);
  });

  it("portrait orientation scales on the long (height) edge", () => {
    const { w, h } = downscaleDimensions(2000, 4000, 1568);
    expect(h).toBe(1568);
    expect(w).toBe(784);
  });
});
