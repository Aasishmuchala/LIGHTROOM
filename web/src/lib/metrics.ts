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
// Sky-region mask heuristic (2026-07-05 addition — sun/HDRI/env decisions want the
// SKY measured separately from the subject): a pixel is "sky" when it sits in the
// top 45% of the frame's rows AND its luminance is at or above the image's own p60
// (bright-for-this-image), over opaque pixels only. The MetricVector only carries a
// `sky` field when the mask covers at least SKY_MIN_FRAC of the opaque pixels —
// below that the "sky" is a sliver/false positive and consumers must treat it as
// absent. Both constants are shared with sceneEvidence()'s null-guard.
export const SKY_TOP_FRAC = 0.45; // rows with y < h * this are sky-eligible
export const SKY_MIN_FRAC = 0.04; // mask must cover >= this fraction of opaque pixels
// EXPERIMENTAL edge-softness proxy (2026-07-05 addition — shadow softness / light
// size is the last still-eyeballed match dimension): the distribution of the
// luminance gradient magnitude |dL| over MID-TONE pixels only. Rationale: a
// hard/small light source draws crisp shadow boundaries (large |dL| exactly in the
// mid tones, where shadow terminators live); a big/soft source smears them.
// Highlights and blacks are EXCLUDED from the band — specular edges and noise
// floors would swamp the shadow-boundary signal. |dL| is clamped at GRAD_CLAMP and
// scaled into 0..1 so the existing fixed-bin percentile helper applies unchanged
// (0 = flat, 1 = a full black-to-white step). The field attaches ONLY when at
// least GRAD_MIN_PIXELS pixels qualify — consumers must null-guard (old persisted
// sessions never had it) and must treat it as DIRECTION-ONLY evidence.
export const GRAD_MID_LO = 0.08; // linear-luminance mid-tone band, lower bound
export const GRAD_MID_HI = 0.7; //  upper bound — above this is highlight/specular
export const GRAD_CLAMP = 0.5; //   |dL| ceiling; scaled = min(|dL|, this) / this
export const GRAD_MIN_PIXELS = 100; // fewer qualifying pixels ⇒ field omitted
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
  // p25/p75/mean are in diffVectors + shown to the model but historically scored 0; weighting
  // them makes the look-distance reflect the FULL tonal match (shadow/highlight bulk + overall level),
  // not just the p5/p50/p95 anchors.
  "lum.p25": 2,
  "lum.p75": 2,
  "lum.mean": 2,
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

// -- match gate + "% match" mapping ------------------------------------------------
// The look-distance score is "how far the attempt is from the reference" on a 0..100
// scale. MATCH_THRESHOLD is the point at or below which the LIGHTING counts as matched
// (~97%+ — the remaining residual is a color grade, not a lighting problem). matchPercent
// turns the raw look-distance into the "% match" the product promises: it treats the
// score as "% away", so score 0 -> 100%, 3 -> 97%, 12 -> 88%, 35 -> 65%.
export const MATCH_THRESHOLD = 3; // look-distance <= this ⇒ "lighting matched"
export function matchPercent(score: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - score)));
}

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

  // -- ALPHA handling: fully/mostly-transparent pixels (alpha < ALPHA_MIN) are phantom
  //    data — an archviz beauty PNG's transparent regions read as pure black and would
  //    poison every statistic (drag luminance down, invent clip.lo, fake the grid's dark
  //    corners). Skip them from ALL stats and divide means/counts by the OPAQUE pixel
  //    count. `opaque` is a per-pixel mask reused by the grid + white-balance passes so
  //    every statistic sees the same set. If NOTHING is opaque, fall back to counting all
  //    pixels (never divide by zero) — this preserves the original behavior for the fully
  //    opaque images the tests use. ------------------------------------------------------
  const ALPHA_MIN = 16; // sRGB 0..255 alpha; below this a pixel is treated as transparent
  const lumArr = new Float64Array(n);
  const satArr = new Float64Array(n);
  const opaque = new Uint8Array(n);
  let opaqueCount = 0;
  // Opaque-only accumulators (the normal path) AND all-pixel accumulators (used only for
  // the fully-transparent fallback so it reproduces the original divide-by-n behavior
  // exactly rather than reading as an all-zero degenerate). lumArr/satArr are ALWAYS
  // filled (every pixel) so the grid / wb / percentile passes have real values in the
  // fallback; the mask decides which pixels each statistic actually counts.
  let clipHiCount = 0,
    clipLoCount = 0,
    satSum = 0,
    meanLinR = 0,
    meanLinG = 0,
    meanLinB = 0;
  let allClipHi = 0,
    allClipLo = 0,
    allSatSum = 0,
    allMeanLinR = 0,
    allMeanLinG = 0,
    allMeanLinB = 0;

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const isOpaque = data[p + 3] >= ALPHA_MIN;
    opaque[i] = isOpaque ? 1 : 0;
    if (isOpaque) opaqueCount++;

    const r255 = data[p],
      g255 = data[p + 1],
      b255 = data[p + 2];
    const r = r255 / 255,
      g = g255 / 255,
      b = b255 / 255;
    lumArr[i] = luminance(r, g, b);

    const maxc = Math.max(r255, g255, b255);
    const isHi = maxc >= CLIP_HI_THRESH ? 1 : 0;
    const isLo = maxc <= CLIP_LO_THRESH ? 1 : 0;

    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    const s = mx === 0 ? 0 : (mx - mn) / mx;
    satArr[i] = s;

    const linR = linearize(r),
      linG = linearize(g),
      linB = linearize(b);

    // all-pixel accumulators (fallback only)
    allClipHi += isHi;
    allClipLo += isLo;
    allSatSum += s;
    allMeanLinR += linR;
    allMeanLinG += linG;
    allMeanLinB += linB;

    // opaque-only accumulators (normal path)
    if (isOpaque) {
      clipHiCount += isHi;
      clipLoCount += isLo;
      satSum += s;
      meanLinR += linR;
      meanLinG += linG;
      meanLinB += linB;
    }
  }

  // Fully-transparent fallback: reproduce the original all-pixel math (never divide by
  // zero). Otherwise every mean/fraction/percentile counts OPAQUE pixels only.
  const allTransparent = opaqueCount === 0;
  const statN = allTransparent ? n : opaqueCount;
  if (allTransparent) {
    clipHiCount = allClipHi;
    clipLoCount = allClipLo;
    satSum = allSatSum;
    meanLinR = allMeanLinR;
    meanLinG = allMeanLinG;
    meanLinB = allMeanLinB;
  }

  meanLinR /= statN;
  meanLinG /= statN;
  meanLinB /= statN;

  // Compacted OPAQUE-only luminance/saturation arrays for the percentile histograms — so
  // transparent pixels don't pull the percentiles toward black. When everything is
  // transparent, fall back to the full arrays (matches the pre-alpha behavior).
  let lumForPct: ArrayLike<number> = lumArr;
  let satForPct: ArrayLike<number> = satArr;
  if (!allTransparent && opaqueCount < n) {
    const lo = new Float64Array(opaqueCount);
    const so = new Float64Array(opaqueCount);
    for (let i = 0, k = 0; i < n; i++) {
      if (opaque[i]) {
        lo[k] = lumArr[i];
        so[k] = satArr[i];
        k++;
      }
    }
    lumForPct = lo;
    satForPct = so;
  }

  // -- luminance percentiles (bin-center values, for the returned lum object) -------
  const [p1, p5, p25, p50, p75, p95, p99] = percentilesFromHistogram(
    lumForPct,
    [1, 5, 25, 50, 75, 95, 99]
  );
  // -- same cutoffs as BIN INDICES, for robust shadow/highlight membership below.
  //    p60 added for the sky mask (2026-07-05): sky membership compares each pixel's
  //    OWN bin index against the p60 bin index — the same self-consistent
  //    discretized-space comparison the shadow/highlight sets use.
  const [p25Bin, p60Bin, p75Bin] = percentileBinsFromHistogram(lumForPct, [25, 60, 75]);
  let lumSum = 0;
  for (let i = 0; i < n; i++) if (allTransparent || opaque[i]) lumSum += lumArr[i];
  const lumMean = lumSum / statN;

  // -- clip fractions (over opaque pixels only) -------------------------------------
  const clip = { hi: clipHiCount / statN, lo: clipLoCount / statN };

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
    if (!allTransparent && !opaque[i]) continue; // transparent pixels don't vote on wb
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

  // -- saturation (mean over opaque pixels only) --------------------------------------
  const satMean = satSum / statN;
  const [satP95] = percentilesFromHistogram(satForPct, [95]);
  const sat = { mean: satMean, p95: satP95 };

  // -- 4x4 grid: mean linear luminance per cell, row-major. Transparent pixels are
  //    excluded so a cell that is partly (or fully) transparent reports the mean of only
  //    its opaque pixels, not a black-diluted value. A fully-transparent cell stays 0. ---
  const grid = new Array<number>(16).fill(0);
  const gridCount = new Array<number>(16).fill(0);
  for (let y = 0; y < h; y++) {
    let gy = Math.floor((y / h) * 4);
    if (gy > 3) gy = 3;
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!allTransparent && !opaque[idx]) continue;
      let gx = Math.floor((x / w) * 4);
      if (gx > 3) gx = 3;
      const cell = gy * 4 + gx;
      grid[cell] += lumArr[idx];
      gridCount[cell]++;
    }
  }
  for (let i = 0; i < 16; i++) grid[i] = gridCount[i] ? grid[i] / gridCount[i] : 0;

  // -- OPTIONAL sky region (2026-07-05): linear means over the sky mask — rows in
  //    the top SKY_TOP_FRAC of the frame AND lum-bin >= the p60 bin (see constants).
  //    A cheap second pass over the already-computed lumArr + pixel data; transparent
  //    pixels are excluded exactly like every other statistic (and the fully-
  //    transparent fallback counts all pixels, same as the wb/grid passes). The field
  //    is attached ONLY when the mask covers >= SKY_MIN_FRAC of the counted pixels —
  //    a bottom-lit or sky-less frame omits it entirely, so old consumers (and old
  //    persisted sessions, which never had it) see an unchanged shape. -------------
  let skyR = 0,
    skyG = 0,
    skyB = 0,
    skyLum = 0,
    skyN = 0;
  const skyYMax = h * SKY_TOP_FRAC; // rows strictly below this boundary are eligible
  for (let y = 0; y < h && y < skyYMax; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!allTransparent && !opaque[i]) continue; // transparent pixels are not sky
      let binIdx = Math.floor(lumArr[i] * HIST_BINS);
      if (binIdx < 0) binIdx = 0;
      else if (binIdx >= HIST_BINS) binIdx = HIST_BINS - 1;
      if (binIdx < p60Bin) continue; // not bright-for-this-image — subject, not sky
      const p = i * 4;
      skyR += linearize(data[p] / 255);
      skyG += linearize(data[p + 1] / 255);
      skyB += linearize(data[p + 2] / 255);
      skyLum += lumArr[i];
      skyN++;
    }
  }
  const skyFrac = skyN / statN; // statN is never 0 (fallback guarantees it)
  const sky =
    skyFrac >= SKY_MIN_FRAC
      ? {
          frac: skyFrac,
          meanLum: skyLum / skyN,
          r: skyR / skyN,
          g: skyG / skyN,
          b: skyB / skyN,
        }
      : undefined;

  // -- OPTIONAL edge-softness gradient distribution (2026-07-05, EXPERIMENTAL): |dL|
  //    via central differences over the already-computed lumArr (dx/dy from the 4-
  //    neighborhood, halved — the standard central-difference step). A pixel
  //    qualifies only when (a) it is INTERIOR (border pixels lack a full
  //    neighborhood), (b) it AND all four neighbors are opaque — a transparent
  //    neighbor's lumArr entry is phantom cut-out data and would fabricate a hard
  //    edge along every alpha boundary (the fully-transparent fallback counts all
  //    pixels, same as the wb/grid/sky passes), and (c) its own luminance sits in
  //    the mid-tone band [GRAD_MID_LO, GRAD_MID_HI] — the shadow-boundary band.
  //    Percentiles reuse the fixed-bin histogram helper on the clamped-scaled 0..1
  //    magnitudes; the field attaches only past GRAD_MIN_PIXELS (see constants). --
  let grad: { p50: number; p90: number } | undefined;
  if (w >= 3 && h >= 3) {
    const gradVals = new Float64Array((w - 2) * (h - 2));
    let gradN = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!allTransparent) {
          // center + full 4-neighborhood must be opaque (see rationale above)
          if (!opaque[i] || !opaque[i - 1] || !opaque[i + 1] || !opaque[i - w] || !opaque[i + w])
            continue;
        }
        const L = lumArr[i];
        if (L < GRAD_MID_LO || L > GRAD_MID_HI) continue; // not a shadow-boundary tone
        const dx = (lumArr[i + 1] - lumArr[i - 1]) / 2;
        const dy = (lumArr[i + w] - lumArr[i - w]) / 2;
        const mag = Math.sqrt(dx * dx + dy * dy);
        gradVals[gradN++] = Math.min(mag, GRAD_CLAMP) / GRAD_CLAMP;
      }
    }
    if (gradN >= GRAD_MIN_PIXELS) {
      const [g50, g90] = percentilesFromHistogram(gradVals.subarray(0, gradN), [50, 90]);
      grad = { p50: g50, p90: g90 };
    }
  }

  return {
    lum: { p1, p5, p25, p50, p75, p95, p99, mean: lumMean },
    clip,
    contrast,
    wb,
    sat,
    grid,
    // conditional spread: the key is absent (not `undefined`) when no sky detected /
    // too few gradient pixels, so JSON round-trips and old-shape comparisons stay
    // byte-identical.
    ...(sky ? { sky } : {}),
    ...(grad ? { grad } : {}),
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

// ===========================================================================
// WB / exposure evidence (web-port addition, 2026-07-05) — pure, node-testable.
// Field feedback: recipes landed with white balance "way too off" because the model
// had to TRANSLATE warmth ratios into kelvin by feel. These helpers measure the
// numbers instead: a correlated color temperature (CCT) per image region via
// Rec.709 → XYZ → xy + McCamy's approximation, and the exposure gap in stops as
// log2 of the median-luminance ratio. Deterministic pixel math — the model then
// does arithmetic, not vibes. None of this feeds the look-distance score.
// ===========================================================================

// -- cctFromLinearRGB(r,g,b): CCT in kelvin from LINEAR Rec.709 channel means.
//    Returns null when the input carries no light (black) or the math degenerates.
//    McCamy is trustworthy roughly 2000K..25000K; the result is clamped to
//    [1000, 25000] and rounded to 50K (the precision the estimate honestly has). --
export function cctFromLinearRGB(r: number, g: number, b: number): number | null {
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  if (r < 0 || g < 0 || b < 0) return null;
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const sum = X + Y + Z;
  if (sum < 1e-9) return null; // black / no signal — no white point to estimate
  const x = X / sum;
  const y = Y / sum;
  const denom = 0.1858 - y;
  if (Math.abs(denom) < 1e-6) return null; // McCamy pole
  const n = (x - 0.332) / denom;
  const cct = 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
  if (!Number.isFinite(cct)) return null;
  const clamped = Math.min(25000, Math.max(1000, cct));
  return Math.round(clamped / 50) * 50;
}

// -- tintGMFromLinearRGB(r,g,b): the green↔magenta offset of a linear-mean region —
//    the white point's SECOND axis, orthogonal to CCT's blue↔amber. Normalized green
//    excess: (G − (R+B)/2) / (R+G+B); positive = greener, negative = more magenta,
//    0 = on the neutral axis. Deliberately the same G-vs-mean(R,B) construction as
//    the whole-image wb.tint stat, so the two never disagree in sign. Null on no
//    signal. Typical casts land within ±0.05. --------------------------------------
export function tintGMFromLinearRGB(r: number, g: number, b: number): number | null {
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  if (r < 0 || g < 0 || b < 0) return null;
  const sum = r + g + b;
  if (sum < 1e-9) return null;
  return Math.round(((g - (r + b) / 2) / sum) * 1e4) / 1e4;
}

/** The measured WB/exposure bundle appended to the model evidence. */
export interface WbExposureEvidence {
  wb_estimate_k: {
    reference_highlights: number | null;
    current_highlights: number | null;
    reference_shadows: number | null;
    current_shadows: number | null;
  };
  tint_gm: {
    reference_highlights: number | null;
    current_highlights: number | null;
    reference_shadows: number | null;
    current_shadows: number | null;
  };
  exposure_gap_ev: number | null;
}

// -- wbExposureEvidence(refM, curM): CCTs of each image's highlight/shadow linear
//    means + the EV gap (log2(ref median / current median); positive = the current
//    render is too dark by that many stops). Median guard: percentiles are BIN-CENTER
//    values, so a black frame's p50 floors at 0.5/HIST_BINS (never 0) — require the
//    median to clear the FIRST bin (> 1/HIST_BINS) to count as exposure signal. ----
export function wbExposureEvidence(refM: MetricVector, curM: MetricVector): WbExposureEvidence {
  const SIGNAL_MIN = 1 / HIST_BINS;
  const evGap =
    refM.lum.p50 > SIGNAL_MIN && curM.lum.p50 > SIGNAL_MIN
      ? Math.round(Math.log2(refM.lum.p50 / curM.lum.p50) * 100) / 100
      : null;
  return {
    wb_estimate_k: {
      reference_highlights: cctFromLinearRGB(refM.wb.highlight.r, refM.wb.highlight.g, refM.wb.highlight.b),
      current_highlights: cctFromLinearRGB(curM.wb.highlight.r, curM.wb.highlight.g, curM.wb.highlight.b),
      reference_shadows: cctFromLinearRGB(refM.wb.shadow.r, refM.wb.shadow.g, refM.wb.shadow.b),
      current_shadows: cctFromLinearRGB(curM.wb.shadow.r, curM.wb.shadow.g, curM.wb.shadow.b),
    },
    tint_gm: {
      reference_highlights: tintGMFromLinearRGB(refM.wb.highlight.r, refM.wb.highlight.g, refM.wb.highlight.b),
      current_highlights: tintGMFromLinearRGB(curM.wb.highlight.r, curM.wb.highlight.g, curM.wb.highlight.b),
      reference_shadows: tintGMFromLinearRGB(refM.wb.shadow.r, refM.wb.shadow.g, refM.wb.shadow.b),
      current_shadows: tintGMFromLinearRGB(curM.wb.shadow.r, curM.wb.shadow.g, curM.wb.shadow.b),
    },
    exposure_gap_ev: evGap,
  };
}

// ===========================================================================
// Scene evidence (web-port addition, 2026-07-05) — more pixel statistics projected
// onto knob-space, derived from MetricVectors (no score change; restored sessions
// keep working — the only NEW field read here, the optional `sky`, is null-guarded):
//   - light_centroid: where the light mass sits in frame, per image — the measured
//     version of "which side is the key on" (maps to sun azimuth/elevation + HDRI
//     rotation). x > 0 = right half brighter, y > 0 = LOWER half brighter; ±1 spans
//     the frame.
//   - key_fill_ratio: brightest-4 / darkest-4 grid-cell means, per image — measured
//     directionality (high = hard directional key, ~1 = flat ambient). Maps to sun
//     intensity vs dome/fill and the fills' key:fill ratio.
//   - anchors: ABSOLUTE per-image levels (the diff alone hides them): black point,
//     median, white point, clip fractions, saturation. Haze reads directly from
//     these (lifted p5 + dead clip_lo + lower sat = atmospheric depth, step 6).
//   - sky_estimate: the SKY region measured separately from the subject (per-side
//     null when no sky was detected) — level + white point of the detected sky, so
//     sky-model/HDRI/env intensity and sun-vs-sky color splits are arithmetic.
//     UNLIKE the other three, this reads the OPTIONAL MetricVector.sky field, which
//     persisted sessions from older versions LACK — the per-side null covers both
//     "no sky detected" and "old vector, never measured".
//   - edge_softness: EXPERIMENTAL shadow-softness proxy — each image's grad.p90
//     (90th-percentile mid-tone luminance gradient, scaled 0..1). Higher = crisper
//     edges = harder/smaller light source; lower = softer = bigger sun size mult /
//     larger area lights. DIRECTION ONLY — never derive magnitudes from it. Reads
//     the OPTIONAL MetricVector.grad field, so the same per-side-null contract as
//     sky_estimate applies (old vector / too few mid-tone pixels ⇒ null).
// ===========================================================================

export interface SkyEstimateSide {
  frac: number;
  mean_lum: number;
  cct_k: number | null;
  tint_gm: number | null;
}

export interface SceneEvidence {
  light_centroid: {
    reference: { x: number; y: number } | null;
    current: { x: number; y: number } | null;
  };
  key_fill_ratio: { reference: number | null; current: number | null };
  anchors: {
    reference: { p5: number; p50: number; p95: number; clip_hi: number; clip_lo: number; sat: number };
    current: { p5: number; p50: number; p95: number; clip_hi: number; clip_lo: number; sat: number };
  };
  sky_estimate: {
    reference: SkyEstimateSide | null;
    current: SkyEstimateSide | null;
  };
  edge_softness: { reference: number | null; current: number | null };
}

const CELL_CENTERS = [-0.75, -0.25, 0.25, 0.75]; // 4x4 grid row/col centers in -1..1

function gridCentroid(grid: number[]): { x: number; y: number } | null {
  let sum = 0,
    sx = 0,
    sy = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = grid[r * 4 + c];
      sum += v;
      sx += CELL_CENTERS[c] * v;
      sy += CELL_CENTERS[r] * v;
    }
  }
  if (sum < 1e-6) return null; // black frame — no light mass to locate
  return { x: Math.round((sx / sum) * 1e3) / 1e3, y: Math.round((sy / sum) * 1e3) / 1e3 };
}

function gridKeyFillRatio(grid: number[]): number | null {
  const sorted = [...grid].sort((a, b) => b - a);
  const key = (sorted[0] + sorted[1] + sorted[2] + sorted[3]) / 4;
  const fill = (sorted[12] + sorted[13] + sorted[14] + sorted[15]) / 4;
  if (key < 1e-6) return null; // no light at all
  if (fill < 1e-6) return 99; // pitch-black fill side — report the practical ceiling
  return Math.min(99, Math.round((key / fill) * 100) / 100);
}

function anchorsOf(m: MetricVector) {
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    p5: r4(m.lum.p5),
    p50: r4(m.lum.p50),
    p95: r4(m.lum.p95),
    clip_hi: r4(m.clip.hi),
    clip_lo: r4(m.clip.lo),
    sat: r4(m.sat.mean),
  };
}

// -- skyEstimateOf(m): project the optional MetricVector.sky field onto knob-space
//    (level + measured white point of the sky region). MUST tolerate vectors that
//    lack `.sky` entirely (persisted sessions from before 2026-07-05) and vectors
//    whose frac fell below the attach threshold — both read as null. Rounded to
//    1e-4 like the anchors; cct/tint helpers already round themselves. -------------
function skyEstimateOf(m: MetricVector): SkyEstimateSide | null {
  const sky = m.sky;
  if (!sky || !Number.isFinite(sky.frac) || sky.frac < SKY_MIN_FRAC) return null;
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    frac: r4(sky.frac),
    mean_lum: r4(sky.meanLum),
    cct_k: cctFromLinearRGB(sky.r, sky.g, sky.b),
    tint_gm: tintGMFromLinearRGB(sky.r, sky.g, sky.b),
  };
}

// -- edgeSoftnessOf(m): the EXPERIMENTAL shadow-softness proxy — the image's
//    grad.p90 (90th-percentile mid-tone |dL|, clamped-scaled 0..1). MUST tolerate
//    vectors that lack `.grad` entirely (persisted sessions from before this field
//    existed) and non-finite junk — both read as null. Rounded to 1e-4 like the
//    anchors so the JSON the model sees stays compact. ------------------------------
function edgeSoftnessOf(m: MetricVector): number | null {
  const g = m.grad;
  if (!g || !Number.isFinite(g.p90)) return null;
  return Math.round(g.p90 * 1e4) / 1e4;
}

export function sceneEvidence(refM: MetricVector, curM: MetricVector): SceneEvidence {
  return {
    light_centroid: { reference: gridCentroid(refM.grid), current: gridCentroid(curM.grid) },
    key_fill_ratio: { reference: gridKeyFillRatio(refM.grid), current: gridKeyFillRatio(curM.grid) },
    anchors: { reference: anchorsOf(refM), current: anchorsOf(curM) },
    sky_estimate: { reference: skyEstimateOf(refM), current: skyEstimateOf(curM) },
    edge_softness: { reference: edgeSoftnessOf(refM), current: edgeSoftnessOf(curM) },
  };
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
  MATCH_THRESHOLD,
  matchPercent,
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
