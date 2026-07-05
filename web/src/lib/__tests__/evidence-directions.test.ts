// Evidence-DIRECTION lock (2026-07-05). A single wrong sign in the measured evidence
// sends the refine loop the wrong way — we already shipped and caught one CRITICAL
// inversion (the SPATIAL ASYMMETRY prose). This suite pins that EVERY directional
// signal the legend/prompt claims matches what the code actually computes, so no
// future edit can silently flip one. Pure math over synthetic RGBA — runs anywhere.

import { describe, it, expect } from "vitest";
import {
  measureFromPixels,
  cctFromLinearRGB,
  tintGMFromLinearRGB,
  wbExposureEvidence,
  sceneEvidence,
  scoreVectors,
  matchPercent,
  MATCH_THRESHOLD,
} from "../metrics";

// solid-color frame (opaque)
function solid(r: number, g: number, b: number, w = 16, h = 16) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  return measureFromPixels(d, w, h);
}
// per-pixel frame
function frame(px: (x: number, y: number) => [number, number, number], w = 32, h = 32) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = px(x, y); const p = (y * w + x) * 4;
    d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
  }
  return measureFromPixels(d, w, h);
}

describe("CCT direction — warm reads LOWER kelvin than cool (legend: lower CCT = warmer)", () => {
  it("amber < neutral < blue", () => {
    const warm = cctFromLinearRGB(1.0, 0.7, 0.4)!;
    const neutral = cctFromLinearRGB(1, 1, 1)!;
    const cool = cctFromLinearRGB(0.6, 0.8, 1.0)!;
    expect(warm).toBeLessThan(neutral);
    expect(neutral).toBeLessThan(cool);
  });
});

describe("exposure_gap_ev sign — positive means the CURRENT render is too dark", () => {
  it("reference brighter than current => positive gap", () => {
    const ref = solid(188, 188, 188); // ~linear 0.5
    const cur = solid(99, 99, 99); //     ~linear 0.125
    expect(wbExposureEvidence(ref, cur).exposure_gap_ev!).toBeGreaterThan(0);
  });
  it("reference darker than current => negative gap", () => {
    const ref = solid(99, 99, 99);
    const cur = solid(188, 188, 188);
    expect(wbExposureEvidence(ref, cur).exposure_gap_ev!).toBeLessThan(0);
  });
});

describe("warmth sign — a warmer (redder) image reads higher warmth*", () => {
  it("red frame warmer than blue frame at both shadow and highlight", () => {
    const warm = solid(220, 160, 110);
    const cool = solid(110, 160, 220);
    expect(warm.wb.warmthHighlight).toBeGreaterThan(cool.wb.warmthHighlight);
    expect(warm.wb.warmthShadow).toBeGreaterThan(cool.wb.warmthShadow);
  });
});

describe("tint_gm sign — greener is positive, magenta is negative (legend)", () => {
  it("green cast > 0, magenta cast < 0, neutral ~0", () => {
    expect(tintGMFromLinearRGB(0.5, 0.62, 0.5)!).toBeGreaterThan(0);
    expect(tintGMFromLinearRGB(0.58, 0.45, 0.58)!).toBeLessThan(0);
    expect(Math.abs(tintGMFromLinearRGB(0.5, 0.5, 0.5)!)).toBeLessThan(1e-9);
  });
});

describe("light_centroid direction — x>0 = right brighter, y>0 = LOWER half brighter", () => {
  it("left-lit frame has negative x; right-lit positive x", () => {
    const left = frame((x) => { const v = 230 - (x / 32) * 190; return [v, v, v]; });
    const right = frame((x) => { const v = 40 + (x / 32) * 190; return [v, v, v]; });
    expect(sceneEvidence(left, left).light_centroid.reference!.x).toBeLessThan(0);
    expect(sceneEvidence(right, right).light_centroid.reference!.x).toBeGreaterThan(0);
  });
  it("bottom-lit frame has positive y", () => {
    const bottom = frame((_x, y) => { const v = 40 + (y / 32) * 190; return [v, v, v]; });
    expect(sceneEvidence(bottom, bottom).light_centroid.reference!.y).toBeGreaterThan(0);
  });
});

describe("key_fill_ratio direction — directional key HIGH, flat ambient ~1", () => {
  it("a hard falloff reads clearly above a flat field", () => {
    const flat = solid(128, 128, 128);
    const directional = frame((x) => { const v = x < 16 ? 230 : 40; return [v, v, v]; });
    const rFlat = sceneEvidence(flat, flat).key_fill_ratio.reference!;
    const rDir = sceneEvidence(directional, directional).key_fill_ratio.reference!;
    expect(rFlat).toBeGreaterThan(0.9);
    expect(rFlat).toBeLessThan(1.15);
    expect(rDir).toBeGreaterThan(rFlat);
  });
});

describe("probe response sign parity — sceneEvidence(base, probe) reads current−reference", () => {
  it("a probe that shifts light RIGHT yields positive d_centroid_x vs the base", () => {
    const base = frame((x) => { const v = 230 - (x / 32) * 190; return [v, v, v]; }); // lit left
    const probe = frame((x) => { const v = 40 + (x / 32) * 190; return [v, v, v]; }); // lit right
    const sc = sceneEvidence(base, probe);
    const dCentroidX = sc.light_centroid.current!.x - sc.light_centroid.reference!.x;
    expect(dCentroidX).toBeGreaterThan(0); // right shift = positive, matches the probe legend
  });
});

describe("score/match anchors — identical is a perfect match, opposite is far", () => {
  it("identical frames score 0 => matchPercent 100 (>= gate)", () => {
    const m = solid(150, 140, 120);
    expect(scoreVectors(m, m)).toBe(0);
    expect(matchPercent(0)).toBe(100);
    expect(0).toBeLessThanOrEqual(MATCH_THRESHOLD);
  });
  it("black-vs-white scores far above the match gate and matchPercent stays in [0,100]", () => {
    const s = scoreVectors(solid(0, 0, 0), solid(255, 255, 255));
    expect(s).toBeGreaterThan(MATCH_THRESHOLD * 5);
    expect(matchPercent(s)).toBeGreaterThanOrEqual(0);
    expect(matchPercent(s)).toBeLessThanOrEqual(100);
  });
});
