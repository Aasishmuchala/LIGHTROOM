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
  HIST_BINS,
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
    expect(SCORE_WEIGHTS["clip.hi"]).toBe(1.5);
    expect(SCORE_WEIGHTS["sat.mean"]).toBe(1);
    // 3 lum + 2 contrast + 3 wb + 2 clip + 1 sat + 16 grid = 27 keys
    expect(Object.keys(SCORE_WEIGHTS)).toHaveLength(27);
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
