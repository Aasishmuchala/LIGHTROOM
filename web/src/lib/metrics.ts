// LightMatch photometry — ported faithfully from the vanilla app (lightmatch.html).
//
// The pure numeric core (linearize / luminance / percentile histograms /
// measureFromPixels / diffVectors / scoreVectors) is framework- and DOM-free and is
// the node-testable surface. The browser-only wrappers (thumb / measure /
// downscaleForSend) get an ImageData buffer from a canvas, then delegate to the pure
// core — they are the ONLY functions here that touch `document` / `createImageBitmap`
// / `ImageBitmap`, and they preserve the vanilla behavior identically (measure() =
// thumb-to-256 then measureFromPixels over that thumb's RGBA data).
//
// Every constant, weight, and formula below matches the source byte-for-byte.

import type {
  MetricVector,
  MetricDiff,
  DownscaleResult,
} from "./types";

// -- constants -------------------------------------------------------------------
export const HIST_BINS = 1024;
export const CLIP_HI_THRESH = 250; // sRGB 0..255: a pixel counts toward clip.hi when max(r,g,b) >= this
export const CLIP_LO_THRESH = 5; //   sRGB 0..255: a pixel counts toward clip.lo when max(r,g,b) <= this
// Rationale for CLIP thresholds: max(r,g,b) (not min, not "all channels") is the
// sRGB proxy used because it is monotone under a uniform exposure push (raising
// exposure only ever raises max(r,g,b), never lowers it) and it satisfies the
// three fixed points the contract requires: solid-255 -> hi===1 (max=255>=250 for
// every pixel), solid-0 -> lo===1 (max=0<=5 for every pixel), solid-128 -> 0/0
// (max=128 is on neither side).

// -- deterministic 0..100 look-distance score --------------------------------------
// score = min(100, 100 * sqrt( Σ w_i·d_i² / Σ w_i ) / 0.35)
// Uses exactly the diff keys + weights below; d_i are diffVectors(refM, attemptM) values.
export const SCORE_WEIGHTS: Record<string, number> = {
  "lum.p5": 3,
  "lum.p50": 3,
  "lum.p95": 3,
  "contrast.spread": 2,
  "contrast.midSlope": 2,
  "wb.warmthShadow": 2,
  "wb.warmthHighlight": 2,
  "wb.tint": 2,
  "clip.hi": 1.5,
  "clip.lo": 1.5,
  "sat.mean": 1,
  "grid.0": 0.5,
  "grid.1": 0.5,
  "grid.2": 0.5,
  "grid.3": 0.5,
  "grid.4": 0.5,
  "grid.5": 0.5,
  "grid.6": 0.5,
  "grid.7": 0.5,
  "grid.8": 0.5,
  "grid.9": 0.5,
  "grid.10": 0.5,
  "grid.11": 0.5,
  "grid.12": 0.5,
  "grid.13": 0.5,
  "grid.14": 0.5,
  "grid.15": 0.5,
};

// ===========================================================================
// Pure numeric core (no DOM) — the node-testable surface.
// ===========================================================================

// -- linearize a single sRGB channel (0..1 in, 0..1 out) --------------------------
export function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// -- linear luminance from sRGB 0..1 channels --------------------------------------
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

// -- percentile bin INDICES via a fixed-bin histogram (0..nBins-1) ----------------
// values: array-like of numbers already in [0,1]. ps: array of percentiles in [0,100].
// Returns bin indices aligned with `ps`. Kept separate from the bin-center value
// conversion below because shadow/highlight membership needs to compare each
// pixel's OWN bin index against the cutoff bin index (self-consistent in the same
// discretized space) rather than against the rounded bin-center value.
export function percentileBinsFromHistogram(
  values: ArrayLike<number>,
  ps: number[],
  nBins?: number
): number[] {
  const bins = nBins || HIST_BINS;
  const hist = new Uint32Array(bins);
  const n = values.length;
  for (let i = 0; i < n; i++) {
    let idx = Math.floor(values[i] * bins);
    if (idx < 0) idx = 0;
    else if (idx >= bins) idx = bins - 1;
    hist[idx]++;
  }
  const out = new Array<number>(ps.length);
  for (let pi = 0; pi < ps.length; pi++) {
    const target = (ps[pi] / 100) * n;
    let cum = 0,
      bin = bins - 1;
    for (let b = 0; b < bins; b++) {
      cum += hist[b];
      if (cum >= target) {
        bin = b;
        break;
      }
    }
    out[pi] = bin;
  }
  return out;
}

// -- percentile via a fixed-bin histogram; returns the bin-CENTER value -----------
// Same binning as percentileBinsFromHistogram, converted to a representative 0..1 value.
export function percentilesFromHistogram(
  values: ArrayLike<number>,
  ps: number[],
  nBins?: number
): number[] {
  const bins = nBins || HIST_BINS;
  const binIdx = percentileBinsFromHistogram(values, ps, bins);
  return binIdx.map((bin) => (bin + 0.5) / bins);
}

// -- core measurement from a raw RGBA buffer --------------------------------------
// data: Uint8ClampedArray (or any indexable) of length >= w*h*4, RGBA row-major.
// This is the vanilla METRICS.measure() math verbatim, lifted off the canvas so it
// can run in node against a synthetic buffer. The browser wrapper measure() thumbs
// to 256px first and then calls this with that thumb's pixels.
export function measureFromPixels(
  data: Uint8ClampedArray | ArrayLike<number>,
  w: number,
  h: number
): MetricVector {
  const n = w * h;

  const lumArr = new Float64Array(n);
  const satArr = new Float64Array(n);
  let clipHiCount = 0,
    clipLoCount = 0;
  let satSum = 0;
  let meanLinR = 0,
    meanLinG = 0,
    meanLinB = 0;

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r255 = data[p],
      g255 = data[p + 1],
      b255 = data[p + 2];
    const r = r255 / 255,
      g = g255 / 255,
      b = b255 / 255;
    const lum = luminance(r, g, b);
    lumArr[i] = lum;

    const maxc = Math.max(r255, g255, b255);
    if (maxc >= CLIP_HI_THRESH) clipHiCount++;
    if (maxc <= CLIP_LO_THRESH) clipLoCount++;

    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    const s = mx === 0 ? 0 : (mx - mn) / mx;
    satArr[i] = s;
    satSum += s;

    meanLinR += linearize(r);
    meanLinG += linearize(g);
    meanLinB += linearize(b);
  }
  meanLinR /= n;
  meanLinG /= n;
  meanLinB /= n;

  // -- luminance percentiles (bin-center values, for the returned lum object) -------
  const [p1, p5, p25, p50, p75, p95, p99] = percentilesFromHistogram(
    lumArr,
    [1, 5, 25, 50, 75, 95, 99]
  );
  // -- same cutoffs as BIN INDICES, for robust shadow/highlight membership below.
  const [p25Bin, p75Bin] = percentileBinsFromHistogram(lumArr, [25, 75]);
  let lumSum = 0;
  for (let i = 0; i < n; i++) lumSum += lumArr[i];
  const lumMean = lumSum / n;

  // -- clip fractions ---------------------------------------------------------------
  const clip = { hi: clipHiCount / n, lo: clipLoCount / n };

  // -- contrast -----------------------------------------------------------------------
  const contrast = { spread: p95 - p5, midSlope: (p75 - p25) / 0.5 };

  // -- white balance: shadow = lum-bin<=p25-bin, highlight = lum-bin>=p75-bin,
  //    mean LINEAR channels over each set ------------------------------------------
  let shR = 0,
    shG = 0,
    shB = 0,
    shN = 0;
  let hiR = 0,
    hiG = 0,
    hiB = 0,
    hiN = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let binIdx = Math.floor(lumArr[i] * HIST_BINS);
    if (binIdx < 0) binIdx = 0;
    else if (binIdx >= HIST_BINS) binIdx = HIST_BINS - 1;
    const r = linearize(data[p] / 255),
      g = linearize(data[p + 1] / 255),
      b = linearize(data[p + 2] / 255);
    if (binIdx <= p25Bin) {
      shR += r;
      shG += g;
      shB += b;
      shN++;
    }
    if (binIdx >= p75Bin) {
      hiR += r;
      hiG += g;
      hiB += b;
      hiN++;
    }
  }
  // shN/hiN are always >=1 for any non-empty image (guards against div-by-zero).
  const shadow = { r: shN ? shR / shN : 0, g: shN ? shG / shN : 0, b: shN ? shB / shN : 0 };
  const highlight = { r: hiN ? hiR / hiN : 0, g: hiN ? hiG / hiN : 0, b: hiN ? hiB / hiN : 0 };
  const warmthShadow = (shadow.r - shadow.b) / (shadow.r + shadow.b + 1e-9);
  const warmthHighlight = (highlight.r - highlight.b) / (highlight.r + highlight.b + 1e-9);
  // tint is a single whole-image green/magenta statistic (mirrors sat.mean being a
  // whole-image stat), using the overall mean LINEAR r,g,b across every pixel.
  const tint = meanLinG - (meanLinR + meanLinB) / 2;
  const wb = { shadow, highlight, warmthShadow, warmthHighlight, tint };

  // -- saturation ---------------------------------------------------------------------
  const satMean = satSum / n;
  const [satP95] = percentilesFromHistogram(satArr, [95]);
  const sat = { mean: satMean, p95: satP95 };

  // -- 4x4 grid: mean linear luminance per cell, row-major -----------------------------
  const grid = new Array<number>(16).fill(0);
  const gridCount = new Array<number>(16).fill(0);
  for (let y = 0; y < h; y++) {
    let gy = Math.floor((y / h) * 4);
    if (gy > 3) gy = 3;
    for (let x = 0; x < w; x++) {
      let gx = Math.floor((x / w) * 4);
      if (gx > 3) gx = 3;
      const cell = gy * 4 + gx;
      grid[cell] += lumArr[y * w + x];
      gridCount[cell]++;
    }
  }
  for (let i = 0; i < 16; i++) grid[i] = gridCount[i] ? grid[i] / gridCount[i] : 0;

  return {
    lum: { p1, p5, p25, p50, p75, p95, p99, mean: lumMean },
    clip,
    contrast,
    wb,
    sat,
    grid,
  };
}

// -- flat diff: (b - a) per scalar, plus grid.0..grid.15 ---------------------------
export function diffVectors(a: MetricVector, b: MetricVector): MetricDiff {
  const out: MetricDiff = {
    "lum.p1": b.lum.p1 - a.lum.p1,
    "lum.p5": b.lum.p5 - a.lum.p5,
    "lum.p25": b.lum.p25 - a.lum.p25,
    "lum.p50": b.lum.p50 - a.lum.p50,
    "lum.p75": b.lum.p75 - a.lum.p75,
    "lum.p95": b.lum.p95 - a.lum.p95,
    "lum.p99": b.lum.p99 - a.lum.p99,
    "lum.mean": b.lum.mean - a.lum.mean,
    "clip.hi": b.clip.hi - a.clip.hi,
    "clip.lo": b.clip.lo - a.clip.lo,
    "contrast.spread": b.contrast.spread - a.contrast.spread,
    "contrast.midSlope": b.contrast.midSlope - a.contrast.midSlope,
    "wb.warmthShadow": b.wb.warmthShadow - a.wb.warmthShadow,
    "wb.warmthHighlight": b.wb.warmthHighlight - a.wb.warmthHighlight,
    "wb.tint": b.wb.tint - a.wb.tint,
    "sat.mean": b.sat.mean - a.sat.mean,
    "sat.p95": b.sat.p95 - a.sat.p95,
  };
  for (let i = 0; i < 16; i++) out[`grid.${i}`] = b.grid[i] - a.grid[i];
  return out;
}

// -- deterministic 0..100 look-distance score --------------------------------------
export function scoreVectors(refM: MetricVector, attemptM: MetricVector): number {
  const d = diffVectors(refM, attemptM);
  let wsum = 0,
    wdsum = 0;
  for (const [key, w] of Object.entries(SCORE_WEIGHTS)) {
    const di = d[key] || 0;
    wsum += w;
    wdsum += w * di * di;
  }
  const raw = (100 * Math.sqrt(wdsum / wsum)) / 0.35;
  return Math.min(100, raw);
}

// -- pure downscale dimension math (no DOM). Shared rule: never upscale
//    (scale = min(1, maxEdge / longEdge)). Returns the target canvas size. ---------
export function downscaleDimensions(
  sw: number,
  sh: number,
  maxEdge: number
): { w: number; h: number; scale: number } {
  const longEdge = Math.max(sw, sh);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  return { w, h, scale };
}

// ===========================================================================
// Browser-only wrappers — the ONLY functions here that touch the DOM. They lift an
// RGBA buffer off a canvas / bitmap and delegate to the pure core above. Keep these
// out of node tests.
// ===========================================================================

/** Anything drawable via canvas 2d drawImage that reports width/height. */
export interface DrawableSource {
  width: number;
  height: number;
}

// -- draw any supported source onto a canvas sized to fit within maxEdge, never
//    upscaling. Accepts a canvas or an ImageBitmap-like object. (browser-only) -----
export function thumb(source: DrawableSource, maxEdge: number): HTMLCanvasElement {
  const { w, h } = downscaleDimensions(source.width, source.height, maxEdge);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  return c;
}

// -- core measurement (browser-only): thumb to 256, read pixels, run the pure core.
//    Behaviorally identical to the vanilla METRICS.measure(). --------------------
export function measure(imageBitmapOrCanvas: DrawableSource): MetricVector {
  const th = thumb(imageBitmapOrCanvas, 256);
  const ctx = th.getContext("2d")!;
  const w = th.width,
    h = th.height;
  const { data } = ctx.getImageData(0, 0, w, h);
  return measureFromPixels(data, w, h);
}

// -- downscale a File/Blob/canvas/ImageBitmap for sending to the model; never
//    upscales (same rule as thumb()). Lossy default (1568, image/jpeg, q=0.85) and a
//    lossless variant for the settings screenshot (2048, image/png). Rejects (throws)
//    if a File/Blob cannot be decoded as an image. (browser-only) -----------------
export async function downscaleForSend(
  fileOrBlobOrCanvas: DrawableSource | Blob | File,
  maxEdge?: number,
  type?: string,
  q?: number
): Promise<DownscaleResult> {
  maxEdge = maxEdge === undefined ? 1568 : maxEdge;
  type = type === undefined ? "image/jpeg" : type;
  q = q === undefined ? 0.85 : q;

  let source = fileOrBlobOrCanvas as DrawableSource & { getContext?: unknown; close?: () => void };
  const isCanvasLike =
    source &&
    typeof (source as { getContext?: unknown }).getContext === "function" &&
    typeof source.width === "number" &&
    typeof source.height === "number";
  const isBitmapLike = typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap;
  let decodedHere = false;
  if (!isCanvasLike && !isBitmapLike) {
    // File or Blob: decode to an ImageBitmap first. We own this bitmap and must
    // close it ourselves once drawn — a caller-supplied ImageBitmap is never closed
    // here, since the caller still owns its lifecycle.
    source = (await createImageBitmap(
      fileOrBlobOrCanvas as Blob
    )) as unknown as DrawableSource & { close?: () => void };
    decodedHere = true;
  }
  const sw = source.width,
    sh = source.height;

  const { w, h } = downscaleDimensions(sw, sh, maxEdge);

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  if (decodedHere && typeof (source as { close?: () => void }).close === "function") {
    (source as { close: () => void }).close();
  }
  const dataUrl = c.toDataURL(type, q);
  return { dataUrl, w, h };
}

// The METRICS object mirrors the vanilla source's single namespace. Note: `measure`,
// `thumb`, and `downscaleForSend` are browser-only; the rest are pure.
export const METRICS = {
  HIST_BINS,
  CLIP_HI_THRESH,
  CLIP_LO_THRESH,
  SCORE_WEIGHTS,
  linearize,
  luminance,
  percentileBinsFromHistogram,
  percentilesFromHistogram,
  measureFromPixels,
  diffVectors,
  scoreVectors,
  downscaleDimensions,
  // browser-only:
  thumb,
  measure,
  downscaleForSend,
};

export default METRICS;
