// LightMatch client adapter — the browser-side counterpart to the vanilla ADAPTER.
// In the vanilla single-file app, ADAPTER.call() fetched the omega gateway DIRECTLY
// from the page (key in the client's network log, CORS in play). In the Next.js port
// that network call moves SERVER-SIDE to /api/analyze (see app/api/analyze/route.ts);
// this module is the thin client shim the engine store calls instead.
//
// Responsibilities kept here (client side):
//   - buildUserContent(): pure content-assembly for the Messages `content` array
//     (ported VERBATIM from the vanilla ADAPTER.buildUserContent — no network, so it
//     stays on the client where the engine assembles the request).
//   - analyzeViaApi(): POST the assembled request to /api/analyze with the key in the
//     x-omega-key header, and return the validated recipe/correction or throw a typed
//     error. All gateway resilience + the schema re-ask live in the route, not here.
//
// Typed errors mirror the vanilla ADAPTER error taxonomy so the engine's
// _classifyError() can branch on `kind` exactly as before.

import { STORE, type Prior } from "./store";

// ---------------------------------------------------------------------------
// Typed client error. `kind` is the same small taxonomy the route returns and the
// engine switches on: auth | shape | network | truncated | invalid | other.
// ---------------------------------------------------------------------------
export type AdapterErrorKind =
  | "auth"
  | "shape"
  | "network"
  | "truncated"
  | "invalid"
  | "other";

export class AdapterError extends Error {
  kind: AdapterErrorKind;
  raw?: string;
  constructor(message: string, kind: AdapterErrorKind, raw?: string) {
    super(message);
    this.name = "AdapterError";
    this.kind = kind;
    this.raw = raw;
  }
}

// ---------------------------------------------------------------------------
// Image / content types (shared with the route request body shape).
// ---------------------------------------------------------------------------
export interface AdapterImage {
  role: "reference" | "base" | "settings" | "attempt";
  n?: number;
  dataUrl: string;
  mediaType: string;
}

export interface HistoryMove {
  param: string;
  from: number | string;
  to: number | string;
  applied: boolean;
  why?: string;
}
export interface HistoryRound {
  round: number;
  applied_assumed?: boolean;
  moves: HistoryMove[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

/** Calibration-probe evidence: the single-knob change the user re-rendered plus its
 *  MEASURED response vs the base render (engine addProbeRender). The text block is
 *  appended ONLY when the response exists — an armed-but-unrendered probe carries no
 *  evidence. Response channels are null when the pixels had no signal for them. */
export interface ProbeEvidence {
  param: string;
  from: number | string;
  to: number | string;
  response?: {
    d_ev: number | null;
    d_warmth_highlight: number | null;
    d_centroid_x: number | null;
    d_key_fill_ratio: number | null;
  } | null;
}

export interface BuildUserContentArgs {
  mode: "recipe" | "correction";
  images: AdapterImage[];
  metricsBundle: unknown;
  context?: Record<string, unknown>;
  history?: HistoryRound[];
  probe?: ProbeEvidence;
  /** OPTIONAL scene prior (2026-07-05): the settled values of a similar PAST session
   *  that reached the match gate (STORE.bestPrior). Emitted as a starting-bias text
   *  block — the measured evidence always outranks it on conflict. */
  prior?: Prior;
  /** OPTIONAL live 3ds Max settings (2026-07-05): the scene's ACTUAL current values
   *  pulled over the /api/max bridge. Emitted as a CURRENT SCENE SETTINGS block —
   *  the model's `from` baseline becomes ground truth instead of assumed defaults. */
  liveSettings?: {
    renderer: string;
    at: string;
    params: Record<string, number | string>;
  };
}

// -- buildUserContent(...): assembles the single user-turn `content` array for the
// Messages API. Pure/no network. Ported verbatim from the vanilla ADAPTER. ----------
//   Documented block order (alternating text/image; every image is immediately
//   preceded by its own labeling text block):
//     [label, image]* for every entry in `images`, in array order
//     -> evidence text block (units legend + JSON.stringify(metricsBundle))
//     -> context chips text block
//     -> (when a scene prior is supplied) PRIOR text block
//     -> (when a MEASURED probe is supplied) MEASURED SCENE RESPONSE text block
//     -> (correction mode only) move-history + applied-set text block
export function buildUserContent({
  mode,
  images,
  metricsBundle,
  context,
  history,
  probe,
  prior,
  liveSettings,
}: BuildUserContentArgs): ContentBlock[] {
  const content: ContentBlock[] = [];

  const LABELS = {
    reference: "REFERENCE:",
    base: "BASE RENDER:",
    settings: "SETTINGS SCREENSHOT (baseline):",
    attempt: (n: number) => `ATTEMPT ${n}:`,
  };

  for (const img of images || []) {
    const label =
      img.role === "attempt"
        ? LABELS.attempt(img.n as number)
        : LABELS[img.role] || `IMAGE (${img.role}):`;
    content.push({ type: "text", text: label });
    const base64 = img.dataUrl.includes(",")
      ? img.dataUrl.slice(img.dataUrl.indexOf(",") + 1)
      : img.dataUrl;
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: base64 },
    });
  }

  // Units legend prefixes the raw JSON so the model doesn't have to guess what a bare
  // "0.211" or "-0.03" means. diff direction line included, plus the GRID GEOMETRY legend
  // so the model can read the 4x4 map as a SPATIAL light-placement cue (the single most
  // important, easiest-to-miss match dimension).
  const legend =
    "COMPUTED EVIDENCE — deterministic, trust for magnitude. Units: luminance values are " +
    "linearized 0-1 (not sRGB 0-255); warmth* is (R-B)/(R+B) computed on linear channel means, positive = " +
    "warmer, negative = cooler, roughly +-0.05 ~= a few hundred kelvin; tint is positive = green, negative = " +
    "magenta. " +
    "diff is reference minus current (positive = reference is higher; move that way). " +
    "grid.0..15 is a 4x4 ROW-MAJOR mean-luminance map of the frame (grid.0 = top-left, grid.3 = top-right, " +
    "grid.12 = bottom-left, grid.15 = bottom-right). A left-vs-right imbalance means the key light is on the " +
    "wrong side (fix with sun azimuth / HDRI rotation); a top-vs-bottom imbalance means the sun elevation is wrong. " +
    "wb_estimate_k = MEASURED correlated color temperatures (McCamy, from each image's highlight/shadow linear " +
    "means; null = no signal): white balance is ARITHMETIC — if the reference highlights measure a LOWER CCT than " +
    "the current render's, the reference is warmer; close most of that kelvin gap with the step-1 WB move (in " +
    "BOTH hosts a HIGHER white-balance Temperature renders warmer/more amber), and trust highlight CCT over " +
    "shadow CCT (shadows are noisier). " +
    "tint_gm = MEASURED green–magenta offset per region (the white point's SECOND axis, orthogonal to CCT; " +
    "positive = greener, negative = more magenta, typical casts within ±0.05): close a tint gap with the " +
    "magenta-green tint control where the host has one (Vantage post.wb_tint: positive = greener), otherwise " +
    "fold it into the WB color-swatch instruction — temperature alone cannot fix a green/magenta cast. " +
    "exposure_gap_ev = MEASURED stops, log2(reference median / current median): positive = the render is that " +
    "many stops too dark — V-Ray: VFB Exposure +gap (or open the camera); Vantage: LOWER the camera Exposure " +
    "Value by the gap (higher EV = darker). " +
    "light_centroid = MEASURED per-image position of the light mass in frame (x>0 = right half brighter, " +
    "y>0 = LOWER half brighter, ±1 spans the frame): move the key/HDRI until the current centroid lands on the " +
    "reference's — the difference is your azimuth/rotation (x) and elevation (y) move. " +
    "key_fill_ratio = MEASURED directionality per image (brightest/darkest grid-cell means; ~1 = flat ambient, " +
    "high = hard directional key): a reference ratio above the current means raise key vs fill (sun up / dome " +
    "down), below means soften (dome up / sun down or bigger). " +
    "anchors = ABSOLUTE per-image levels (p5/p50/p95, clip fractions, saturation) — judge haze and burn from " +
    "these, not the diff alone: a reference with LIFTED p5, near-zero clip_lo and LOWER sat than the current " +
    "render is atmospheric depth (step 6 fog/haze), not an exposure problem. " +
    "sky_estimate = MEASURED over the detected sky region only (bright top-of-frame pixels; null = no sky " +
    "detected): drive sky-model / HDRI / environment intensity and sun-sky color decisions from its level and " +
    "CCT, and when the reference sky CCT differs from the subject highlight CCT (wb_estimate_k), SPLIT the fix " +
    "— sky/env color vs sun color — rather than one global WB move. " +
    "edge_softness = EXPERIMENTAL gradient-based proxy for shadow-edge crispness per image (90th-percentile " +
    "mid-tone luminance gradient, 0..1; null = not measured): higher = crisper edges = harder/smaller light " +
    "source, lower = softer = bigger sun size mult / larger area lights — use it for DIRECTION only, do not " +
    "compute magnitudes from it. " +
    "linear_evidence, when present, is SCENE-REFERRED (measured on the raw EXR linear pixels, pre-tonemap) and " +
    "OVERRIDES the display-referred estimates for exposure and highlight CCT: prefer its exposure_gap_ev_exact " +
    "over exposure_gap_ev and its highlight_cct_k over wb_estimate_k.";
  const round4 = (k: string, v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v;

  // SPATIAL-ASYMMETRY scalars derived from the diff grid, which is REFERENCE − CURRENT
  // (diffVectors(current, ref) — the same orientation the legend states for every diff
  // key). Row-major index = row*4 + col. These pre-chew the 4x4 map into two directional
  // numbers so the model doesn't have to eyeball 16 cells: a positive leftMinusRight
  // means the REFERENCE is brighter on the LEFT than the current render is — the key
  // must move toward the LEFT; a positive topMinusBottom means the reference is brighter
  // up top — RAISE the sun. (A 2026-07-05 review caught the previous prose reading this
  // as base−reference, steering the model's azimuth/elevation moves exactly backwards.)
  // Guarded — skipped entirely when the diff carries no grid.* keys.
  const diff = (metricsBundle as { diff?: Record<string, unknown> })?.diff;
  const gridVal = (r: number, c: number): number | null => {
    const v = diff ? diff[`grid.${r * 4 + c}`] : undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  let asymmetryLine = "";
  if (diff) {
    const cells: number[] = [];
    let complete = true;
    for (let r = 0; r < 4 && complete; r++) {
      for (let c = 0; c < 4; c++) {
        const v = gridVal(r, c);
        if (v === null) {
          complete = false;
          break;
        }
        cells.push(v);
      }
    }
    if (complete && cells.length === 16) {
      const at = (r: number, c: number) => cells[r * 4 + c];
      let left = 0,
        right = 0,
        top = 0,
        bottom = 0;
      for (let r = 0; r < 4; r++) {
        left += at(r, 0) + at(r, 1);
        right += at(r, 2) + at(r, 3);
      }
      for (let c = 0; c < 4; c++) {
        top += at(0, c) + at(1, c);
        bottom += at(2, c) + at(3, c);
      }
      const leftMinusRight = left / 8 - right / 8;
      const topMinusBottom = top / 8 - bottom / 8;
      const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
      asymmetryLine =
        `\nSPATIAL ASYMMETRY (reference − current): leftMinusRight=${r4(leftMinusRight)}, ` +
        `topMinusBottom=${r4(topMinusBottom)} — a positive leftMinusRight means the REFERENCE is brighter on ` +
        `the LEFT than the current render; move the key toward the LEFT (or rotate the HDRI so the key comes ` +
        `from the left). Positive topMinusBottom means the reference is brighter up top; RAISE the sun ` +
        `elevation. Negative values mean the opposite side/direction.`;
    }
  }

  content.push({
    type: "text",
    text: `${legend}\n${JSON.stringify(metricsBundle, round4)}${asymmetryLine}`,
  });

  if (context && Object.keys(context).length) {
    const chips = Object.entries(context)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    content.push({ type: "text", text: `SCENE CONTEXT — ${chips}` });
  }

  // CURRENT SCENE SETTINGS (live 3ds Max bridge): the ONLY block whose numbers come
  // from the running host application itself. It replaces the factory-defaults
  // assumption: every listed control's `from` is ground truth.
  if (liveSettings && liveSettings.params && Object.keys(liveSettings.params).length) {
    // Belt-and-suspenders (the STORE import boundary is the primary allow-list): cap the
    // rendered rows and clamp each value's length so a pre-existing/old persisted session
    // whose params slipped past sanitization can't blow up or overrun this high-trust block.
    const MAX_LIVE_ROWS = 64;
    const rows = Object.entries(liveSettings.params)
      .slice(0, MAX_LIVE_ROWS)
      .map(([k, v]) => `  ${k} = ${String(v).slice(0, 120)}`)
      .join("\n");
    content.push({
      type: "text",
      text:
        `CURRENT SCENE SETTINGS — read LIVE from 3ds Max (renderer: ${liveSettings.renderer}, ` +
        `pulled ${liveSettings.at}). These are the scene's ACTUAL current values; use them as the ` +
        `exact \`from\` value for every listed control and declare baseline:"settings_screenshot" ` +
        `(the live read supersedes factory defaults; controls NOT listed keep the pack default ` +
        `assumption):\n${rows}`,
    });
  }

  // PRIOR (scene memory): a similar PAST session's SETTLED values as a starting
  // bias. Deliberately positioned right after the context chips (the prior is keyed
  // BY those chips) and before the probe/history blocks so it reads as background,
  // not as measurement. Listed values are capped at 16 — a bias needs the headline
  // moves, not a full sheet — and the closing sentence keeps the trust ordering
  // explicit: measured evidence ALWAYS outranks a remembered landing zone.
  if (prior && Array.isArray(prior.values) && prior.values.length) {
    // Which context fields actually matched (same rule as STORE.bestPrior: exact
    // equality on non-empty strings) — named so the model knows WHY this past
    // session is considered similar.
    const matched: string[] = [];
    if (context && prior.context) {
      for (const [k, v] of Object.entries(context)) {
        if (typeof v === "string" && v !== "" && prior.context[k] === v) matched.push(k);
      }
    }
    const listed = prior.values
      .filter((v) => v && typeof v.param === "string")
      .slice(0, 16)
      .map((v) => `${v.param}=${v.value}`)
      .join(", ");
    const pct =
      typeof prior.matchPercent === "number" && Number.isFinite(prior.matchPercent)
        ? Math.round(prior.matchPercent)
        : 0;
    content.push({
      type: "text",
      text:
        `PRIOR — a similar past session (matching ${matched.join(", ") || "context"}) settled at ` +
        `~${pct}% with: ${listed}. Use as a starting bias; the measured evidence still wins on any conflict.`,
    });
  }

  // MEASURED SCENE RESPONSE (calibration probe): the user re-rendered with exactly
  // ONE knob changed and we measured what actually moved — the model must scale its
  // magnitudes by this real sensitivity instead of guessing the scene's response
  // curve. Channels with no signal print as n/a (never fabricate a number the pixels
  // didn't show). Appended only when a response exists (an armed-but-unrendered probe
  // has nothing to teach).
  if (probe && probe.response) {
    const r = probe.response;
    const fmt = (v: number | null | undefined) =>
      typeof v === "number" && Number.isFinite(v) ? String(v) : "n/a";
    content.push({
      type: "text",
      text:
        `MEASURED SCENE RESPONSE (calibration probe): changing ${probe.param} ` +
        `${probe.from}->${probe.to} moved: median ${fmt(r.d_ev)} EV, highlight warmth ` +
        `${fmt(r.d_warmth_highlight)}, light centroid x ${fmt(r.d_centroid_x)}, key:fill ` +
        `${fmt(r.d_key_fill_ratio)}. Scale every magnitude in your moves by this measured sensitivity.`,
    });
  }

  if (mode === "correction" && Array.isArray(history) && history.length) {
    const lines = [
      "MOVE HISTORY (prior rounds — do not reverse any move here by more than half; applied=false means the user skipped that row when re-rendering):",
    ];
    for (const round of history) {
      for (const mv of round.moves || []) {
        lines.push(
          `  round ${round.round}: ${mv.param} ${mv.from} -> ${mv.to} (applied: ${mv.applied}) — ${mv.why || ""}`.trimEnd()
        );
      }
    }
    content.push({ type: "text", text: lines.join("\n") });
  }

  return content;
}

// ---------------------------------------------------------------------------
// analyzeViaApi(...): POST the assembled request to /api/analyze and return the
// validated recipe/correction. The key travels in the x-omega-key header (never in
// the JSON body, never logged by the gateway from the client). Throws AdapterError
// with a typed `kind` on any failure.
// ---------------------------------------------------------------------------
export interface AnalyzeViaApiArgs {
  model: string;
  system: string;
  userContent: ContentBlock[];
  tool: unknown;
  mode: "recipe" | "correction";
  target: string;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export async function analyzeViaApi({
  model,
  system,
  userContent,
  tool,
  mode,
  target,
  fetchImpl,
}: AnalyzeViaApiArgs): Promise<Record<string, unknown>> {
  const doFetch = fetchImpl || fetch;
  let res: Response;
  try {
    res = await doFetch("/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-omega-key": STORE.key(),
      },
      body: JSON.stringify({ model, system, userContent, tool, mode, target }),
    });
  } catch (e) {
    // The POST to our OWN route failed (offline, dev server down) — network kind.
    throw new AdapterError(
      "Could not reach the analyze endpoint: " + ((e as Error)?.message || String(e)),
      "network"
    );
  }

  let body: { ok?: boolean; recipe?: Record<string, unknown>; error?: { kind?: AdapterErrorKind; message?: string; raw?: string } };
  try {
    body = await res.json();
  } catch {
    throw new AdapterError(
      `Analyze endpoint returned a non-JSON response (HTTP ${res.status}).`,
      "other"
    );
  }

  if (body && body.ok && body.recipe) {
    return body.recipe;
  }

  // Route reported a typed failure — surface it as the same kind.
  const err = body?.error || {};
  const kind: AdapterErrorKind = err.kind || "other";
  throw new AdapterError(err.message || `Analyze failed (HTTP ${res.status}).`, kind, err.raw);
}

export default { buildUserContent, analyzeViaApi, AdapterError };
