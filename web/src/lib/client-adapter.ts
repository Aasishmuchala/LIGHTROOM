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
  // "0.211" or "-0.03" means. diff direction line included.
  const legend =
    "COMPUTED EVIDENCE — deterministic, trust for magnitude. Units: luminance values are " +
    "linearized 0-1 (not sRGB 0-255); warmth* is (R-B)/(R+B) computed on linear channel means, positive = " +
    "warmer, negative = cooler, roughly +-0.05 ~= a few hundred kelvin; tint is positive = green, negative = " +
    "magenta. " +
    "diff is reference minus current (positive = reference is higher; move that way).";
  const round4 = (k: string, v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v;
  content.push({
    type: "text",
    text: `${legend}\n${JSON.stringify(metricsBundle, round4)}`,
  });

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
