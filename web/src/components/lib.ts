// UI-side pure helpers + constants for the LightMatch React components. These mirror
// the vanilla UI module's pure pieces (MODELS, acceptsFile, safeSrc, buildSheet,
// buildSheetText, routePaste, isRecipeApplied) — kept as one testable module the
// components import. No engine logic is reimplemented here; buildSheet reads through
// the pack scaffold exactly as the vanilla source did.

import { STORE } from "@/lib/store";
import { PACKS } from "@/lib/packs";
import type { Recipe, Correction, TargetId, SheetGroup } from "@/lib/types";
import type { EngineState, LastError } from "@/store/useEngine";

// -- The two gateway model options (verbatim from the vanilla UI.MODELS). ----------
export const MODELS = [
  { value: "claude-opus-4-8", label: "Opus 4.8" },
  { value: "gpt-5.5", label: "GPT-5.5" },
] as const;

// -- Target renderer labels for the header toggle. --------------------------------
export const TARGETS = [
  { value: "vray7max", label: "V-Ray 7" },
  { value: "vantage33", label: "Vantage 3.3" },
] as const;

// -- Named input slots (Reference, Base render, Settings screenshot). --------------
export const SLOT_DEFS = [
  { key: "ref", label: "Reference", hint: "the look you want" },
  { key: "base", label: "Base render", hint: "your render now" },
  { key: "settings", label: "Settings screenshot", hint: "optional anchor" },
] as const;

// -- Context chips. The FULL time-of-day set the user asked for (single-select). ---
export const CHIP_GROUPS = [
  { key: "scene", label: "Scene", options: ["interior", "exterior", "product"] },
  {
    key: "time",
    label: "Time",
    options: [
      "dawn",
      "sunrise",
      "morning",
      "midday",
      "afternoon",
      "golden hour",
      "sunset",
      "dusk",
      "blue hour",
      "night",
    ],
  },
  { key: "rig", label: "Rig", options: ["HDRI dome", "sun", "both"] },
] as const;

// -- Step vocabulary (the model's fixed order; canonical human names). -------------
export const STEP_HEADERS: Record<number, string> = {
  1: "Lock exposure & white balance",
  2: "Sun / key",
  3: "Environment / dome",
  4: "Fills & rim",
  5: "Color mapping",
  6: "Atmosphere / weather",
};

// -- File accept: the three canvas-decodable types PLUS EXR (decoded + developed
// client-side). EXR carries an empty MIME in every browser, so it is matched by the
// .exr filename extension here (the store additionally verifies the EXR magic bytes
// before decoding). The reject message now names only the genuinely-unsupported
// formats and notes EXR is developed automatically. -------------------------------
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
// EXR MIME is inconsistent/empty across browsers; accept these if a file ever reports one.
export const EXR_TYPES = ["image/x-exr", "image/aces", "image/exr"];
export const REJECT_MESSAGE =
  "LightMatch reads PNG, JPG, or WebP from the VFB/Vantage — or a linear EXR, which is developed to a viewable exposure automatically. Formats like HEIC, TIFF, or PSD aren't supported; export one of those instead.";

/** True if a filename ends in .exr (case-insensitive). Mirrors lib/exr hasExrExtension,
 *  kept local so this pure UI helper has no client-only import. */
export function isExrName(name: string | null | undefined): boolean {
  return typeof name === "string" && /\.exr$/i.test(name.trim());
}

export function acceptsFile(
  file: { type?: string; name?: string } | null | undefined
): { ok: boolean; reason: string } {
  const type = (file && file.type) || "";
  const name = (file && file.name) || "";
  if (ACCEPTED_TYPES.includes(type)) return { ok: true, reason: "" };
  if (EXR_TYPES.includes(type) || isExrName(name)) return { ok: true, reason: "" };
  return { ok: false, reason: REJECT_MESSAGE };
}

// -- safeSrc: only a clean base64 image data URL reaches an <img src>. Reuses the
// STORE regex so the sink and the import boundary can never diverge. --------------
export function safeSrc(u: unknown): string {
  return typeof u === "string" && STORE.DATAURL_RE.test(u) ? u : "";
}

// -- isRecipeApplied: checked unless the chain explicitly records false. -----------
export function isRecipeApplied(
  chain: { recipeApplied?: Record<string, boolean> | null } | null,
  param: string
): boolean {
  return !(chain && chain.recipeApplied && chain.recipeApplied[param] === false);
}

// -- routePaste: pure paste/drop routing (verbatim logic from the vanilla source). -
export function routePaste(
  state: EngineState,
  focusedSlot: string | null,
  filled: { ref: boolean; base: boolean; settings: boolean }
): "ref" | "base" | "settings" | "attempt" | null {
  const midSession =
    (state === "analyzed" || state === "refining") && !!filled.ref && !!filled.base;
  if (focusedSlot === "attempt") return "attempt";
  if (focusedSlot) {
    const focusedIsEmptyNamed = filled[focusedSlot as "ref" | "base" | "settings"] === false;
    if (focusedIsEmptyNamed) return focusedSlot as "ref" | "base" | "settings";
    if (!midSession) return focusedSlot as "ref" | "base" | "settings";
  }
  if (!filled.ref) return "ref";
  if (!filled.base) return "base";
  if (!filled.settings) return "settings";
  if (state === "analyzed" || state === "refining") return "attempt";
  return null;
}

// -- cached pack scaffold per target. PACKS.sheet(target) is pure/deterministic but
// builds a fresh array each call; caching it gives a STABLE reference so it can be
// used directly in a zustand selector without looping useSyncExternalStore. --------
const _scaffoldCache = new Map<string, SheetGroup[]>();
export function sheetForTarget(target: TargetId | string): SheetGroup[] {
  const key = String(target);
  let s = _scaffoldCache.get(key);
  if (!s) {
    s = PACKS.sheet(target);
    _scaffoldCache.set(key, s);
  }
  return s;
}

// -- A single sheet row: the completeness unit (shape stable whether changed or held).
export interface SheetRow {
  group: string;
  param: string;
  ui_path: string;
  kind: string;
  unit: string;
  lighting: boolean;
  value: number | string;
  isChanged: boolean;
  from?: number | string;
  confidence?: string;
  why?: string;
  clamped: boolean;
  applied: boolean | null;
  /** OPTIONAL consensus agreement count (2026-07-05 addition): carried through from a
   *  Consensus ×3 merged recipe's value. Absent on single-call recipes and on rows
   *  built from older persisted sessions — consumers must null-guard. */
  consensus_n?: number;
}

// -- buildSheet(target, recipe, chain): the COMPLETE settings sheet as flat ordered
// rows. Walks PACKS.sheet(target) (via a passed scaffold) and emits one row per
// control — changed rows carry the move, held rows carry the pack default. Pure. ---
export function buildSheet(
  scaffold: SheetGroup[],
  recipe: Recipe | Correction | null | undefined,
  chain: { recipeApplied?: Record<string, boolean> | null } | null
): SheetRow[] {
  const r = (recipe || {}) as Partial<Recipe & Correction>;
  const isCorrection = Array.isArray(r.moves);
  const moves = (isCorrection ? r.moves! : Array.isArray(r.values) ? r.values : []) as unknown as Record<
    string,
    unknown
  >[];
  const valKey = isCorrection ? "to" : "set";
  const byParam = new Map<string, Record<string, unknown>>();
  for (const m of moves) {
    if (m && typeof m.param === "string" && !byParam.has(m.param)) byParam.set(m.param, m);
  }
  const rows: SheetRow[] = [];
  for (const band of scaffold) {
    for (const e of band.entries) {
      const move = byParam.get(e.id) || null;
      if (move) {
        rows.push({
          group: band.group,
          param: e.id,
          ui_path: e.ui_path,
          kind: e.kind,
          unit: e.unit || "",
          lighting: e.lighting === true,
          value: move[valKey] as number | string,
          isChanged: true,
          from: move.from as number | string,
          confidence: move.confidence as string,
          why: move.why as string,
          clamped: !!move.clamped,
          applied: isCorrection ? true : isRecipeApplied(chain, e.id),
          // Consensus agreement count rides through ONLY when it is a real number —
          // single-call recipes / old sessions never grow a phantom field here.
          ...(typeof move.consensus_n === "number"
            ? { consensus_n: move.consensus_n as number }
            : {}),
        });
      } else {
        rows.push({
          group: band.group,
          param: e.id,
          ui_path: e.ui_path,
          kind: e.kind,
          unit: e.unit || "",
          lighting: e.lighting === true,
          value: e.default,
          isChanged: false,
          clamped: false,
          applied: null,
        });
      }
    }
  }
  return rows;
}

// -- buildSheetText(target, recipe, chain): human-readable copy of the full sheet. --
export function buildSheetText(
  target: TargetId | string,
  scaffold: SheetGroup[],
  recipe: Recipe | null | undefined,
  chain: { recipeApplied?: Record<string, boolean> | null } | null
): string {
  const pack = (PACKS as unknown as Record<string, { label: string } | undefined>)[target];
  const label = pack ? pack.label : String(target);
  const r = (recipe || {}) as Partial<Recipe>;
  const lines = [`${label} — LightMatch settings sheet`];
  const baselineText =
    r.baseline === "settings_screenshot" ? "settings screenshot" : "factory defaults";
  lines.push(`baseline: ${baselineText}`);
  const rows = buildSheet(scaffold, recipe, chain);
  const order: string[] = [];
  const byGroup = new Map<string, SheetRow[]>();
  for (const row of rows) {
    if (!byGroup.has(row.group)) {
      byGroup.set(row.group, []);
      order.push(row.group);
    }
    byGroup.get(row.group)!.push(row);
  }
  for (const group of order) {
    const groupRows = byGroup.get(group)!;
    const changed = groupRows.filter((row) => row.isChanged).length;
    lines.push("");
    lines.push(`${group}  (${changed} changed · ${groupRows.length} total)`);
    for (const row of groupRows) {
      const unit = row.unit && typeof row.value === "number" ? row.unit : "";
      const isPlacement = row.kind === "placement";
      if (!row.isChanged) {
        lines.push(`· ${row.ui_path}: ${row.value}${unit}`);
      } else if (isPlacement) {
        const why = row.why ? ` — ${row.why}` : "";
        lines.push(`→ ${row.ui_path}: ${row.value}${why}`);
      } else {
        const why = row.why ? ` — ${row.why}` : "";
        lines.push(`→ ${row.ui_path}: ${row.value}${unit} (from ${row.from})${why}`);
      }
    }
  }
  return lines.join("\n");
}

// -- clipboard copy with a file:// fallback (navigator.clipboard is often blocked
// off-https). Never throws past the caller. ---------------------------------------
export async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    /* clipboard failure is a minor annoyance, not a crash */
  }
}

// -- downloadText: save a string as a file via Blob + a.download (the export buttons'
// sink; the CONTENT comes from the pure lib/export formatters). Object URL is revoked
// on the next tick — revoking synchronously races the click navigation in some
// browsers. Never throws past the caller (same contract as copyText above). ---------
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {
    /* a failed download is a minor annoyance, not a crash */
  }
}

// -- split a verbatim ui_path into breadcrumb segments (last = leaf). --------------
export function splitPath(uiPath: string): { segs: string[]; leaf: string } {
  const parts = String(uiPath).split(" ▸ ");
  const leaf = parts.pop() || uiPath;
  return { segs: parts, leaf };
}

/* ============================================================================
   Refine-ledger DIFF HEATMAP — pure math only; rendering lives in RefineLedger.
   Maps the per-cell luminance delta between an attempt's 4x4 grid and the
   reference's (MetricVector.grid: mean linear luminance, row-major) to a signed
   overlay intensity. Contract per cell (diff = attempt - ref):
     sign :  1 attempt BRIGHTER than ref, -1 darker, 0 within noise (|diff| <
             HEAT_NOISE_FLOOR — rendered fully transparent so a matched cell
             stays quiet).
     mag  : |diff| / HEAT_FULL_DELTA clamped to [0,1] — a 0.15 mean-luminance
             delta (or more) saturates the tint.
   The renderer multiplies mag by HEAT_ALPHA_MAX for the cell's rgba alpha.
   ============================================================================ */

/** Linear-luminance delta that renders at FULL tint intensity (mag = 1). */
export const HEAT_FULL_DELTA = 0.15;
/** Deltas below this read as "same" — sign 0, cell stays transparent. */
export const HEAT_NOISE_FLOOR = 0.01;
/** Overlay tint alpha at mag = 1 (kept quiet so the thumbnail stays readable). */
export const HEAT_ALPHA_MAX = 0.45;

export interface HeatCell {
  sign: -1 | 0 | 1;
  mag: number;
}

/** Per-cell heat for the attempt-vs-reference grid overlay. SAFETY: persisted
 *  sessions from older versions may lack `.grid`, and a decode bug could yield
 *  odd lengths — any non-array input or a length mismatch returns [] so the
 *  overlay simply does not render; never throws. Non-finite entries collapse to
 *  a neutral cell for the same reason. */
export function gridHeatCells(
  refGrid: readonly number[] | null | undefined,
  attemptGrid: readonly number[] | null | undefined
): HeatCell[] {
  if (!Array.isArray(refGrid) || !Array.isArray(attemptGrid)) return [];
  if (refGrid.length !== attemptGrid.length) return [];
  const cells: HeatCell[] = [];
  for (let i = 0; i < refGrid.length; i++) {
    const diff = attemptGrid[i] - refGrid[i];
    if (!Number.isFinite(diff)) {
      cells.push({ sign: 0, mag: 0 }); // corrupt cell -> transparent, not NaN alpha
      continue;
    }
    const abs = Math.abs(diff);
    cells.push({
      sign: abs < HEAT_NOISE_FLOOR ? 0 : diff > 0 ? 1 : -1,
      mag: Math.min(1, abs / HEAT_FULL_DELTA),
    });
  }
  return cells;
}

/* ============================================================================
   ERROR-BANNER COPY — pure copy chooser for ErrorBanner (extracted so the
   wording contracts, especially the auth split below, are pinnable in tests).
   Recognizable, not loud: each typed error kind gets a calm, specific line.
   ============================================================================ */

export function errorBannerCopy(err: LastError): { title: string; detail: string; raw?: string } {
  switch (err.kind) {
    case "auth":
      // A 401-shaped failure has two very different stories: the gateway REJECTED
      // the key, or our own route refused to call out because NO key was sent at
      // all. The old hardcoded "Key rejected" line lied to a user who simply
      // hadn't pasted a key yet (stress finding UX-1, 2026-07-13) — when the
      // route's message says the key is missing, say that, in its own words.
      if (err.message && /no api key/i.test(err.message)) {
        return { title: "No key yet", detail: err.message };
      }
      return { title: "Key rejected", detail: "The gateway returned 401. Check your oc_ key and try again." };
    case "network":
      return {
        title: "Gateway error",
        // Surface the route's ACTUAL reason (e.g. "Gateway request failed: HTTP 529 — …"
        // or a timeout) instead of a static line — a network kind covers a timeout, a
        // dropped socket, AND a retried 5xx, and the specific message is the whole point.
        detail: err.message || "The request failed to reach the gateway — a timeout or a dropped connection, retried 3 times.",
        raw: err.raw,
      };
    case "truncated":
      return { title: "Response cut short", detail: "The model hit its token cap mid-recipe. Try again, or narrow the scene context." };
    case "shape":
      return {
        title: "Unexpected response",
        detail: "The model replied without a structured recipe. This is usually transient; try Analyze again.",
        raw: err.raw,
      };
    case "invalid":
      return { title: "Recipe failed validation", detail: err.message || "The model's recipe didn't fit the pack contract, twice." };
    case "decode":
      return { title: "Couldn't read that image", detail: err.message || REJECT_MESSAGE };
    case "busy":
      return { title: "Already working", detail: "An analyze or refine call is in flight. One moment." };
    default:
      return { title: "Something went wrong", detail: err.message || "An unexpected error occurred." };
  }
}

/* ============================================================================
   EXR EXPOSURE COMMIT QUEUE — pure scheduling for the DropSlot EV slider
   (stress finding C5, 2026-07-13). A range input fires onChange on EVERY
   0.1-EV drag tick, and each engine commit is a FULL-resolution redevelop +
   JPEG re-encode + re-measure + IndexedDB persist — seconds per tick on a 4K
   EXR, with overlapping async commits able to land out of order (last-write-
   loses). This queue gives the slider two guarantees:

     debounce   : one trailing commit per pause in the drag (EV_COMMIT_DELAY_MS),
                  always carrying the NEWEST requested EV — never one per tick.
     serialize  : commits never overlap. A monotonic request counter (`seq`)
                  marks the newest ask; a commit dispatches only when none is in
                  flight, and on completion re-dispatches iff a newer ask landed
                  meanwhile (trailing-throttle during a long drag over a slow
                  redevelop). With no overlap, a stale result can never commit
                  after a newer one.

   Framework-free on purpose: the component holds it in a ref and keeps its own
   optimistic slider value, so dragging feels instant while commits trail.
   ============================================================================ */

/** Trailing delay before a drag pause commits. 150–250ms reads as "instant settle"
 *  while collapsing a 30-tick drag into one redevelop. */
export const EV_COMMIT_DELAY_MS = 200;

export interface EvCommitQueue {
  /** Record the newest requested EV and (re)arm the trailing delay. */
  request(ev: number): void;
  /** True while a request is waiting on the delay or a commit is in flight. */
  pending(): boolean;
  /** Drop any queued (not-yet-dispatched) request; an in-flight commit finishes but
   *  will not re-dispatch. The queue stays usable for future requests. */
  cancel(): void;
}

export function createEvCommitQueue(
  commit: (ev: number) => unknown,
  delayMs: number = EV_COMMIT_DELAY_MS
): EvCommitQueue {
  let seq = 0; // monotonic request counter — bumped on every ask; the serialization spine
  let sentSeq = 0; // the ask the most recent dispatch was newest-as-of
  let latestEv = 0; // value of the newest ask (only ever read at dispatch time)
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const dispatch = (): void => {
    const mySeq = (sentSeq = seq);
    const ev = latestEv;
    inFlight = true;
    Promise.resolve()
      .then(() => commit(ev))
      .catch(() => {
        /* the commit sink owns error surfacing (the store's lastError banner);
           a failed commit must not wedge the queue */
      })
      .then(() => {
        inFlight = false;
        // A newer ask landed while this commit ran AND its trailing delay already
        // elapsed (no timer armed) — send it now. Because commits never overlap,
        // the last commit to run is by construction the newest ask.
        if (seq !== mySeq && timer === null) dispatch();
      });
  };

  return {
    request(ev: number): void {
      latestEv = ev;
      seq += 1;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (inFlight) return; // the in-flight completion re-dispatches the newest ask
        if (seq !== sentSeq) dispatch();
      }, delayMs);
    },
    pending(): boolean {
      return timer !== null || inFlight;
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      seq = sentSeq; // the in-flight completion (if any) sees nothing newer to send
    },
  };
}
