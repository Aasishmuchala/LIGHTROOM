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

import { STORE } from "./store";

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

export interface BuildUserContentArgs {
  mode: "recipe" | "correction";
  images: AdapterImage[];
  metricsBundle: unknown;
  context?: Record<string, unknown>;
  history?: HistoryRound[];
}

// -- buildUserContent(...): assembles the single user-turn `content` array for the
// Messages API. Pure/no network. Ported verbatim from the vanilla ADAPTER. ----------
//   Documented block order (alternating text/image; every image is immediately
//   preceded by its own labeling text block):
//     [label, image]* for every entry in `images`, in array order
//     -> evidence text block (units legend + JSON.stringify(metricsBundle))
//     -> context chips text block
//     -> (correction mode only) move-history + applied-set text block
export function buildUserContent({
  mode,
  images,
  metricsBundle,
  context,
  history,
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
    "wrong side (fix with sun azimuth / HDRI rotation); a top-vs-bottom imbalance means the sun elevation is wrong.";
  const round4 = (k: string, v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v;

  // SPATIAL-ASYMMETRY scalars derived from the diff grid (base − reference). Row-major
  // index = row*4 + col. These pre-chew the 4x4 map into two directional numbers so the
  // model doesn't have to eyeball 16 cells: a positive leftMinusRight means the BASE has
  // too much light on the LEFT vs the reference (move the key right / rotate HDRI); a
  // positive topMinusBottom means too much light up top (lower the sun elevation). Guarded
  // — skipped entirely when the diff carries no grid.* keys.
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
        `\nSPATIAL ASYMMETRY (base − reference): leftMinusRight=${r4(leftMinusRight)}, ` +
        `topMinusBottom=${r4(topMinusBottom)} — a positive leftMinusRight means the base render has too much ` +
        `light on the LEFT vs the reference; move the key toward the right (raise sun azimuth) or rotate the ` +
        `HDRI. Positive topMinusBottom means too much light up top; lower the sun elevation.`;
    }
  }

  content.push({
    type: "text",
    text: `${legend}\n${JSON.stringify(metricsBundle, round4)}${asymmetryLine}`,
  });

  // Convergence feedback (correction mode only, round 2+): tell the model which
  // per-key diff SHANK between the previous attempt and this one, so it can prune
  // moves that closed the gap (no-op now) or pushed it the wrong way (worsened).
  // Without this, the refine loop oscillates because the model only sees the snapshot —
  // it has no way to tell whether a prior move helped.
  const prevDiff =
    (metricsBundle as { prevDiff?: Record<string, unknown> })?.prevDiff;
  const currDiff =
    (metricsBundle as { diff?: Record<string, unknown> })?.diff;
  if (
    mode === "correction" &&
    prevDiff &&
    currDiff &&
    typeof prevDiff === "object" &&
    typeof currDiff === "object"
  ) {
    const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
    const lines: string[] = [
      "CONVERGENCE (previous attempt − this attempt): positive = that key CLOSED the gap (no further push needed); negative = that key WORSENED (reverse or skip it).",
    ];
    for (const key of Object.keys(currDiff).sort()) {
      const prev = Number(prevDiff[key]);
      const curr = Number(currDiff[key]);
      if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
      const delta = prev - curr; // positive means "got closer to ref"
      if (Math.abs(delta) < 1e-4) continue; // skip near-zero keys (no signal)
      lines.push(`  ${key}: ${r4(delta)}`);
    }
    if (lines.length > 1) content.push({ type: "text", text: lines.join("\n") });
  }

  if (context && Object.keys(context).length) {
    const chips = Object.entries(context)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    content.push({ type: "text", text: `SCENE CONTEXT — ${chips}` });
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
