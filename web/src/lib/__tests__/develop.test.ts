import { describe, it, expect } from "vitest";
import {
  reinhard,
  srgbOetf,
  linearLuminance,
  developPixelsToRGBA,
  autoExposureEV,
  AUTO_EV_TARGET,
  EV_MIN,
  EV_MAX,
} from "../develop";
import { linearize } from "../metrics";

// -- helpers -----------------------------------------------------------------------
/** A single-pixel linear RGBA buffer. */
function px(r: number, g: number, b: number, a = 1): Float32Array {
  return Float32Array.from([r, g, b, a]);
}
/** Solid linear RGBA fill, w*h pixels. */
function solidLinear(w: number, h: number, r: number, g: number, b: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let p = 0; p < out.length; p += 4) {
    out[p] = r;
    out[p + 1] = g;
    out[p + 2] = b;
    out[p + 3] = 1;
  }
  return out;
}

describe("srgbOetf — the linear→sRGB display encoding", () => {
  it("hits fixed points and round-trips with metrics.linearize", () => {
    expect(srgbOetf(0)).toBe(0);
    expect(srgbOetf(1)).toBe(1);
    // OETF is the inverse of linearize: linearize(srgbOetf(x)) ≈ x
    for (const x of [0.02, 0.1, 0.18, 0.5, 0.9]) {
      expect(linearize(srgbOetf(x))).toBeCloseTo(x, 5);
    }
  });
  it("clamps out-of-range input", () => {
    expect(srgbOetf(-0.5)).toBe(0);
    expect(srgbOetf(2)).toBe(1);
  });
  it("mid-gray linear 0.18 develops near sRGB ~0.46", () => {
    // The classic 18% gray sits around 0.46 in sRGB (≈118/255).
    expect(srgbOetf(0.18)).toBeCloseTo(0.46, 2);
  });
});

describe("reinhard soft-clip of HDR > 1", () => {
  it("is ~identity for small values and compresses large ones below 1", () => {
    expect(reinhard(0)).toBe(0);
    expect(reinhard(1)).toBeCloseTo(0.5, 6); // 1/(1+1)
    // A big HDR value never reaches 1 (no hard clip) but approaches it.
    expect(reinhard(10)).toBeCloseTo(10 / 11, 6);
    expect(reinhard(1000)).toBeLessThan(1);
    expect(reinhard(1000)).toBeGreaterThan(0.999);
  });
  it("clamps a negative linear value to 0", () => {
    expect(reinhard(-3)).toBe(0);
  });
  it("a >1 linear value does NOT hard-clip the developed 8-bit output to 255", () => {
    // Without a soft curve, linear 4.0 would slam sRGB to 255. Reinhard rolls it off.
    const out = developPixelsToRGBA(px(4, 4, 4), 1, 1, { ev: 0, tone: "reinhard" });
    expect(out[0]).toBeLessThan(255);
    expect(out[0]).toBeGreaterThan(230); // still bright, just not clipped
  });
});

describe("developPixelsToRGBA — the per-pixel develop math", () => {
  it("a known linear value develops to the expected sRGB 8-bit", () => {
    // linear 0.18, EV 0, no tone-map: expect round(srgbOetf(0.18)*255) ≈ 118.
    const out = developPixelsToRGBA(px(0.18, 0.18, 0.18), 1, 1, { ev: 0, tone: "none" });
    expect(out[0]).toBe(Math.round(srgbOetf(0.18) * 255));
    expect(out[0]).toBeGreaterThanOrEqual(117);
    expect(out[0]).toBeLessThanOrEqual(119);
    expect(out[3]).toBe(255); // alpha 1 -> 255
  });

  it("linear 0 -> 0 and linear 1 -> 255 (tone:none)", () => {
    const black = developPixelsToRGBA(px(0, 0, 0), 1, 1, { ev: 0, tone: "none" });
    expect([black[0], black[1], black[2]]).toEqual([0, 0, 0]);
    const white = developPixelsToRGBA(px(1, 1, 1), 1, 1, { ev: 0, tone: "none" });
    expect([white[0], white[1], white[2]]).toEqual([255, 255, 255]);
  });

  it("exposure doubling: +1 EV brightens; the developed value rises as if input doubled", () => {
    // With tone:none, +1 EV on linear 0.1 equals developing linear 0.2 at EV 0.
    const at0 = developPixelsToRGBA(px(0.1, 0.1, 0.1), 1, 1, { ev: 0, tone: "none" })[0];
    const atPlus1 = developPixelsToRGBA(px(0.1, 0.1, 0.1), 1, 1, { ev: 1, tone: "none" })[0];
    const doubled = developPixelsToRGBA(px(0.2, 0.2, 0.2), 1, 1, { ev: 0, tone: "none" })[0];
    expect(atPlus1).toBe(doubled); // 2^1 * 0.1 === 0.2
    expect(atPlus1).toBeGreaterThan(at0); // brighter
  });

  it("negative EV darkens", () => {
    const at0 = developPixelsToRGBA(px(0.5, 0.5, 0.5), 1, 1, { ev: 0, tone: "none" })[0];
    const atMinus2 = developPixelsToRGBA(px(0.5, 0.5, 0.5), 1, 1, { ev: -2, tone: "none" })[0];
    expect(atMinus2).toBeLessThan(at0);
    // 2^-2 * 0.5 = 0.125 linear
    expect(atMinus2).toBe(Math.round(srgbOetf(0.125) * 255));
  });

  it("alpha passes through clamped, without OETF/tone-map", () => {
    const out = developPixelsToRGBA(px(1, 1, 1, 0.5), 1, 1, { ev: 0 });
    expect(out[3]).toBe(128); // round(0.5*255)
    const clampHi = developPixelsToRGBA(px(0, 0, 0, 3), 1, 1, {})[3];
    expect(clampHi).toBe(255);
  });

  it("produces a full-length RGBA buffer for a multi-pixel image", () => {
    const out = developPixelsToRGBA(solidLinear(4, 3, 0.2, 0.2, 0.2), 4, 3, {});
    expect(out.length).toBe(4 * 3 * 4);
  });
});

describe("autoExposureEV — a sane initial exposure guess", () => {
  it("puts the median luminance of a dark render near the target (positive push)", () => {
    // A uniformly dim scene at linear 0.01: p50 luminance ≈ 0.01, target 0.18.
    const buf = solidLinear(16, 16, 0.01, 0.01, 0.01);
    const ev = autoExposureEV(buf);
    expect(ev).toBeGreaterThan(0); // needs brightening
    // developing at the auto-EV should land the pixel near the target in LINEAR terms
    const gain = Math.pow(2, ev);
    expect(0.01 * gain).toBeCloseTo(AUTO_EV_TARGET, 1);
  });

  it("pulls down an over-bright render (negative EV)", () => {
    const buf = solidLinear(16, 16, 4, 4, 4); // radiance well above 1
    const ev = autoExposureEV(buf);
    expect(ev).toBeLessThan(0);
    const gain = Math.pow(2, ev);
    // luminance of (4,4,4) is 4; 4*gain should approach the target
    expect(4 * gain).toBeCloseTo(AUTO_EV_TARGET, 1);
  });

  it("returns 0 for a black frame (nothing to expose) and clamps to the EV range", () => {
    expect(autoExposureEV(solidLinear(8, 8, 0, 0, 0))).toBe(0);
    expect(autoExposureEV(new Float32Array(0))).toBe(0);
    // An absurdly dim frame would want a huge push but is clamped.
    const ev = autoExposureEV(solidLinear(8, 8, 1e-9, 1e-9, 1e-9));
    expect(ev).toBeLessThanOrEqual(EV_MAX);
    expect(ev).toBeGreaterThanOrEqual(EV_MIN);
  });

  it("the auto-EV makes a mid scene viewable (not near-black, not blown)", () => {
    const buf = solidLinear(16, 16, 0.05, 0.05, 0.05);
    const ev = autoExposureEV(buf);
    const out = developPixelsToRGBA(buf, 16, 16, { ev });
    // developed midtone should be a real midtone, comfortably inside 40..230
    expect(out[0]).toBeGreaterThan(40);
    expect(out[0]).toBeLessThan(235);
  });
});

describe("linearLuminance uses Rec.709 weights", () => {
  it("weights green heaviest", () => {
    expect(linearLuminance(0, 1, 0)).toBeCloseTo(0.7152, 6);
    expect(linearLuminance(1, 0, 0)).toBeCloseTo(0.2126, 6);
    expect(linearLuminance(0, 0, 1)).toBeCloseTo(0.0722, 6);
  });
});
