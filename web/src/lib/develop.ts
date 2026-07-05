// LightMatch EXR develop pipeline — turns a scene-referred LINEAR HDR buffer (from
// exr.ts) into a DISPLAY-REFERRED sRGB image the rest of the app can measure exactly
// like a PNG/JPG screenshot.
//
// Why this exists: the whole LightMatch metrics/model path reads display-referred sRGB
// 0..255 pixels (metrics.ts linearizes sRGB, the model sees a viewable image). An EXR is
// linear/HDR with values that can exceed 1.0 and live on an arbitrary physical scale
// (V-Ray/Vantage write photometric radiance). So we "develop" it — a photographer's
// word for turning a raw exposure into a viewable frame:
//
//   per channel c (linear, scene-referred):
//     c' = c * 2^EV                 (exposure — EV stops, like the VFB exposure knob)
//     c' = reinhard(c')             (soft-compress so HDR > 1 rolls off instead of hard-clipping)
//     c' = srgbOetf(c')             (linear -> sRGB display encoding)
//     out = round(clamp01(c') * 255)  (8-bit)
//
// The PURE math (developPixelsToRGBA / autoExposureEV / the per-channel transforms) is
// framework- and DOM-free — the node-testable surface. developExr() is the only function
// that touches a canvas; it delegates to the pure core and returns both the canvas (fed
// to the EXISTING measure()/downscaleForSend() pipeline) and a preview data URL.

import { cctFromLinearRGB, tintGMFromLinearRGB } from "./metrics";

// ---------------------------------------------------------------------------
// Pure per-channel transforms (no DOM).
// ---------------------------------------------------------------------------

/** Reinhard tone-map of a single non-negative linear value: c / (1 + c).
 *  Maps [0, ∞) -> [0, 1); identity-ish for small c, gently compresses highlights so a
 *  scene-referred value > 1 rolls off to just under 1 instead of hard-clipping. A tiny
 *  negative (from a noisy EXR channel) is clamped to 0 first. */
export function reinhard(c: number): number {
  const x = c > 0 ? c : 0;
  return x / (1 + x);
}

/** The sRGB OETF (linear 0..1 -> sRGB 0..1). Inverse of metrics.ts `linearize`, so a
 *  value we develop and then re-linearize round-trips. Clamps input to [0,1]. */
export function srgbOetf(c: number): number {
  let x = c;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  x = x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
  return x;
}

/** Rec.709 linear luminance of a linear RGB triple (same weights metrics.ts uses). */
export function linearLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------------------
// Develop options + defaults.
// ---------------------------------------------------------------------------
export interface DevelopOpts {
  /** Exposure in stops. The multiplier applied is 2^ev. Default 0. */
  ev?: number;
  /** Tone-map curve. "reinhard" (default) or "none" (pure clamp, for tests/round-trip). */
  tone?: "reinhard" | "none";
}

/** The auto-exposure target: which luminance percentile to place, and where (in
 *  display-linear 0..1) to place it. p50 -> 0.18 puts the median scene luminance at
 *  middle-gray, a sane starting point for an arbitrarily-scaled physical render. */
export const AUTO_EV_PERCENTILE = 50;
export const AUTO_EV_TARGET = 0.18;
/** EV is clamped to this range everywhere (auto guess AND the UI slider). */
export const EV_MIN = -8;
export const EV_MAX = 8;

// ---------------------------------------------------------------------------
// Auto-exposure: choose an EV so the scene is viewable immediately.
// ---------------------------------------------------------------------------

/**
 * Pick an initial EV so that a luminance percentile of the LINEAR buffer lands at a
 * target display-linear value. Because develop multiplies linear by 2^EV, and we want
 * `pctLuminance * 2^EV ≈ target`, the solution is EV = log2(target / pctLuminance).
 *
 * Robust to arbitrary physical scales (V-Ray radiance can be 0.001 or 5000): a darker
 * render gets a positive EV, a blown-out one a negative EV. Falls back to EV 0 when the
 * buffer is empty or the chosen percentile is ~0 (a black frame — nothing to expose).
 *
 * @param data   linear RGBA Float32Array (length w*h*4), scene-referred
 * @param opts   percentile (0..100) and target (display-linear 0..1); defaults above
 */
export function autoExposureEV(
  data: Float32Array | ArrayLike<number>,
  opts?: { percentile?: number; target?: number }
): number {
  const percentile = opts?.percentile ?? AUTO_EV_PERCENTILE;
  const target = opts?.target ?? AUTO_EV_TARGET;
  const n = Math.floor(data.length / 4);
  if (n <= 0) return 0;

  // Collect per-pixel linear luminance, ignoring fully-transparent pixels' contribution
  // is unnecessary (alpha is not premultiplied here); we key off RGB only.
  const lum = new Float64Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    lum[i] = linearLuminance(data[p], data[p + 1], data[p + 2]);
  }
  // Percentile via sort (n is small — this runs once per decode, on the raw buffer whose
  // longest edge we do NOT bound here; callers pass the full-res buffer, but a single
  // O(n log n) sort at ingest time is fine and exact, unlike a coarse histogram).
  const sorted = Array.prototype.slice.call(lum).sort((a: number, b: number) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((percentile / 100) * (sorted.length - 1))));
  const pct = sorted[idx];

  if (!(pct > 0) || !isFinite(pct)) return 0; // black / degenerate frame -> no push
  let ev = Math.log2(target / pct);
  if (!isFinite(ev)) return 0;
  if (ev < EV_MIN) ev = EV_MIN;
  if (ev > EV_MAX) ev = EV_MAX;
  return ev;
}

// ---------------------------------------------------------------------------
// Linear-domain statistics (EXR-native evidence, 2026-07-05) — pure, node-testable.
//
// WHY here and not metrics.ts: this module is the scene-referred linear surface
// (autoExposureEV already runs percentile math over the same retained Float32 RGBA
// buffer); metrics.ts is the display-referred sRGB surface. Measuring the RETAINED
// linear buffer sidesteps everything the develop transform destroys: the exposure
// gap is exact (no Reinhard compression of the medians), the dynamic range is the
// scene's (not the 8-bit clamp's), and the highlight CCT is read from the light
// itself rather than from tone-mapped pixels. All statistics are computed BEFORE
// any EV gain, so they are exposure-independent — compute once at decode and reuse.
// None of this feeds the look-distance score; it is model evidence only.
// ---------------------------------------------------------------------------

/** Cap on how many pixels linearStats visits. EXRs can be 8K+ (33M px); a fixed
 *  deterministic STRIDE (not random sampling) keeps the cost bounded AND makes the
 *  result a pure function of the buffer — same buffer, same stats, always. */
export const LINEAR_STATS_MAX_SAMPLES = 200_000;

/** Scene-referred statistics of a LINEAR RGBA buffer. All luminances are Rec.709
 *  weights over the raw linear floats (NO OETF, NO tone-map) on the buffer's own
 *  physical scale — only ratios/log-gaps between two buffers are meaningful. Every
 *  field is null for a black/degenerate buffer (no light = no statistic). */
export interface LinearStats {
  /** Median linear luminance (sampled percentile; null when the median carries no light). */
  median_lum: number | null;
  /** 99th-percentile linear luminance (the working highlight level, robust to fireflies). */
  p99_lum: number | null;
  /** log2(p99 / p1) in stops — the scene's usable dynamic range. Null when either
   *  end is black (a log of 0/x or x/0 is not a range, it's a missing floor). */
  dynamic_range_ev: number | null;
  /** CCT (kelvin) of the mean linear RGB over pixels at/above the luminance p75 —
   *  the color of the LIGHT, measured pre-tonemap. Null on no signal. */
  highlight_cct_k: number | null;
  /** Green–magenta tint of the same highlight mean (same axis as metrics' tint_gm). */
  highlight_tint_gm: number | null;
}

/**
 * Measure scene-referred statistics from a LINEAR RGBA buffer (length >= w*h*4).
 *
 * Percentiles are taken by SORTED SAMPLING (not a histogram): the linear domain is
 * unbounded (V-Ray radiance can span 0.001..5000 in one frame), so any fixed-bin
 * histogram needs a log transform + range guess; sorting <=200k sampled values is
 * exact, allocation-cheap, and runs once per decode. Sampling is a fixed pixel
 * stride (ceil(n / LINEAR_STATS_MAX_SAMPLES)) — deterministic by construction.
 * Non-finite pixels (NaN/Inf channels from a degenerate EXR) never vote.
 */
export function linearStats(
  linear: Float32Array | ArrayLike<number>,
  w: number,
  h: number
): LinearStats {
  const NULLS: LinearStats = {
    median_lum: null,
    p99_lum: null,
    dynamic_range_ev: null,
    highlight_cct_k: null,
    highlight_tint_gm: null,
  };
  // Trust the smaller of the declared and actual pixel counts — a short buffer must
  // not read past its end, and a mismatched header is degenerate, not fatal.
  const n = Math.min(w * h, Math.floor(linear.length / 4));
  if (!(n > 0)) return NULLS;

  const stride = Math.max(1, Math.ceil(n / LINEAR_STATS_MAX_SAMPLES));
  // First pass: sampled luminances + the byte offset of each sampled pixel (kept so
  // the highlight pass below revisits exactly the same deterministic sample set).
  const lums: number[] = [];
  const offs: number[] = [];
  for (let i = 0; i < n; i += stride) {
    const p = i * 4;
    const L = linearLuminance(linear[p], linear[p + 1], linear[p + 2]);
    if (!Number.isFinite(L)) continue;
    lums.push(L);
    offs.push(p);
  }
  if (lums.length === 0) return NULLS; // every sample was NaN/Inf — nothing to measure

  const sorted = lums.slice().sort((a, b) => a - b);
  // Same nearest-rank convention as autoExposureEV: floor(p/100 * (len-1)).
  const pick = (pct: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * (sorted.length - 1))))];
  const p1 = pick(1);
  const p50 = pick(50);
  const p75 = pick(75);
  const p99 = pick(99);

  // Highlight region: sampled pixels whose luminance is AT/ABOVE the p75 value.
  // >= (not >) so a flat frame — where every sample equals p75 — still yields a
  // highlight color instead of an empty set; the set is then the whole frame, which
  // is exactly the honest answer for flat light.
  let hr = 0,
    hg = 0,
    hb = 0,
    hn = 0;
  for (let k = 0; k < offs.length; k++) {
    if (lums[k] >= p75) {
      const p = offs[k];
      hr += linear[p];
      hg += linear[p + 1];
      hb += linear[p + 2];
      hn++;
    }
  }

  // Null guards: a percentile of 0 means that tonal band carries no light — report
  // null, never 0 (0 would read as "measured black", which log/ratio math downstream
  // would happily divide by). cct/tint helpers already null out black/invalid means.
  const median_lum = p50 > 0 && Number.isFinite(p50) ? p50 : null;
  const p99_lum = p99 > 0 && Number.isFinite(p99) ? p99 : null;
  let dynamic_range_ev: number | null = null;
  if (p1 > 0 && p99 > 0) {
    const dr = Math.log2(p99 / p1);
    // 2dp — the EV precision convention wbExposureEvidence already uses.
    dynamic_range_ev = Number.isFinite(dr) ? Math.round(dr * 100) / 100 : null;
  }
  const highlight_cct_k = hn > 0 ? cctFromLinearRGB(hr / hn, hg / hn, hb / hn) : null;
  const highlight_tint_gm = hn > 0 ? tintGMFromLinearRGB(hr / hn, hg / hn, hb / hn) : null;

  return { median_lum, p99_lum, dynamic_range_ev, highlight_cct_k, highlight_tint_gm };
}

/** The scene-referred evidence block spread into the model's metricsBundle when BOTH
 *  compared images are EXR-backed. exposure_gap_ev_exact is the linear-domain twin of
 *  metrics' display-referred exposure_gap_ev — same sign convention (positive = the
 *  current render is that many stops too dark), but EXACT because the medians were
 *  never tone-mapped. */
export interface LinearEvidence {
  exposure_gap_ev_exact: number | null;
  reference: LinearStats;
  current: LinearStats;
}

// -- linearEvidence(ref, cur): pair two LinearStats into the evidence block. The gap
//    is log2(ref median / cur median), 2dp, null when either side carries no light
//    (median_lum is already null-guarded > 0 by linearStats). Pure — the engine only
//    decides WHEN to include it (both slots EXR-backed), never how it is computed. --
export function linearEvidence(ref: LinearStats, cur: LinearStats): LinearEvidence {
  let gap: number | null = null;
  if (
    ref.median_lum != null &&
    cur.median_lum != null &&
    ref.median_lum > 0 &&
    cur.median_lum > 0
  ) {
    const v = Math.log2(ref.median_lum / cur.median_lum);
    gap = Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  }
  return { exposure_gap_ev_exact: gap, reference: ref, current: cur };
}

// ---------------------------------------------------------------------------
// The develop core (pure): linear RGBA -> display-referred sRGB RGBA 8-bit.
// ---------------------------------------------------------------------------

/**
 * Develop a scene-referred linear RGBA buffer into a display-referred sRGB
 * Uint8ClampedArray (length w*h*4), applying: exposure (2^EV) -> tone-map -> sRGB OETF
 * -> clamp -> 8-bit. Alpha is passed through, clamped to [0,1] and scaled to 0..255
 * (EXR alpha is linear 0..1 already; no tone-map or OETF on alpha).
 *
 * This is the pixel math the canvas wrapper and the unit tests both exercise.
 */
export function developPixelsToRGBA(
  linearRGBA: Float32Array | ArrayLike<number>,
  w: number,
  h: number,
  opts?: DevelopOpts
): Uint8ClampedArray {
  const ev = opts?.ev ?? 0;
  const tone = opts?.tone ?? "reinhard";
  const gain = Math.pow(2, ev);
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    for (let ch = 0; ch < 3; ch++) {
      let c = linearRGBA[p + ch] * gain;
      c = tone === "reinhard" ? reinhard(c) : c;
      c = srgbOetf(c);
      // out is Uint8ClampedArray so it clamps to [0,255] on assignment; round for accuracy.
      out[p + ch] = Math.round(c * 255);
    }
    // alpha: EXR may omit it (loader fills 1.0). Clamp linear [0,1] -> 0..255, no OETF.
    const a = linearRGBA[p + 3];
    out[p + 3] = a === undefined ? 255 : Math.round((a < 0 ? 0 : a > 1 ? 1 : a) * 255);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Canvas wrapper (browser-only): produce a canvas + preview data URL.
// ---------------------------------------------------------------------------

/** Result of developExr: a canvas the existing pipeline can measure/downscale, plus a
 *  compact preview data URL for the slot thumbnail. */
export interface DevelopResult {
  canvas: HTMLCanvasElement;
  previewDataUrl: string;
  ev: number;
  width: number;
  height: number;
}

/**
 * Develop a linear RGBA buffer to a display-referred sRGB canvas (browser-only).
 * Returns the full-resolution canvas (a DrawableSource the existing measure() and
 * downscaleForSend() consume unchanged — they thumb/downscale it themselves) plus a
 * bounded preview data URL for the slot thumbnail.
 *
 * The canvas carries display-referred sRGB 8-bit pixels, so NOTHING downstream changes:
 * metrics.measure() linearizes them exactly as it does a PNG, and the model sees a
 * viewable JPEG. The develop transform is the ONLY new step.
 *
 * @param opts.ev  exposure in stops; omit to auto-expose (autoExposureEV).
 */
export function developExr(
  linearRGBA: Float32Array,
  w: number,
  h: number,
  opts?: DevelopOpts & { previewMaxEdge?: number; previewType?: string; previewQuality?: number }
): DevelopResult {
  const ev = opts?.ev ?? autoExposureEV(linearRGBA);
  const rgba = developPixelsToRGBA(linearRGBA, w, h, { ev, tone: opts?.tone ?? "reinhard" });

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("developExr: could not get a 2d canvas context.");
  // Construct ImageData over an explicit ArrayBuffer-backed view. developPixelsToRGBA
  // returns a Uint8ClampedArray whose generic buffer type (ArrayBufferLike) does not
  // satisfy the DOM ImageDataArray signature under strict TS; wrap it in a fresh view
  // backed by a plain ArrayBuffer so the type (and the runtime) are exact.
  const backed = new Uint8ClampedArray(rgba.length);
  backed.set(rgba);
  const imageData = new ImageData(backed, w, h);
  ctx.putImageData(imageData, 0, 0);

  // Bounded preview for the thumbnail (never upscales). Kept small — the FULL-res canvas
  // is what feeds measure()/downscaleForSend(); this is only for the <img> in the slot.
  const previewMaxEdge = opts?.previewMaxEdge ?? 640;
  const previewType = opts?.previewType ?? "image/jpeg";
  const previewQuality = opts?.previewQuality ?? 0.85;
  const long = Math.max(w, h);
  const scale = long > previewMaxEdge ? previewMaxEdge / long : 1;
  let previewDataUrl: string;
  if (scale < 1) {
    const pc = document.createElement("canvas");
    pc.width = Math.max(1, Math.round(w * scale));
    pc.height = Math.max(1, Math.round(h * scale));
    const pctx = pc.getContext("2d");
    if (!pctx) throw new Error("developExr: could not get a 2d preview context.");
    pctx.drawImage(canvas, 0, 0, pc.width, pc.height);
    previewDataUrl = pc.toDataURL(previewType, previewQuality);
  } else {
    previewDataUrl = canvas.toDataURL(previewType, previewQuality);
  }

  return { canvas, previewDataUrl, ev, width: w, height: h };
}
