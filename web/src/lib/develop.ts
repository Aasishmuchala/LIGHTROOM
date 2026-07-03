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
