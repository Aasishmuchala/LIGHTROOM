// EXPERIMENTAL edge-softness evidence (2026-07-05) — regression pins for the
// gradient-based shadow-softness proxy:
//   - MetricVector.grad = { p50, p90 } percentiles of the mid-tone luminance
//     gradient magnitude |dL| (central differences, clamped-scaled 0..1). Attached
//     only when >= GRAD_MIN_PIXELS pixels qualify; band is [GRAD_MID_LO, GRAD_MID_HI]
//     so highlights/blacks never vote.
//   - sceneEvidence().edge_softness = each image's grad.p90 (per-side null when the
//     vector lacks .grad — old persisted sessions, tiny thumbs, no mid tones).
//   - the legend names it EXPERIMENTAL + direction-only so the model never derives
//     magnitudes from it.
// The physical claim under test: a hard/small light source draws crisp shadow
// boundaries (large mid-tone |dL|); a big/soft source smears them.

import { describe, it, expect } from "vitest";
import {
  measureFromPixels,
  sceneEvidence,
  GRAD_MID_LO,
  GRAD_MID_HI,
  GRAD_MIN_PIXELS,
} from "../metrics";
import { buildUserContent } from "../client-adapter";
import type { MetricVector } from "../types";

// -- synthetic RGBA builder (same pattern as field-fixes.test.ts, but with explicit
//    dimensions — the qualifying-pixel-count tests need to control interior size). --
const buf = (
  w: number,
  h: number,
  px: (x: number, y: number) => [number, number, number, number]
) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y);
      const p = (y * w + x) * 4;
      d[p] = r;
      d[p + 1] = g;
      d[p + 2] = b;
      d[p + 3] = a;
    }
  return d;
};
const measure = (
  w: number,
  h: number,
  px: (x: number, y: number) => [number, number, number, number]
) => measureFromPixels(buf(w, h, px), w, h);

// Canonical fixtures. Both tones sit INSIDE the mid-tone band (sRGB 100 -> linear
// lum ~0.127, sRGB 210 -> ~0.645) so the edge columns themselves qualify:
//   hard  = a single vertical hard step at x = 9 in an 18x18 frame — the two
//           edge-adjacent columns are 2/16 = 12.5% of the qualifying interior,
//           enough for p90 to land ON the edge bin (~0.52 scaled).
//   smooth = the same tonal range spread across a 66-wide ramp — every pixel
//           carries a tiny ~0.01 |dL| step, nothing crisp anywhere.
const hard = measure(18, 18, (x) => (x < 9 ? [100, 100, 100, 255] : [210, 210, 210, 255]));
const smooth = measure(66, 18, (x) => {
  const v = Math.round(100 + (x / 65) * 110);
  return [v, v, v, 255];
});

describe("measureFromPixels — grad (mid-tone gradient distribution)", () => {
  it("a hard-edged midtone step reads a p90 CLEARLY above a smooth wide gradient", () => {
    expect(hard.grad).toBeDefined();
    expect(smooth.grad).toBeDefined();
    // The hard edge's step is ~0.26 |dL| -> ~0.52 scaled; the ramp's is ~0.02.
    expect(hard.grad!.p90).toBeGreaterThan(0.3);
    expect(smooth.grad!.p90).toBeLessThan(0.1);
    expect(hard.grad!.p90).toBeGreaterThan(smooth.grad!.p90 * 3);
    // Both medians are dominated by flat/near-flat pixels — the p90 is the signal.
    expect(hard.grad!.p50).toBeLessThan(0.05);
  });

  it("a flat image reads ~0 (grad present, both percentiles at the zero bin)", () => {
    // sRGB 128 -> linear lum ~0.216, inside the band, so every interior pixel
    // qualifies (900 >= GRAD_MIN_PIXELS) — and every gradient is exactly zero.
    const flat = measure(32, 32, () => [128, 128, 128, 255]);
    expect(flat.grad).toBeDefined();
    expect(flat.grad!.p50).toBeLessThan(0.005); // zero-bin center, not literal 0
    expect(flat.grad!.p90).toBeLessThan(0.005);
  });

  it("images with no mid tones omit grad entirely (band excludes blacks + highlights)", () => {
    const black = measure(32, 32, () => [0, 0, 0, 255]); // lum 0 < GRAD_MID_LO
    const white = measure(32, 32, () => [255, 255, 255, 255]); // lum 1 > GRAD_MID_HI
    expect(black.grad).toBeUndefined();
    expect(white.grad).toBeUndefined();
    // ...and the band constants really are the documented shadow-boundary band.
    expect(GRAD_MID_LO).toBe(0.08);
    expect(GRAD_MID_HI).toBe(0.7);
  });

  it("too few qualifying pixels omit grad (interior below GRAD_MIN_PIXELS)", () => {
    // 8x8 flat mid gray: interior is 6x6 = 36 qualifying pixels < 100 -> absent.
    const tiny = measure(8, 8, () => [128, 128, 128, 255]);
    expect(tiny.grad).toBeUndefined();
    expect(36).toBeLessThan(GRAD_MIN_PIXELS);
    // Degenerate frames with NO interior at all must not throw either.
    expect(() => measure(1, 1, () => [128, 128, 128, 255])).not.toThrow();
    expect(measure(2, 2, () => [128, 128, 128, 255]).grad).toBeUndefined();
  });

  it("transparent neighbors do not fabricate a hard edge along the alpha boundary", () => {
    // A cut-out beauty PNG: a flat opaque midtone strip (x < 8) against transparent
    // pixels whose raw RGB is BRIGHT (255). Without the 4-neighborhood opacity
    // guard, column x=7 would read a phantom ~0.39 |dL| step against the cut-out's
    // RGB — 1/7 of the qualifying pixels, enough to poison p90. With the guard the
    // boundary column is skipped and the measured field stays flat.
    const cutout = measure(32, 32, (x) =>
      x < 8 ? [128, 128, 128, 255] : [255, 255, 255, 0]
    );
    expect(cutout.grad).toBeDefined(); // 6 interior columns x 30 rows = 180 >= 100
    expect(cutout.grad!.p90).toBeLessThan(0.005);
  });

  it("is deterministic: the same noisy buffer measures byte-identical (grad included)", () => {
    // Seeded LCG noise confined to the mid-tone band so grad attaches.
    let seed = 1234;
    const rand = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const noisy = buf(64, 64, () => {
      const v = Math.floor(100 + rand() * 110);
      return [v, v, v, 255];
    });
    const a = measureFromPixels(noisy, 64, 64);
    const b = measureFromPixels(noisy, 64, 64);
    expect(a.grad).toBeDefined();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.grad).toEqual(b.grad);
  });
});

describe("sceneEvidence — edge_softness (EXPERIMENTAL shadow-softness proxy)", () => {
  it("carries each image's grad.p90 per side: hard reference reads above soft current", () => {
    const ev = sceneEvidence(hard, smooth);
    expect(ev.edge_softness.reference).not.toBeNull();
    expect(ev.edge_softness.current).not.toBeNull();
    expect(ev.edge_softness.reference!).toBeGreaterThan(ev.edge_softness.current!);
    // The evidence value IS the vector's p90 (rounded to 1e-4 like the anchors).
    expect(ev.edge_softness.reference!).toBeCloseTo(hard.grad!.p90, 4);
  });

  it("an OLD persisted MetricVector without .grad yields edge_softness nulls, no throw", () => {
    // Hand-built old-shape vector — exactly what a pre-2026-07-05 session restores
    // (same fixture pattern as the sky_estimate old-shape pin in field-fixes).
    const oldVector: MetricVector = {
      lum: { p1: 0.01, p5: 0.02, p25: 0.1, p50: 0.3, p75: 0.5, p95: 0.7, p99: 0.8, mean: 0.32 },
      clip: { hi: 0, lo: 0 },
      contrast: { spread: 0.68, midSlope: 0.8 },
      wb: {
        shadow: { r: 0.05, g: 0.05, b: 0.06 },
        highlight: { r: 0.6, g: 0.6, b: 0.62 },
        warmthShadow: -0.09,
        warmthHighlight: -0.016,
        tint: 0,
      },
      sat: { mean: 0.1, p95: 0.2 },
      grid: new Array(16).fill(0.3),
    };
    let ev!: ReturnType<typeof sceneEvidence>;
    expect(() => { ev = sceneEvidence(oldVector, oldVector); }).not.toThrow();
    expect(ev.edge_softness.reference).toBeNull();
    expect(ev.edge_softness.current).toBeNull();
    // ...and the rest of the evidence still computes off the old shape.
    expect(ev.light_centroid.reference).not.toBeNull();
    expect(ev.anchors.reference.p50).toBeCloseTo(0.3, 4);
    // Sides are independent: a new vector on one side reads through unharmed.
    const mixed = sceneEvidence(oldVector, hard);
    expect(mixed.edge_softness.reference).toBeNull();
    expect(mixed.edge_softness.current).not.toBeNull();
  });
});

describe("the evidence legend flags edge_softness as EXPERIMENTAL + direction-only", () => {
  it("names the field, the direction reading, and the do-not-quantify guard", () => {
    const content = buildUserContent({
      mode: "recipe",
      images: [],
      metricsBundle: { diff: {} },
    });
    const text = content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    expect(text).toContain("edge_softness");
    expect(text).toContain("EXPERIMENTAL");
    // higher = crisper = harder/smaller source; lower = softer = bigger source.
    expect(text).toMatch(/higher = crisper/);
    expect(text).toMatch(/harder\/smaller light/);
    expect(text).toMatch(/sun size mult|larger area lights/);
    expect(text).toMatch(/DIRECTION only/);
    expect(text).toMatch(/do not\s+compute magnitudes/);
  });
});
