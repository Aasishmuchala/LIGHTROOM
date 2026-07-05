// EXR-native measurement (2026-07-05) — scene-referred linear evidence pins.
// linearStats measures the RETAINED linear Float32 buffer (Rec.709 luminance on raw
// floats, NO OETF/tone-map), so its numbers survive everything the develop transform
// destroys: exposure gaps stay exact (Reinhard would compress the medians), dynamic
// range is the scene's (not the 8-bit clamp's), and the highlight CCT is the light's
// color, not the tone-mapped pixels'. These tests pin:
//   - the EXACT 2.00-stop gap for a 4x-brighter pair (the whole point vs display math);
//   - warm highlights reading a LOWER CCT than neutral ones (direction contract);
//   - dynamic range: 0 for flat light, clearly > 2 stops for a wide ramp;
//   - black/degenerate buffers -> all nulls, never NaN/0-as-measurement;
//   - deterministic stride sampling (same buffer twice -> byte-identical JSON).

import { describe, it, expect } from "vitest";
import {
  linearStats,
  linearEvidence,
  LINEAR_STATS_MAX_SAMPLES,
  type LinearStats,
} from "../develop";

// -- helpers -----------------------------------------------------------------------
/** Solid scene-referred linear RGBA fill, w*h pixels. */
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

/** Per-pixel linear RGBA from an index function (deterministic synthetic "render"). */
function bufFrom(
  w: number,
  h: number,
  px: (i: number) => [number, number, number]
): Float32Array {
  const n = w * h;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = px(i);
    const p = i * 4;
    out[p] = r;
    out[p + 1] = g;
    out[p + 2] = b;
    out[p + 3] = 1;
  }
  return out;
}

/** Uniform gain applied to every channel (an exact power-of-two gain scales every
 *  luminance exactly, so percentile ratios are exact in float math). */
function scaled(src: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let p = 0; p < src.length; p += 4) {
    out[p] = src[p] * gain;
    out[p + 1] = src[p + 1] * gain;
    out[p + 2] = src[p + 2] * gain;
    out[p + 3] = src[p + 3];
  }
  return out;
}

// A textured mid-gray scene: luminances vary (so percentiles are meaningful) but stay
// well away from zero (so nothing null-guards out).
const W = 32;
const H = 32;
const textured = bufFrom(W, H, (i) => {
  const v = 0.2 + ((i * 37) % 101) / 101; // deterministic 0.2..~1.2 texture
  return [v, v, v];
});

// ---------------------------------------------------------------------------------
// Exposure gap: the linear-domain gap is EXACT, not tone-map-approximate.
// ---------------------------------------------------------------------------------
describe("linearEvidence — exposure_gap_ev_exact", () => {
  it("a 4x-brighter buffer pair measures exposure gap 2.00 exactly", () => {
    const ref = scaled(textured, 4); // reference is 2 stops brighter
    const refStats = linearStats(ref, W, H);
    const curStats = linearStats(textured, W, H);
    // Both medians are real signal…
    expect(refStats.median_lum).not.toBeNull();
    expect(curStats.median_lum).not.toBeNull();
    // …and the gap is EXACTLY 2 (a x4 power-of-two gain is exact in float math; the
    // display-referred estimate could never promise this through Reinhard + 8-bit).
    const ev = linearEvidence(refStats, curStats);
    expect(ev.exposure_gap_ev_exact).toBe(2);
    // Sign convention matches metrics' exposure_gap_ev: positive = current too dark.
    expect(linearEvidence(curStats, refStats).exposure_gap_ev_exact).toBe(-2);
  });

  it("carries both sides' stats verbatim and nulls the gap when either side is black", () => {
    const lit = linearStats(textured, W, H);
    const black = linearStats(solidLinear(8, 8, 0, 0, 0), 8, 8);
    const ev = linearEvidence(lit, black);
    expect(ev.exposure_gap_ev_exact).toBeNull();
    expect(ev.reference).toEqual(lit);
    expect(ev.current).toEqual(black);
  });
});

// ---------------------------------------------------------------------------------
// Highlight CCT: measured from the light itself (pre-tonemap), correct direction.
// ---------------------------------------------------------------------------------
describe("linearStats — highlight color", () => {
  it("a warm buffer's highlight_cct_k reads below a neutral buffer's", () => {
    const warm = linearStats(solidLinear(16, 16, 1.0, 0.6, 0.3), 16, 16);
    const neutral = linearStats(solidLinear(16, 16, 0.7, 0.7, 0.7), 16, 16);
    expect(warm.highlight_cct_k).not.toBeNull();
    expect(neutral.highlight_cct_k).not.toBeNull();
    expect(warm.highlight_cct_k!).toBeLessThan(neutral.highlight_cct_k!);
  });

  it("highlight stats are gated to the bright quartile: warm lights over cool shadows read warm", () => {
    // 70% of samples: dim cool ambient. Top 30%: a hot warm key — comfortably past the
    // p75 rank, so the >= p75 gate isolates the key and the CCT reads clearly warm
    // despite the cool majority.
    const n = 32 * 32;
    const mixed = bufFrom(32, 32, (i) =>
      i < Math.floor(n * 0.7) ? [0.04, 0.05, 0.08] : [2.0, 1.2, 0.6]
    );
    const stats = linearStats(mixed, 32, 32);
    expect(stats.highlight_cct_k).not.toBeNull();
    expect(stats.highlight_cct_k!).toBeLessThan(5000); // warm, not the cool ambient
  });

  it("a green-cast highlight reads a positive highlight_tint_gm, neutral reads ~0", () => {
    const green = linearStats(solidLinear(8, 8, 0.5, 0.65, 0.5), 8, 8);
    const neutral = linearStats(solidLinear(8, 8, 0.5, 0.5, 0.5), 8, 8);
    expect(green.highlight_tint_gm!).toBeGreaterThan(0.02);
    expect(Math.abs(neutral.highlight_tint_gm!)).toBeLessThan(1e-9);
  });
});

// ---------------------------------------------------------------------------------
// Dynamic range: log2(p99/p1), flat light = 0, a wide ramp = many stops.
// ---------------------------------------------------------------------------------
describe("linearStats — dynamic_range_ev", () => {
  it("a flat buffer measures ~0 stops, a wide luminance ramp measures > 2", () => {
    const flat = linearStats(solidLinear(16, 16, 0.25, 0.25, 0.25), 16, 16);
    expect(flat.dynamic_range_ev).toBe(0); // p99 === p1 exactly
    // Ramp spanning 0.02..~10 linear — far more than 2 stops between p1 and p99.
    const n = 24 * 24;
    const ramp = bufFrom(24, 24, (i) => {
      const v = 0.02 + (i / (n - 1)) * 10;
      return [v, v, v];
    });
    const wide = linearStats(ramp, 24, 24);
    expect(wide.dynamic_range_ev).not.toBeNull();
    expect(wide.dynamic_range_ev!).toBeGreaterThan(2);
  });

  it("median/p99 track the scene-referred scale (HDR values above 1.0 survive)", () => {
    // Display-referred math caps at 1.0; the linear domain must not.
    const hot = linearStats(solidLinear(8, 8, 6, 6, 6), 8, 8);
    expect(hot.median_lum!).toBeCloseTo(6, 5);
    expect(hot.p99_lum!).toBeCloseTo(6, 5);
  });
});

// ---------------------------------------------------------------------------------
// Degenerate inputs: nulls, never NaN / phantom zeros.
// ---------------------------------------------------------------------------------
describe("linearStats — black / degenerate buffers", () => {
  const ALL_NULL: LinearStats = {
    median_lum: null,
    p99_lum: null,
    dynamic_range_ev: null,
    highlight_cct_k: null,
    highlight_tint_gm: null,
  };

  it("a black buffer yields all nulls", () => {
    expect(linearStats(solidLinear(8, 8, 0, 0, 0), 8, 8)).toEqual(ALL_NULL);
  });

  it("an empty / zero-size buffer yields all nulls", () => {
    expect(linearStats(new Float32Array(0), 0, 0)).toEqual(ALL_NULL);
    expect(linearStats(new Float32Array(0), 4, 4)).toEqual(ALL_NULL); // header lies, buffer empty
  });

  it("an all-NaN buffer yields all nulls (non-finite samples never vote)", () => {
    const nan = new Float32Array(8 * 8 * 4).fill(NaN);
    expect(linearStats(nan, 8, 8)).toEqual(ALL_NULL);
  });
});

// ---------------------------------------------------------------------------------
// Determinism: stride sampling is a pure function of the buffer.
// ---------------------------------------------------------------------------------
describe("linearStats — deterministic stride sampling", () => {
  it("a buffer larger than the sample cap still measures identically on every call", () => {
    // 512x512 = 262,144 px > LINEAR_STATS_MAX_SAMPLES -> stride kicks in (stride 2).
    const W2 = 512;
    const H2 = 512;
    expect(W2 * H2).toBeGreaterThan(LINEAR_STATS_MAX_SAMPLES);
    const big = bufFrom(W2, H2, (i) => {
      const v = 0.05 + ((i * 2654435761) % 9973) / 9973; // deterministic hash texture
      return [v, v * 0.9, v * 0.8];
    });
    const a = JSON.stringify(linearStats(big, W2, H2));
    const b = JSON.stringify(linearStats(big, W2, H2));
    expect(a).toBe(b); // same buffer twice -> byte-identical JSON
    // And an independent COPY of the same pixels measures the same too (the sample set
    // is positional, not identity- or randomness-based).
    const c = JSON.stringify(linearStats(Float32Array.from(big), W2, H2));
    expect(c).toBe(a);
  });
});
