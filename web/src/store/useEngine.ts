// LightMatch engine store — the Next.js/React port of the vanilla ENGINE state machine
// (lightmatch.html, SECTION: ENGINE). Built on zustand/vanilla `createStore` so the
// exact same store object is:
//   - node-testable (no React, no DOM required to exercise the state machine — tests
//     inject a stubbed client adapter and pre-measured images), and
//   - usable from React via the `useEngine` hook (zustand's `useStore`) in the next
//     phase's UI, with selector subscriptions.
//
// Dependency graph mirrors the vanilla ENGINE -> {METRICS, PACKS, SCHEMAS, STORE,
// client-adapter}. It never touches the DOM directly except through METRICS' browser
// wrappers (downscaleForSend / measure), which are only reached from setImage/
// addAttempt at runtime — the pure state transitions have no DOM dependency.
//
// State machine: empty -> ready (ref+base) -> analyzed(target) -> refining(target),
// DERIVED from the session on every read (state()) so it can never drift out of sync.
//
// Key adaptations from vanilla:
//   - The gateway call moves server-side: instead of ADAPTER.call(...), analyze()/
//     addAttempt() build the request and call analyzeViaApi(...) (client-adapter.ts),
//     which POSTs to /api/analyze. The route does the schema re-ask.
//   - Phase B renamed METRICS.diff -> diffVectors and METRICS.score -> scoreVectors;
//     this store calls those names (the vanilla names do not exist in the lib).
//   - Errors carry a typed `lastError {kind, ...}` cleared on success, exactly as the
//     vanilla ENGINE.lastError contract.

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import {
  measure,
  downscaleForSend,
  diffVectors,
  scoreVectors,
  wbExposureEvidence,
  sceneEvidence,
  matchPercent,
  MATCH_THRESHOLD,
  type DrawableSource,
} from "@/lib/metrics";
import { decodeExrFile, isExrFile } from "@/lib/exr";
import {
  developExr,
  autoExposureEV,
  EV_MIN,
  EV_MAX,
  linearStats,
  linearEvidence,
  type LinearStats,
} from "@/lib/develop";
import { PACKS } from "@/lib/packs";
import { scopeOf } from "@/lib/scope";
import { checkinEvidence, type CheckinEvidence } from "@/lib/chat-digest";
import { systemPrompt, validateRecipe, EMIT_RECIPE, EMIT_CORRECTION } from "@/lib/schemas";
import { STORE, type StoredSession } from "@/lib/store";
import {
  buildUserContent,
  analyzeViaApi,
  AdapterError,
  type AdapterErrorKind,
  type AdapterImage,
  type HistoryRound,
} from "@/lib/client-adapter";
import type {
  TargetId,
  MetricVector,
  Recipe,
  Correction,
  PackEntry,
  SheetGroup,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Session / chain shapes (the runtime session the store owns).
// ---------------------------------------------------------------------------
export interface ImageSlot {
  dataUrl: string;
  metrics: MetricVector;
}

/** In-memory (NON-persisted) state for a slot whose source file was an EXR. Holds the
 *  retained scene-referred linear buffer so exposure can be re-applied without
 *  re-decoding, plus the developed EV and dimensions. Kept OUT of the persisted session
 *  (a raw Float32Array is huge and IndexedDB should not hold it; the developed sRGB
 *  dataUrl is what persists). Rebuilding this requires re-dropping the EXR after a
 *  reload — the developed thumbnail/metrics survive; only the live exposure slider does
 *  not. */
export interface ExrSlotState {
  linear: Float32Array;
  width: number;
  height: number;
  ev: number;
  /** Scene-referred statistics of the RETAINED linear buffer (develop.linearStats).
   *  Exposure-INDEPENDENT — EV gain is applied at develop time, the buffer itself never
   *  changes — so it is computed ONCE at decode and carried through re-develops.
   *  Optional with null-guards at every read: slot state injected by older tests/tools
   *  may lack it, and a slot without stats simply contributes no linear evidence. */
  stats?: LinearStats;
}
export const EXR_SLOTS = ["ref", "base", "settings"] as const;
export type ExrSlotName = (typeof EXR_SLOTS)[number];
export interface AttemptEntry {
  dataUrl: string;
  metrics: MetricVector;
  score: number;
  correction: Correction;
  appliedParams: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Expert-chat state (2026-07-13 addition): the "operator line" conversation is
// part of the session so it persists with it (IndexedDB + export/import; the
// import boundary sanitizes it — see STORE._sanitizeImportedChat). A check-in
// turn carries the measured render payload: the downscaled dataUrl (same
// captureSlot output attempts store), the deterministic score, and the evidence
// text that was shown to the model — so a reload can rebuild the exact wire
// history. Older persisted sessions LACK session.chat — every consumer
// null-guards.
// ---------------------------------------------------------------------------
export const CHAT_CAP = 40;
export interface ChatCheckin {
  dataUrl: string;
  score: number;
  matchPercent: number;
  evidenceText: string;
}
export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  at: string;
  checkin?: ChatCheckin;
}
export interface ChatCheckinResult {
  message: ChatMsg;
  evidence: CheckinEvidence;
  /** The measured image, reusable as addAttempt input without re-decoding. */
  preCaptured: PreCaptured;
}

// ---------------------------------------------------------------------------
// Calibration probe (2026-07-05 addition): after the initial recipe the user can
// re-render with ONE knob changed (the probe) so corrections are scaled by the
// scene's MEASURED sensitivity to that knob instead of the model's guess. The probe
// render is NOT an attempt — it never scores, never becomes a history round, never
// ticks _attemptCount; it exists only to produce the response deltas below.
// ---------------------------------------------------------------------------
/** The measured scene response to the ONE probed knob: probe render vs the BASE
 *  render, per channel. Each channel is null when the pixels carry no signal for it
 *  (black frame, degenerate grid) — the SAME guards wbExposureEvidence/sceneEvidence
 *  use, so a null here can never be a fabricated number. */
export interface ProbeResponse {
  /** log2(probe median / base median) in stops; positive = the probe render came out brighter. */
  d_ev: number | null;
  /** probe wb.warmthHighlight − base's ((R−B)/(R+B) on highlight linear means). */
  d_warmth_highlight: number | null;
  /** light-centroid x shift (probe − base) in −1..1 frame units; positive = light mass moved right. */
  d_centroid_x: number | null;
  /** key:fill ratio shift (probe − base); positive = the probe render is more directional. */
  d_key_fill_ratio: number | null;
}
/** A single-knob probe instruction: re-render with ONLY `param` changed from → to. */
export interface ProbeSuggestion {
  param: string;
  from: number;
  to: number;
}
/** The armed probe on a chain, plus (once the probe render lands) its measured response. */
export interface ProbeState extends ProbeSuggestion {
  response?: ProbeResponse;
}

export interface Chain {
  recipe: Recipe | null;
  attempts: AttemptEntry[];
  _attemptCount: number;
  recipeApplied?: Record<string, boolean> | null;
  _evictedScores?: { score: number }[];
  /** OPTIONAL calibration probe (2026-07-05 addition). Persisted sessions from
   *  older versions LACK this field — every consumer must null-guard. */
  probe?: ProbeState | null;
}
/** Settings pulled LIVE from a running 3ds Max via /api/max (2026-07-05 addition).
 *  Persisted with the session; older sessions LACK this field — null-guard reads. */
export interface LiveSettings {
  renderer: string;
  at: string;
  counts: { suns: number; vrayLights: number; physCams: number };
  params: Record<string, number | string>;
}
export interface Session {
  id: string;
  created: string;
  context: { scene: string; time: string; rig: string; [k: string]: string };
  ref: ImageSlot | null;
  base: ImageSlot | null;
  settingsShot: { dataUrl: string } | null;
  activeTarget: TargetId | string;
  chains: Record<string, Chain>;
  liveSettings?: LiveSettings | null;
  /** Expert-chat transcript; optional — older persisted sessions lack it. */
  chat?: { messages: ChatMsg[] } | null;
  /** Area mode (2026-07-13, big projects): scene GLOBALS are locked — analyses and
   *  corrections may move only per-camera + local-light controls; global moves the
   *  model emits are withheld (recipe/correction.withheld_globals). Optional — older
   *  persisted sessions lack it; absent means unlocked. */
  lockGlobals?: boolean;
}

export type EngineState = "empty" | "ready" | "analyzed" | "refining";
export type ErrorKind = AdapterErrorKind | "busy" | "decode";
export interface LastError {
  kind: ErrorKind;
  name?: string;
  message?: string;
  raw?: string;
  at: string;
}

export type ImageSlotName = "ref" | "base" | "settings";
/** An already-measured image: skips decode/downscale/measure. Used by tests (no canvas
 *  in node) and by any caller that has already run the metrics pipeline itself. */
export interface PreCaptured {
  dataUrl: string;
  metrics: MetricVector;
}
export type ImageInput = File | Blob | DrawableSource | PreCaptured;

/** Narrow an input to the PreCaptured escape hatch (a plain object carrying both a
 *  string dataUrl and a metrics vector — never a File/Blob/canvas/bitmap). */
function isPreCaptured(input: ImageInput): input is PreCaptured {
  const o = input as { dataUrl?: unknown; metrics?: unknown; getContext?: unknown };
  return (
    !!o &&
    typeof o.dataUrl === "string" &&
    !!o.metrics &&
    typeof o.metrics === "object" &&
    typeof o.getContext !== "function" &&
    !(typeof ImageBitmap !== "undefined" && input instanceof ImageBitmap)
  );
}

// ---------------------------------------------------------------------------
// BusyError: thrown by setImage/setRecipeApplied/toggleAttemptApplied when a gated
// call is in flight (concurrency guard). Carries kind:"busy" directly, like vanilla.
// ---------------------------------------------------------------------------
export class BusyError extends Error {
  kind = "busy" as const;
  constructor(message: string) {
    super(message);
    this.name = "BusyError";
  }
}
// DecodeError: an image could not be turned into usable pixels (undecodable file,
// downscale/measure throw). Mirrors the vanilla decode/other boundary.
export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeError";
  }
}

// ---------------------------------------------------------------------------
// Constants (source-of-truth, matching vanilla ENGINE).
// ---------------------------------------------------------------------------
export const ATTEMPTS_CAP = 8;
export const SESSION_RETENTION_CAP = 5;

// ---------------------------------------------------------------------------
// suggestProbe(recipe, target) — PURE: pick the one recipe move worth probing.
// Selection contract (why each rule exists):
//   - steps 2-4 only. Step 1 (exposure/WB) is already arithmetic from the measured
//     evidence — probing it teaches nothing new; steps 5-6 (color mapping /
//     atmosphere) are display-side or coupled and make poor single-knob probes.
//   - numeric moves only: strings (dropdown/color/checkbox tokens) and placement
//     kinds are instructions, not scalar knobs — a measured response cannot be
//     scaled by them.
//   - largest RELATIVE change wins: |set − from| / max(|from|, range span × 0.1).
//     The span floor keeps a from≈0 knob (e.g. dome 0 → 0.5) from reading as an
//     infinite relative change just because its starting point happens to be zero.
// Returns null when nothing qualifies (all-string recipe, no recipe, no step-2..4
// numeric moves) — the caller simply offers no probe.
// ---------------------------------------------------------------------------
export function suggestProbe(
  recipe: Recipe | null | undefined,
  target: TargetId | string
): ProbeSuggestion | null {
  if (!recipe || !Array.isArray(recipe.values)) return null;
  let best: ProbeSuggestion | null = null;
  let bestRel = 0;
  for (const v of recipe.values) {
    if (!v || typeof v.param !== "string") continue;
    if (!(typeof v.step === "number" && v.step >= 2 && v.step <= 4)) continue;
    if (typeof v.set !== "number" || !Number.isFinite(v.set)) continue;
    if (typeof v.from !== "number" || !Number.isFinite(v.from)) continue;
    const entry = PACKS.lookup(target, v.param);
    if (entry && entry.kind === "placement") continue; // an instruction, not a knob
    const span = entry && entry.range[0] < entry.range[1] ? entry.range[1] - entry.range[0] : 0;
    const denom = Math.max(Math.abs(v.from), span * 0.1);
    if (!(denom > 0)) continue; // no scale to judge relative change against
    const rel = Math.abs(v.set - v.from) / denom;
    if (rel > bestRel) {
      bestRel = rel;
      best = { param: v.param, from: v.from, to: v.set };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// mergeConsensusRecipes(runs, target) — PURE: fold N fulfilled recipe emits from
// IDENTICAL requests into ONE recipe (the Consensus ×3 merge; kills run-to-run LLM
// variance). Contract (why each rule exists):
//   - per param, across runs: numeric `set` values -> MEDIAN (the robust middle —
//     one outlier run cannot drag the value), then PACKS.clamp defensively (a
//     median of in-range values is in range, but the clamp is the last belt);
//     string `set` values (dropdown/placement/color tokens) -> MAJORITY vote,
//     ties resolved to the FIRST run's value (deterministic, no coin flips).
//   - from/step/confidence/why (and any other per-item metadata) come from the
//     FIRST run that emitted the param — mixing metadata across runs would stitch
//     a `why` onto a number it never justified.
//   - consensus_n = how many runs emitted the param. Params emitted by only ONE
//     run are KEPT (with consensus_n: 1) rather than dropped: silently discarding
//     a model's move loses data the user can judge — the UI flags low agreement
//     instead, which is strictly more honest.
//   - envelope (baseline/hdri_mood/rationale/gi_notes/status/status_reason) comes
//     from the first run; a `consensus: {runs}` marker is added so the UI knows
//     the denominator.
//   - the schema's values maxItems is re-enforced AFTER the merge (a union of
//     three 30-move recipes can exceed 32): lowest-consensus_n items are dropped
//     first (ties: the LAST-appearing one goes), so agreement survives truncation.
// ---------------------------------------------------------------------------
export function mergeConsensusRecipes(
  runs: Array<Record<string, unknown>>,
  target: TargetId | string
): Record<string, unknown> {
  type Item = Record<string, unknown>;
  const first = runs[0] || {};
  // First-appearance param order (run 1's order, then run 2's new params, ...) with
  // the per-run items collected in run order — items[0] is always the FIRST run that
  // emitted the param.
  const order: string[] = [];
  const byParam = new Map<string, Item[]>();
  for (const run of runs) {
    const values = run && Array.isArray(run.values) ? (run.values as Item[]) : [];
    const seenInRun = new Set<string>(); // belt: validateRecipe already drops duplicates
    for (const item of values) {
      if (!item || typeof item.param !== "string") continue;
      if (seenInRun.has(item.param)) continue;
      seenInRun.add(item.param);
      if (!byParam.has(item.param)) {
        byParam.set(item.param, []);
        order.push(item.param);
      }
      byParam.get(item.param)!.push(item);
    }
  }

  const merged: Item[] = [];
  for (const param of order) {
    const items = byParam.get(param)!;
    const firstItem = items[0];
    // Metadata (from/step/confidence/why/clamped/...) from the first emitting run.
    const out: Item = { ...firstItem, consensus_n: items.length };
    const sets = items.map((it) => it.set);
    const allNumeric = sets.every((v) => typeof v === "number" && Number.isFinite(v));
    if (allNumeric) {
      const sorted = (sets as number[]).slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      // Defensive clamp: inputs were route-validated, but an even-count average (or a
      // stubbed test run) could stray — never let an out-of-range number downstream.
      const clampRes = PACKS.clamp(target, param, median);
      out.set = clampRes.value;
      // Preserve an upstream clamped flag (all runs pinned at a range edge would
      // otherwise read as never-clamped) OR flag a clamp applied right here.
      out.clamped = firstItem.clamped === true || clampRes.clamped;
    } else {
      // Majority vote over the exact values. Keys carry the typeof so a numeric 1 and
      // a string "1" from a mixed emit can never merge into one bucket. Map iteration
      // is insertion-ordered and the first-inserted key is the FIRST run's value, so
      // the strict `>` below resolves ties to the first run deterministically.
      const counts = new Map<string, { v: unknown; n: number }>();
      for (const v of sets) {
        const key = typeof v + ":" + String(v);
        const c = counts.get(key) || { v, n: 0 };
        c.n++;
        counts.set(key, c);
      }
      let bestV: unknown = sets[0];
      let bestN = 0;
      for (const { v, n } of counts.values()) {
        if (n > bestN) {
          bestN = n;
          bestV = v;
        }
      }
      out.set = bestV;
    }
    merged.push(out);
  }

  // Re-enforce the schema cap AFTER the merge: drop the lowest-consensus_n item
  // (ties: the last-appearing one) until the array fits. Read from the schema so
  // this can never drift from EMIT_RECIPE.
  const maxItems =
    (EMIT_RECIPE.input_schema.properties.values as { maxItems?: number })?.maxItems ?? 32;
  while (merged.length > maxItems) {
    let minN = Infinity;
    let minIdx = -1;
    for (let i = 0; i < merged.length; i++) {
      const n = typeof merged[i].consensus_n === "number" ? (merged[i].consensus_n as number) : 1;
      if (n <= minN) {
        // `<=` keeps scanning so ties land on the LAST occurrence of the minimum.
        minN = n;
        minIdx = i;
      }
    }
    merged.splice(minIdx, 1);
  }

  // Envelope from the first fulfilled run; values replaced by the merge; the runs
  // marker tells the UI the agreement denominator.
  return { ...first, values: merged, consensus: { runs: runs.length } };
}

// ---------------------------------------------------------------------------
// withholdGlobals(cleaned, itemsKey) — PURE: the Area-mode enforcement belt. The
// system prompt already tells the model globals are locked, but a directive is not a
// guarantee — any scene-GLOBAL move that slips through is REMOVED from the recipe's
// values / correction's moves (so it can never be applied, exported, or enter the
// move history) and parked on `withheld_globals` for the UI to disclose. Correction
// moves carry `to` where recipe values carry `set`; both normalize to `set` in the
// withheld row so the UI renders one shape.
// ---------------------------------------------------------------------------
export function withholdGlobals(
  cleaned: Record<string, unknown>,
  itemsKey: "values" | "moves"
): Record<string, unknown> {
  const items = Array.isArray(cleaned[itemsKey])
    ? (cleaned[itemsKey] as Array<Record<string, unknown>>)
    : [];
  const kept: Array<Record<string, unknown>> = [];
  const withheld: Array<{ param: string; set: number | string; why?: string }> = [];
  for (const it of items) {
    if (it && typeof it.param === "string" && scopeOf(it.param) === "global") {
      const raw = itemsKey === "values" ? it.set : it.to;
      withheld.push({
        param: it.param,
        set: typeof raw === "number" || typeof raw === "string" ? raw : String(raw),
        ...(typeof it.why === "string" && it.why ? { why: it.why } : {}),
      });
    } else {
      kept.push(it);
    }
  }
  if (!withheld.length) return cleaned;
  return { ...cleaned, [itemsKey]: kept, withheld_globals: withheld };
}

// ---------------------------------------------------------------------------
// Store state + actions.
// ---------------------------------------------------------------------------
export interface EngineStore {
  session: Session;
  lastError: LastError | null;
  // Reactive mirror of STORE.persistent (which flips to false when IndexedDB is
  // unavailable — private browsing, disabled storage, an open that rejects). STORE
  // only knows this AFTER its first DB touch, so we sync it in boot()/persist() where
  // _openDB() has already run. The UI reads this to surface the "won't persist" banner.
  storagePersistent: boolean;
  // internal, non-React concurrency gate (kept in state so it survives across actions
  // but never rendered): the in-flight promise or null, plus WHICH op owns it (same-op
  // calls coalesce; different-op calls are refused with BusyError — see guarded()).
  _inFlight: Promise<unknown> | null;
  _inFlightOp: string | null;
  // test seam: the client adapter fn the store calls. Defaults to analyzeViaApi; tests
  // overwrite it with a stub so no /api/analyze POST is made.
  _analyze: typeof analyzeViaApi;
  // test seam: a deterministic session id for STORE round-trips.
  _testSessionId: string | null;
  // In-memory EXR state per named slot (ref/base/settings) — the retained linear buffer
  // + developed EV. NOT persisted (see ExrSlotState). Reset on reset()/boot(). A slot
  // whose entry is present is an EXR-developed slot; the UI shows the exposure slider.
  exrSlots: Record<ExrSlotName, ExrSlotState | null>;

  // -- derived reads --
  state(): EngineState;
  activeTarget(): TargetId | string;
  activeChain(): Chain | null;
  attemptInfo(): { n: number; cap: number; stored: number };
  attemptNumberAt(idx: number): number;
  lookup(paramId: string): PackEntry | null;
  sheetFor(target: TargetId | string): SheetGroup[];

  // -- actions --
  reset(): Session;
  setContext(patch: Partial<Session["context"]>): Promise<Session>;
  /** Area mode: freeze/unfreeze the scene globals for this session (persisted). */
  setLockGlobals(on: boolean): Promise<Session>;
  /** Record (or clear) settings pulled live from 3ds Max; persisted with the session. */
  setLiveSettings(live: LiveSettings | null): Promise<Session>;
  setActiveTarget(target: TargetId | string): Promise<Session>;
  setImage(slot: ImageSlotName, input: ImageInput): Promise<ImageSlot | { dataUrl: string }>;
  /** Re-develop an EXR-backed named slot at a new EV from its retained linear buffer,
   *  then re-measure so metrics track the visible exposure. Instant, client-side. No-op
   *  (returns null) if the slot has no retained EXR buffer. */
  redevelopExrSlot(slot: ExrSlotName, ev: number): Promise<ImageSlot | { dataUrl: string } | null>;
  /** The EV currently developed for an EXR-backed slot, or null if the slot is not EXR. */
  exrEv(slot: ExrSlotName): number | null;
  analyze(): Promise<Recipe>;
  addAttempt(input: ImageInput): Promise<{ score: number; correction: Correction }>;
  /** Arm the calibration probe for `param` from the CURRENT recipe (records
   *  chain.probe = {param, from: value.from, to: value.set}). Returns null (no
   *  mutation) when the param is not a numeric recipe move — strings/placements
   *  cannot be probed. Re-arming clears any prior measured response. */
  setProbe(param: string): Promise<ProbeState | null>;
  /** Decode/measure the single-knob probe render (same captureSlot path as attempts,
   *  EXR branch included) and store its measured response vs the BASE image on
   *  chain.probe.response. NOT an attempt: no score, no history round, no attempt
   *  number. Guarded by the shared in-flight gate. */
  addProbeRender(input: ImageInput): Promise<ProbeResponse>;
  reanalyzeOtherTarget(): Promise<Recipe>;
  setRecipeApplied(param: string, applied: boolean): Promise<Record<string, boolean> | null>;
  toggleAttemptApplied(
    attemptIndex: number,
    param: string
  ): Promise<Record<string, boolean> | null>;
  boot(): Promise<Session>;
  exportJSON(): Promise<string>;
  importJSON(str: string): Promise<Session>;

  // -- expert chat --
  /** The transcript (empty array when the session has none). */
  chatMessages(): ChatMsg[];
  /** Append one message (role+content, optional checkin), enforcing CHAT_CAP by
   *  dropping the oldest. Persists. */
  chatAppend(msg: Omit<ChatMsg, "at">): Promise<Session>;
  /** Ingest a render dropped into the chat: decode/measure via the SAME captureSlot
   *  path attempts use (EXR develop branch included), score it against the loaded
   *  reference, and append the user's check-in message with the measured payload.
   *  Makes NO model call and does NOT touch the analyze in-flight gate. Throws
   *  DecodeError (bad image) or Error (no reference loaded yet) — the chat panel
   *  renders these inline; they never reach the global error banner. */
  chatCheckin(input: ImageInput, note?: string): Promise<ChatCheckinResult>;
  /** Drop the whole transcript. Persists. */
  chatClear(): Promise<Session>;
}

// -- blank session factory: both chains pre-created (empty) so downstream code never
// null-checks chains[target]. -------------------------------------------------------
function blankSession(testSessionId: string | null): Session {
  return {
    id:
      testSessionId ||
      "lm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
    created: new Date().toISOString(),
    context: { scene: "", time: "", rig: "" },
    ref: null,
    base: null,
    settingsShot: null,
    activeTarget: STORE.prefs().target || "vray7max",
    chains: {
      vray7max: { recipe: null, attempts: [], _attemptCount: 0 },
      vantage33: { recipe: null, attempts: [], _attemptCount: 0 },
    },
    chat: null,
    lockGlobals: false,
  };
}

// -- read the real MIME from a data: URL prefix (an imported session can seed a slot
// with a PNG/WEBP dataUrl; sending it labeled image/jpeg is a wire lie). -------------
function mediaTypeFromDataUrl(dataUrl: string): string {
  const m = typeof dataUrl === "string" ? dataUrl.match(/^data:([^;,]+)[;,]/) : null;
  return m ? m[1] : "image/jpeg";
}

// -- classify a thrown error to a short `kind`. AdapterError already carries its kind;
// BusyError -> busy; DecodeError -> decode; a network-shaped Error -> network; else
// other. ---------------------------------------------------------------------------
function classifyError(e: unknown): ErrorKind {
  if (e instanceof AdapterError) return e.kind;
  if (e instanceof BusyError) return "busy";
  if (e instanceof DecodeError) return "decode";
  const err = e as { name?: string; message?: string };
  if (err && (err.name === "TypeError" || err.name === "AbortError" || /network|fetch/i.test(err.message || "")))
    return "network";
  return "other";
}

export const engineStore = createStore<EngineStore>((set, get) => {
  // -- annotateError(e): record lastError = {kind, ...} and return the SAME error so
  // callers can rethrow it unchanged. -------------------------------------------------
  const annotateError = (e: unknown): unknown => {
    const err = e as { name?: string; message?: string; raw?: string };
    set({
      lastError: {
        kind: classifyError(e),
        name: err?.name,
        message: err?.message,
        raw: (e as AdapterError)?.raw,
        at: new Date().toISOString(),
      },
    });
    return e;
  };

  // -- persist(): save the current session after every mutation. Also refreshes the
  // reactive storagePersistent mirror (saveSession() runs _openDB(), so STORE.persistent
  // is authoritative right after). --------------------------------------------------
  const persist = async (): Promise<Session> => {
    await STORE.saveSession(get().session as unknown as StoredSession);
    if (get().storagePersistent !== STORE.persistent) set({ storagePersistent: STORE.persistent });
    return get().session;
  };

  // -- guarded(op, fn): run fn() behind the _inFlight gate. If the SAME op is already
  // running, return THAT SAME promise (fn never invoked twice — double-click safe).
  // A DIFFERENT op arriving while busy is REFUSED with an annotated BusyError instead
  // of being coalesced: coalescing would hand the caller the wrong promise, whose
  // resolution the UI then mis-renders as the new op's success ("Attempt scored.
  // Look distance NaN." over an in-flight analyze) while the user's file is silently
  // dropped (stress-hunt findings C7/C20, 2026-07-13). Clears lastError on entry (a
  // fresh attempt that then succeeds must not leave the old banner up), sets
  // _inFlight synchronously before any await inside fn can run, and clears it in a
  // finally so a rejected op still unblocks the next call. --------------------------
  const guarded = <T,>(op: string, fn: () => Promise<T>): Promise<T> => {
    const existing = get()._inFlight;
    if (existing) {
      if (get()._inFlightOp === op) return existing as Promise<T>;
      return Promise.reject(
        annotateError(
          new BusyError(
            `${op}(): a ${get()._inFlightOp || "gated"} call is already in flight — wait for it to finish.`
          )
        )
      );
    }
    set({ lastError: null });
    const p = (async () => {
      try {
        return await fn();
      } finally {
        set({ _inFlight: null, _inFlightOp: null });
      }
    })();
    set({ _inFlight: p, _inFlightOp: op });
    return p;
  };

  // -- decode + measure + downscale a single image (setImage/addAttempt shared path).
  // Decodes File/Blob once to an ImageBitmap so both downscaleForSend and measure work
  // from the same bitmap. Throws an annotated DecodeError on any failure. ------------
  const captureSlot = async (
    input: ImageInput,
    opts?: { lossless?: boolean }
  ): Promise<{ dataUrl: string; metrics: MetricVector }> => {
    // Escape hatch: an already-measured image bypasses decode/downscale/measure. This
    // keeps addAttempt/setImage exercisable in node (no canvas) and lets a caller that
    // already ran the metrics pipeline reuse the result.
    if (isPreCaptured(input)) {
      return { dataUrl: input.dataUrl, metrics: input.metrics };
    }
    const anyInput = input as { getContext?: unknown; width?: number; height?: number };
    const isCanvasLike =
      anyInput &&
      typeof anyInput.getContext === "function" &&
      typeof anyInput.width === "number" &&
      typeof anyInput.height === "number";
    const isBitmapLike = typeof ImageBitmap !== "undefined" && input instanceof ImageBitmap;

    let source: DrawableSource;
    let owned = false;
    if (isCanvasLike || isBitmapLike) {
      source = input as DrawableSource;
    } else {
      try {
        source = (await createImageBitmap(input as Blob)) as unknown as DrawableSource;
        owned = true;
      } catch {
        throw annotateError(
          new DecodeError("Could not decode image file — unsupported or corrupt image data.")
        );
      }
    }
    try {
      const sendOpts: [number, string, number] = opts?.lossless
        ? [2048, "image/png", 1.0]
        : [1568, "image/jpeg", 0.85];
      let downscaled;
      try {
        downscaled = await downscaleForSend(source, ...sendOpts);
      } catch (e) {
        throw annotateError(
          new DecodeError("Image downscale failed: " + ((e as Error)?.message || String(e)))
        );
      }
      let metrics: MetricVector;
      try {
        metrics = measure(source);
      } catch (e) {
        throw annotateError(
          new DecodeError("Image measurement failed: " + ((e as Error)?.message || String(e)))
        );
      }
      return { dataUrl: downscaled.dataUrl, metrics };
    } finally {
      if (owned && typeof (source as { close?: () => void }).close === "function") {
        (source as unknown as { close: () => void }).close();
      }
    }
  };

  // -- EXR develop path: decode the EXR File to a scene-referred linear buffer, choose
  // an auto-EV (or use a supplied ev), develop to a display-referred sRGB canvas, and
  // return BOTH that canvas (a DrawableSource the existing captureSlot pipeline measures/
  // downscales unchanged) AND the retained linear buffer + ev so the slot's exposure can
  // be re-applied later without re-decoding. Throws an annotated DecodeError on failure.
  const developExrToCanvas = async (
    file: File | Blob,
    ev?: number
  ): Promise<{ canvas: HTMLCanvasElement; linear: Float32Array; width: number; height: number; ev: number }> => {
    let decoded;
    try {
      decoded = await decodeExrFile(file);
    } catch (e) {
      throw annotateError(
        new DecodeError((e as Error)?.message || "Could not decode EXR file.")
      );
    }
    const chosenEv = ev === undefined ? autoExposureEV(decoded.data) : ev;
    let result;
    try {
      result = developExr(decoded.data, decoded.width, decoded.height, { ev: chosenEv });
    } catch (e) {
      throw annotateError(
        new DecodeError("Could not develop EXR: " + ((e as Error)?.message || String(e)))
      );
    }
    return {
      canvas: result.canvas,
      linear: decoded.data,
      width: decoded.width,
      height: decoded.height,
      ev: result.ev,
    };
  };

  // -- attempt-number helpers (monotonic per-chain; matches "ATTEMPT N:" labels). ----
  const attemptNumberForChain = (chain: Chain | null, idx: number): number => {
    if (!chain || !Array.isArray(chain.attempts)) return idx + 1;
    const L = chain.attempts.length;
    if (typeof chain._attemptCount !== "number") return idx + 1;
    return chain._attemptCount - (L - 1 - idx);
  };

  // -- history for ONE chain: recipe values[] normalized as round 0, then each
  // stored attempt's correction.moves as subsequent rounds. applied_assumed is true
  // ONLY when that round's backing map is absent. Takes the target EXPLICITLY —
  // reading s.activeTarget here would race a header target-flip that lands between
  // an attempt's decode await and its request assembly (finding C21, 2026-07-13),
  // mixing one chain's history into another chain's correction call. -----------------
  const historyForChain = (target: TargetId | string): HistoryRound[] => {
    const s = get().session;
    const chain = s.chains[target];
    if (!chain) return [];
    const rounds: HistoryRound[] = [];
    if (chain.recipe && Array.isArray(chain.recipe.values)) {
      rounds.push({
        round: 0,
        applied_assumed: !chain.recipeApplied,
        moves: chain.recipe.values.map((v) => ({
          param: v.param,
          from: v.from,
          to: v.set,
          applied: chain.recipeApplied ? chain.recipeApplied[v.param] !== false : true,
          why: v.why,
        })),
      });
    }
    chain.attempts.forEach((att, idx) => {
      if (att.correction && Array.isArray(att.correction.moves)) {
        rounds.push({
          round: attemptNumberForChain(chain, idx),
          applied_assumed: !att.appliedParams,
          moves: att.correction.moves.map((m) => ({
            param: m.param,
            from: m.from,
            to: m.to,
            applied: !att.appliedParams || att.appliedParams[m.param] !== false,
            why: m.why,
          })),
        });
      }
    });
    return rounds;
  };

  // -- SCENE PRIORS (2026-07-05): the SETTLED values of a chain — what the sheet
  // actually reads after the whole refine conversation. Walks round 0 (recipe values)
  // then every STORED correction's moves in order; LAST write per param wins (a later
  // trim supersedes the recipe's opening move); rows the user marked applied:false are
  // skipped entirely (they never reached the render, so "remembering" them would teach
  // the next session a value nobody verified). Same applied semantics as
  // historyForActiveChain: an ABSENT applied map means everything was applied.
  // Degrades with the ATTEMPTS_CAP eviction — moves on evicted rows are gone, which
  // only makes the prior thinner, never wrong. -------------------------------------
  const settledValuesForChain = (chain: Chain): { param: string; value: number | string }[] => {
    const last = new Map<string, number | string>();
    if (chain.recipe && Array.isArray(chain.recipe.values)) {
      for (const v of chain.recipe.values) {
        if (!v || typeof v.param !== "string" || v.set === undefined) continue;
        const applied = chain.recipeApplied ? chain.recipeApplied[v.param] !== false : true;
        if (!applied) continue;
        last.set(v.param, v.set);
      }
    }
    for (const att of Array.isArray(chain.attempts) ? chain.attempts : []) {
      if (!att || !att.correction || !Array.isArray(att.correction.moves)) continue;
      for (const m of att.correction.moves) {
        if (!m || typeof m.param !== "string" || m.to === undefined) continue;
        const applied = !att.appliedParams || att.appliedParams[m.param] !== false;
        if (!applied) continue;
        last.set(m.param, m.to);
      }
    }
    return Array.from(last.entries()).map(([param, value]) => ({ param, value }));
  };

  // -- push an attempt, enforcing ATTEMPTS_CAP by evicting from the front (keeping the
  // evicted entry's score on _evictedScores). --------------------------------------
  const pushAttempt = (chain: Chain, entry: AttemptEntry): void => {
    chain.attempts.push(entry);
    while (chain.attempts.length > ATTEMPTS_CAP) {
      const evicted = chain.attempts.shift()!;
      if (!Array.isArray(chain._evictedScores)) chain._evictedScores = [];
      chain._evictedScores.push({ score: evicted.score });
    }
  };

  // -- state derivation (scoped to the ACTIVE target's chain). -----------------------
  const deriveState = (s: Session): EngineState => {
    if (!s.ref || !s.base) return "empty";
    const chain = s.chains[s.activeTarget];
    if (!chain || !chain.recipe) return "ready";
    if (chain.attempts.length > 0) return "refining";
    return "analyzed";
  };

  // -- the analyze implementation (called directly by analyze() and
  // reanalyzeOtherTarget(), both already inside the shared guard). ------------------
  // -- usable-metrics guard (finding C19, 2026-07-13): sessions persisted by older
  // builds, or imported files that passed the dataUrl walk, can carry slots WITHOUT
  // metrics (or without metrics.grid) — deriveState still reads "ready", so without
  // this check diffVectors throws an UN-annotated TypeError before the annotating
  // try/catch is reached: no banner, silently dead Analyze button. ------------------
  const METRICS_HINT =
    "This session's images are missing their measurement data (saved by an older " +
    "version or an edited file) — re-drop the reference and base render, then try again.";
  const slotMetricsUsable = (slot: { metrics?: unknown } | null | undefined): boolean => {
    const m = slot?.metrics as MetricVector | undefined;
    return !!(
      m &&
      m.lum &&
      typeof m.lum.p50 === "number" &&
      Array.isArray(m.grid) &&
      m.grid.length === 16 &&
      m.wb
    );
  };

  const analyzeImpl = async (): Promise<Recipe> => {
    const s = get().session;
    if (deriveState(s) === "empty") {
      throw new Error(
        "analyze(): requires both reference and base images to be set first."
      );
    }
    if (!slotMetricsUsable(s.ref) || !slotMetricsUsable(s.base)) {
      throw annotateError(new Error(METRICS_HINT));
    }
    const target = s.activeTarget;
    // Lean evidence: send ONLY the diff (base - reference), not the full reference+base
    // metric objects. Verified live 2026-07-04: the full bundle (THREE 16-cell grids + all
    // percentiles) makes Opus over-reason past both omega's token budget (JSON truncates)
    // and its ~100s wall-clock ceiling (HTTP 500). The diff alone carries the entire match
    // signal (direction + magnitude of every gap); with the system prompt's brevity guard
    // it yields a complete recipe reliably and fast. Absolute levels are conveyed by the
    // reference/base IMAGES the model already sees.
    const metricsBundle = {
      diff: diffVectors(s.base!.metrics, s.ref!.metrics),
      // Measured WB/exposure grounding (2026-07-05): CCT estimates + EV gap so the
      // step-1 lock is arithmetic, not the model's kelvin guesswork.
      ...wbExposureEvidence(s.ref!.metrics, s.base!.metrics),
      // Measured spatial/structural grounding: light centroid (key direction),
      // key:fill ratio (directionality), absolute anchors (haze/burn levels).
      ...sceneEvidence(s.ref!.metrics, s.base!.metrics),
      // Scene-referred linear evidence (EXR-native, 2026-07-05): included ONLY when
      // BOTH compared images are EXR-backed with computed stats — a mixed PNG/EXR pair
      // would compare scene-referred floats against display-referred pixels, so it is
      // omitted entirely. A restored session has no linear buffers (exrSlots is never
      // persisted), so this is naturally absent there too.
      ...(get().exrSlots.ref?.stats && get().exrSlots.base?.stats
        ? { linear_evidence: linearEvidence(get().exrSlots.ref!.stats!, get().exrSlots.base!.stats!) }
        : {}),
    };
    const images: AdapterImage[] = [
      { role: "reference", dataUrl: s.ref!.dataUrl, mediaType: mediaTypeFromDataUrl(s.ref!.dataUrl) },
      { role: "base", dataUrl: s.base!.dataUrl, mediaType: mediaTypeFromDataUrl(s.base!.dataUrl) },
    ];
    if (s.settingsShot) {
      images.push({
        role: "settings",
        dataUrl: s.settingsShot.dataUrl,
        mediaType: mediaTypeFromDataUrl(s.settingsShot.dataUrl),
      });
    }
    const system = systemPrompt(target, "recipe", { lockGlobals: s.lockGlobals === true });
    // Calibration probe: once the single-knob probe render has been measured, every
    // subsequent model call for this chain — re-analyze included — carries the
    // measured sensitivity so magnitudes are scaled by the scene, not guessed.
    // Null-guarded: persisted sessions from older versions have no `probe` field,
    // and an armed-but-unrendered probe (no response yet) carries no evidence.
    const probe = s.chains[target].probe;
    // Scene prior (2026-07-05): the best-matching PAST session's settled values ride
    // along as a starting bias — same target, >= 1 exactly-equal non-empty context
    // chip (STORE.bestPrior; degrade-never-throw, so a corrupt priors blob simply
    // yields no prior). The evidence blocks above always outrank it on conflict.
    const prior = STORE.bestPrior(target, s.context);
    const userContent = buildUserContent({
      mode: "recipe",
      images,
      metricsBundle,
      context: s.context,
      ...(probe && probe.response ? { probe } : {}),
      ...(prior ? { prior } : {}),
      // Live 3ds Max settings (2026-07-05): the scene's ACTUAL current values,
      // pulled over the bridge — the model's `from` baseline stops being an
      // assumption. Null-guarded: older sessions lack the field.
      ...(s.liveSettings ? { liveSettings: s.liveSettings } : {}),
    });

    // The one request this analysis sends — built ONCE so the consensus path fires
    // three byte-identical calls (same system, same content, same tool).
    const request: Parameters<typeof analyzeViaApi>[0] = {
      model: STORE.prefs().model,
      system,
      userContent,
      tool: EMIT_RECIPE,
      mode: "recipe",
      target,
    };

    let cleaned: Record<string, unknown>;
    try {
      if (STORE.prefs().consensus === true) {
        // CONSENSUS ×3 (2026-07-05): fire THREE identical analyses in parallel and
        // merge them (median numerics / majority strings — mergeConsensusRecipes)
        // to kill run-to-run LLM variance on the INITIAL recipe. allSettled, not
        // all: one flaky gateway response must not waste the other two runs — any
        // >= 1 fulfilled, shape-valid runs still produce a (thinner) consensus.
        // Correction rounds deliberately STAY single-call: a trim is 3-5 cheap
        // moves and is HISTORY-COUPLED — three parallel corrections would each
        // reason against the same move history, and a cross-run merge of their
        // trims would not correspond to any one model's coherent plan.
        const settled = await Promise.allSettled([
          get()._analyze(request),
          get()._analyze(request),
          get()._analyze(request),
        ]);
        const fulfilled: Record<string, unknown>[] = [];
        for (const r of settled) {
          // A fulfilled-but-wrong-shape run (missing values[]) is as unusable as a
          // rejection — exclude it from the merge rather than crash inside it.
          if (
            r.status === "fulfilled" &&
            r.value &&
            Array.isArray((r.value as { values?: unknown }).values)
          ) {
            fulfilled.push(r.value as Record<string, unknown>);
          }
        }
        if (fulfilled.length === 0) {
          // All three failed: surface the FIRST rejection reason unchanged so the
          // existing annotateError path classifies it exactly as a single-call
          // failure would have been; all-fulfilled-but-malformed becomes shape.
          const firstRejection = settled.find((r) => r.status === "rejected") as
            | PromiseRejectedResult
            | undefined;
          if (firstRejection) throw firstRejection.reason;
          throw new AdapterError(
            "Consensus: every run returned a non-recipe shape (missing values[]) — all responses were discarded.",
            "shape"
          );
        }
        cleaned = mergeConsensusRecipes(fulfilled, target);
      } else {
        cleaned = await get()._analyze(request);
      }
      // Shape belt: the route guarantees a validated recipe, but a broken proxy/stub
      // answering with the wrong mode's shape must become a typed error here — storing
      // it would crash every values[] read downstream (RecipeView, history, export).
      if (!cleaned || !Array.isArray((cleaned as { values?: unknown }).values)) {
        throw new AdapterError(
          "Analyze returned a non-recipe shape (missing values[]) — the response was discarded.",
          "shape"
        );
      }
    } catch (e) {
      throw annotateError(e);
    }

    // AREA-MODE BELT: with globals locked, strip any scene-global move the model
    // emitted anyway (prompt directive + this filter = defense in depth). Runs AFTER
    // the consensus merge so a merged recipe is filtered exactly like a single one.
    if (s.lockGlobals === true) {
      cleaned = withholdGlobals(cleaned, "values");
    }

    // Mutate the chain immutably enough for zustand subscribers to see a new session ref.
    const s2 = get().session;
    s2.chains[target].recipe = cleaned as unknown as Recipe;
    s2.chains[target].recipeApplied = null; // fresh recipe resets the applied map
    set({ session: { ...s2 } });
    await persist();
    return cleaned as unknown as Recipe;
  };

  const addAttemptImpl = async (
    input: ImageInput
  ): Promise<{ score: number; correction: Correction }> => {
    const s = get().session;
    const st = deriveState(s);
    if (st !== "analyzed" && st !== "refining") {
      throw new Error(
        `addAttempt(): active target must have a recipe first (state is "${st}"); call analyze() first.`
      );
    }
    if (!slotMetricsUsable(s.ref)) {
      throw annotateError(new Error(METRICS_HINT));
    }
    const target = s.activeTarget;
    const chain = s.chains[target];
    // EXR attempts are decoded + developed (auto-EV) to a display-referred canvas first,
    // then measured/downscaled by the SAME captureSlot path. A stored attempt is an
    // immutable ledger row (re-scoring history would corrupt the refine chain), so the
    // exposure slider is offered only on the named ref/base/settings slots, not here.
    let captured: { dataUrl: string; metrics: MetricVector };
    // Transient scene-referred stats for THIS attempt only: attempts are immutable
    // ledger rows with no exposure slider, so the linear buffer is NOT retained — it is
    // measured once here and released, feeding only the linear evidence block below.
    let attemptLinearStats: LinearStats | null = null;
    if (input instanceof Blob && (await isExrFile(input as File))) {
      const dev = await developExrToCanvas(input);
      attemptLinearStats = linearStats(dev.linear, dev.width, dev.height);
      captured = await captureSlot(dev.canvas as unknown as DrawableSource);
    } else {
      captured = await captureSlot(input);
    }
    const score = scoreVectors(s.ref!.metrics, captured.metrics);

    // Lean evidence (see analyze()): the diff (attempt - reference) alone, not the full
    // metric objects — keeps Opus's reasoning inside omega's token + ~100s time budget.
    const metricsBundle = {
      diff: diffVectors(captured.metrics, s.ref!.metrics),
      // Same measured WB/exposure + spatial grounding as analyze(), vs THIS attempt.
      ...wbExposureEvidence(s.ref!.metrics, captured.metrics),
      ...sceneEvidence(s.ref!.metrics, captured.metrics),
      // Scene-referred linear evidence: only when the REFERENCE slot is EXR-backed AND
      // this attempt arrived as an EXR (mixed pairs are omitted entirely — see analyze).
      ...(get().exrSlots.ref?.stats && attemptLinearStats
        ? { linear_evidence: linearEvidence(get().exrSlots.ref!.stats!, attemptLinearStats) }
        : {}),
    };
    // Snapshot the history BEFORE the attempt counter increments: stored rounds are
    // numbered off _attemptCount, so incrementing first shifts every prior round's
    // label by +1 in the MOVE HISTORY the model reads (attempt 1's correction would
    // arrive marked "round 2" while analyzing attempt 2 — misnumbered input to the
    // oscillation guard). The vanilla source has the same ordering bug; fixed here.
    const history = historyForChain(target);
    if (typeof chain._attemptCount !== "number") chain._attemptCount = chain.attempts.length;
    chain._attemptCount++;
    const attemptN = chain._attemptCount;
    const images: AdapterImage[] = [
      { role: "reference", dataUrl: s.ref!.dataUrl, mediaType: mediaTypeFromDataUrl(s.ref!.dataUrl) },
      { role: "attempt", n: attemptN, dataUrl: captured.dataUrl, mediaType: mediaTypeFromDataUrl(captured.dataUrl) },
    ];
    const system = systemPrompt(target, "correction", { lockGlobals: s.lockGlobals === true });
    const userContent = buildUserContent({
      mode: "correction",
      images,
      metricsBundle,
      context: s.context,
      history,
      // Calibration probe (see analyzeImpl): the measured single-knob sensitivity
      // rides along on every correction round once it exists. Null-guarded — old
      // persisted sessions have no probe; an unrendered probe has no response.
      ...(chain.probe && chain.probe.response ? { probe: chain.probe } : {}),
      // Live 3ds Max settings ride along on corrections too (see analyzeImpl).
      ...(s.liveSettings ? { liveSettings: s.liveSettings } : {}),
    });

    let cleaned: Record<string, unknown>;
    try {
      cleaned = await get()._analyze({
        model: STORE.prefs().model,
        system,
        userContent,
        tool: EMIT_CORRECTION,
        mode: "correction",
        target,
      });
      // Shape belt (see analyzeImpl): a wrong-mode response must not reach the ledger.
      if (!cleaned || !Array.isArray((cleaned as { moves?: unknown }).moves)) {
        throw new AdapterError(
          "Analyze returned a non-correction shape (missing moves[]) — the round was discarded.",
          "shape"
        );
      }
    } catch (e) {
      // A failed round consumes NO attempt number: without this rollback every gateway
      // failure permanently shifts the stored attempts' labels (attempt 1 starts
      // rendering as "Attempt 2") and inflates the "N so far" caption, because
      // attemptNumberForChain assumes each increment ended in a stored row.
      chain._attemptCount--;
      throw annotateError(e);
    }

    // AREA-MODE BELT (see analyzeImpl): strip scene-global trims before they can
    // enter the ledger, the applied map, or the next round's move history.
    if (s.lockGlobals === true) {
      cleaned = withholdGlobals(cleaned, "moves");
    }

    const correction = cleaned as unknown as Correction;
    const appliedParams: Record<string, boolean> = {};
    for (const mv of correction.moves) appliedParams[mv.param] = true;

    pushAttempt(chain, {
      dataUrl: captured.dataUrl,
      metrics: captured.metrics,
      score,
      correction,
      appliedParams,
    });

    // SCENE PRIORS (2026-07-05): the chain just LANDED — either the measured score
    // entered the match band (score <= MATCH_THRESHOLD, the same gate the RefineLedger
    // shows) or the model declared handoff_to_grade (the residual is a color grade,
    // not a lighting problem). Remember the settled sheet so the NEXT session over a
    // similar scene starts from this known-good landing zone. Runs AFTER pushAttempt
    // so the just-stored correction's trims are part of the settlement. FIRE-AND-
    // FORGET: savePrior never throws by contract, and the belt here guarantees a
    // storage failure can never break the attempt flow the user is mid-way through.
    try {
      if (score <= MATCH_THRESHOLD || correction.status === "handoff_to_grade") {
        STORE.savePrior({
          target,
          context: { ...get().session.context },
          values: settledValuesForChain(chain),
          matchPercent: matchPercent(score),
          at: new Date().toISOString(),
        });
      }
    } catch {
      /* fire-and-forget: a lost prior costs the next session a head start, nothing else */
    }

    set({ session: { ...get().session } });
    await persist();
    return { score, correction };
  };

  // -- the calibration-probe implementation (runs inside the shared guard, like
  // addAttemptImpl — but a probe is NOT an attempt: it never scores, never becomes a
  // history round, never ticks _attemptCount, and makes NO model call. It exists only
  // to measure the scene's response to the single armed knob against the BASE image
  // (the render the recipe's `from` values describe), so the delta is attributable to
  // that one change. ----------------------------------------------------------------
  const addProbeRenderImpl = async (input: ImageInput): Promise<ProbeResponse> => {
    const s = get().session;
    const st = deriveState(s);
    if (st !== "analyzed" && st !== "refining") {
      throw new Error(
        `addProbeRender(): active target must have a recipe first (state is "${st}"); call analyze() first.`
      );
    }
    const target = s.activeTarget;
    const probe = s.chains[target].probe;
    if (!probe) {
      throw new Error(
        "addProbeRender(): no probe armed for the active target — call setProbe(param) first."
      );
    }
    if (!slotMetricsUsable(s.base)) {
      throw annotateError(new Error(METRICS_HINT));
    }
    // Decode/measure through the SAME captureSlot path as attempts, EXR branch
    // included. The linear buffer is NOT retained — the probe wants only the measured
    // deltas below. EXPOSURE-CRITICAL: an EXR probe must be developed at the BASE
    // slot's retained EV, NOT auto-EV — auto-exposure pins every frame's median to the
    // same target, which cancels the very brightness response the probe exists to
    // measure (a sun ×3 probe would read "median +0 EV"). When the base is not
    // EXR-backed there is no shared EV frame, so d_ev is reported as null (honest)
    // rather than a fabricated ~0.
    let captured: { dataUrl: string; metrics: MetricVector };
    let exposureComparable = true;
    if (input instanceof Blob && (await isExrFile(input as File))) {
      const baseExr = get().exrSlots.base;
      const dev = await developExrToCanvas(input, baseExr ? baseExr.ev : undefined);
      captured = await captureSlot(dev.canvas as unknown as DrawableSource);
      exposureComparable = !!baseExr;
    } else {
      captured = await captureSlot(input);
    }

    // Measured response, probe vs BASE. Each channel reuses the corresponding
    // evidence helper's math + null-guards so a no-signal frame reads as null, never
    // a fabricated number. deriveState !== "empty" above guarantees s.base exists.
    const baseM = s.base!.metrics;
    const probeM = captured.metrics;
    // d_ev: wbExposureEvidence's guarded log2 median ratio. Argument order
    // (probe, base) yields log2(probe.p50 / base.p50) — positive = probe brighter.
    const d_ev = exposureComparable ? wbExposureEvidence(probeM, baseM).exposure_gap_ev : null;
    const warmthDelta = probeM.wb.warmthHighlight - baseM.wb.warmthHighlight;
    const d_warmth_highlight = Number.isFinite(warmthDelta)
      ? Math.round(warmthDelta * 1e4) / 1e4
      : null;
    // Centroid / key:fill via sceneEvidence with base as "reference" and the probe as
    // "current" — the same projection the model already reads, so signs agree.
    const sc = sceneEvidence(baseM, probeM);
    const cRef = sc.light_centroid.reference;
    const cCur = sc.light_centroid.current;
    const d_centroid_x = cRef && cCur ? Math.round((cCur.x - cRef.x) * 1e3) / 1e3 : null;
    const kRef = sc.key_fill_ratio.reference;
    const kCur = sc.key_fill_ratio.current;
    const d_key_fill_ratio =
      kRef !== null && kCur !== null ? Math.round((kCur - kRef) * 100) / 100 : null;
    const response: ProbeResponse = { d_ev, d_warmth_highlight, d_centroid_x, d_key_fill_ratio };

    // IMMUTABLE update (same reasoning as setRecipeApplied: fresh refs so subscribed
    // components re-render), re-read AFTER the capture awaits so a concurrent-free
    // but later session ref is the one written.
    const s2 = get().session;
    const chain2 = s2.chains[target];
    const probe2 = chain2.probe || probe;
    set({
      session: {
        ...s2,
        chains: { ...s2.chains, [target]: { ...chain2, probe: { ...probe2, response } } },
      },
    });
    await persist();
    return response;
  };

  return {
    session: blankSession(null),
    lastError: null,
    storagePersistent: true,
    _inFlight: null,
    _inFlightOp: null,
    _analyze: analyzeViaApi,
    _testSessionId: null,
    exrSlots: { ref: null, base: null, settings: null },

    // ---- derived reads ----
    state() {
      return deriveState(get().session);
    },
    activeTarget() {
      return get().session.activeTarget;
    },
    activeChain() {
      const s = get().session;
      return s.chains[s.activeTarget] || null;
    },
    attemptInfo() {
      const chain = get().activeChain();
      const n =
        chain && typeof chain._attemptCount === "number"
          ? chain._attemptCount
          : chain
          ? chain.attempts.length
          : 0;
      const stored = chain ? chain.attempts.length : 0;
      return { n, cap: ATTEMPTS_CAP, stored };
    },
    attemptNumberAt(idx: number) {
      return attemptNumberForChain(get().activeChain(), idx);
    },
    lookup(paramId: string) {
      return PACKS.lookup(get().activeTarget(), paramId);
    },
    sheetFor(target: TargetId | string) {
      return PACKS.sheet(target);
    },

    // ---- actions ----
    reset() {
      const s = blankSession(get()._testSessionId);
      set({ session: s, lastError: null, exrSlots: { ref: null, base: null, settings: null } });
      return s;
    },

    async setLiveSettings(live) {
      set({ lastError: null });
      const s = get().session;
      const next = { ...s, liveSettings: live };
      set({ session: next });
      await persist();
      return next;
    },

    async setLockGlobals(on) {
      set({ lastError: null });
      const next = { ...get().session, lockGlobals: on === true };
      set({ session: next });
      await persist();
      return next;
    },

    async setContext(patch) {
      set({ lastError: null });
      const s = get().session;
      const next = { ...s, context: Object.assign({}, s.context || {}, patch || {}) };
      set({ session: next });
      await persist();
      return next;
    },

    async setActiveTarget(target) {
      const s = get().session;
      const next = { ...s, activeTarget: target };
      set({ session: next });
      await persist();
      return next;
    },

    async setImage(slot, input) {
      if (get()._inFlight) {
        throw annotateError(
          new BusyError(
            "setImage(): an analyze/attempt/reanalyze call is already in flight — wait for it to finish before swapping images."
          )
        );
      }
      set({ lastError: null });

      // EXR path: a dropped/pasted/picked .exr (or a File whose magic bytes are EXR) is
      // decoded + developed (auto-EV) to a display-referred sRGB canvas FIRST; that canvas
      // then feeds the EXISTING captureSlot pipeline (downscale + measure) unchanged, so
      // metrics stay display-referred. The retained linear buffer + EV are recorded in the
      // (non-persisted) exrSlots side channel so the slot's exposure can be re-applied.
      let captured: { dataUrl: string; metrics: MetricVector };
      const isNamedExrSlot = slot === "ref" || slot === "base" || slot === "settings";
      if (isNamedExrSlot && input instanceof Blob && (await isExrFile(input as File))) {
        const dev = await developExrToCanvas(input);
        captured = await captureSlot(dev.canvas as unknown as DrawableSource, {
          lossless: slot === "settings",
        });
        const nextExr = { ...get().exrSlots } as Record<ExrSlotName, ExrSlotState | null>;
        nextExr[slot as ExrSlotName] = {
          linear: dev.linear,
          width: dev.width,
          height: dev.height,
          ev: dev.ev,
          // Scene-referred stats are exposure-independent (measured on the raw linear
          // buffer, before any EV gain) — compute ONCE here at decode; redevelopExrSlot
          // only changes the developed EV and carries these through.
          stats: linearStats(dev.linear, dev.width, dev.height),
        };
        set({ exrSlots: nextExr });
      } else {
        captured = await captureSlot(input, { lossless: slot === "settings" });
        // A non-EXR replacement clears any prior EXR state on this slot.
        if (isNamedExrSlot && get().exrSlots[slot as ExrSlotName]) {
          const nextExr = { ...get().exrSlots };
          nextExr[slot as ExrSlotName] = null;
          set({ exrSlots: nextExr });
        }
      }

      const s = get().session;
      const next = { ...s };
      if (slot === "ref") next.ref = captured;
      else if (slot === "base") next.base = captured;
      else if (slot === "settings") next.settingsShot = { dataUrl: captured.dataUrl };
      else throw new Error(`setImage: unknown slot "${slot}" (expected ref|base|settings)`);
      // STALENESS INVALIDATION: liveSettings describes ONE specific scene. Swapping the
      // matched ref/base image makes those `from` values describe a DIFFERENT scene, yet the
      // evidence block marks them highest-trust — strictly worse than no live block. Clear
      // the pull on a ref/base swap, mirroring the exrSlots clear that already guards this
      // slot for the same staleness reason. (A `settings` shot is not a matched scene image.)
      if ((slot === "ref" || slot === "base") && next.liveSettings) next.liveSettings = null;
      // Same staleness rule for the calibration probe (finding C22, 2026-07-13): its
      // measured response was taken against the PREVIOUS base render — after a ref/base
      // swap it would scale a NEW scene's corrections by a DEAD scene's sensitivity,
      // and the probe is marked higher-trust than the model's own guess.
      if (slot === "ref" || slot === "base") {
        let cleared = false;
        const chains: Record<string, Chain> = {};
        for (const [t, ch] of Object.entries(next.chains)) {
          if (ch && ch.probe) {
            chains[t] = { ...ch, probe: null };
            cleared = true;
          } else {
            chains[t] = ch;
          }
        }
        if (cleared) next.chains = chains;
      }
      set({ session: next });
      await persist();
      return slot === "settings" ? { dataUrl: captured.dataUrl } : captured;
    },

    async redevelopExrSlot(slot, ev) {
      if (get()._inFlight) {
        throw annotateError(
          new BusyError(
            "redevelopExrSlot(): a call is already in flight — wait for it to finish before re-exposing."
          )
        );
      }
      const exr = get().exrSlots[slot];
      if (!exr) return null;
      set({ lastError: null });
      let clamped = ev;
      if (clamped < EV_MIN) clamped = EV_MIN;
      if (clamped > EV_MAX) clamped = EV_MAX;
      // Re-develop from the retained linear buffer at the new EV, then re-measure so the
      // metrics (and thus the model input + score) track exactly what the user sees.
      let result;
      try {
        result = developExr(exr.linear, exr.width, exr.height, { ev: clamped });
      } catch (e) {
        throw annotateError(
          new DecodeError("Could not re-develop EXR: " + ((e as Error)?.message || String(e)))
        );
      }
      const captured = await captureSlot(result.canvas as unknown as DrawableSource, {
        lossless: slot === "settings",
      });
      const nextExr = { ...get().exrSlots };
      // Stats are exposure-independent — carry them through unchanged. Backfill from the
      // retained buffer if this slot's state predates the stats field (injected state).
      nextExr[slot] = { ...exr, ev: clamped, stats: exr.stats ?? linearStats(exr.linear, exr.width, exr.height) };
      const s = get().session;
      const next = { ...s };
      if (slot === "ref") next.ref = captured;
      else if (slot === "base") next.base = captured;
      else if (slot === "settings") next.settingsShot = { dataUrl: captured.dataUrl };
      set({ session: next, exrSlots: nextExr });
      await persist();
      return slot === "settings" ? { dataUrl: captured.dataUrl } : captured;
    },

    exrEv(slot) {
      const exr = get().exrSlots[slot];
      return exr ? exr.ev : null;
    },

    analyze() {
      return guarded("analyze", () => analyzeImpl());
    },

    addAttempt(input) {
      return guarded("addAttempt", () => addAttemptImpl(input));
    },

    async setProbe(param) {
      if (get()._inFlight) {
        throw annotateError(
          new BusyError(
            "setProbe(): an analyze/attempt/reanalyze call is already in flight — wait for it to finish before arming a probe."
          )
        );
      }
      set({ lastError: null });
      const s = get().session;
      const target = s.activeTarget;
      const chain = s.chains[target];
      if (!chain || !chain.recipe || !Array.isArray(chain.recipe.values)) return null;
      const v = chain.recipe.values.find((x) => x && x.param === param);
      // Only a NUMERIC move can be probed (the response math needs a scalar knob) —
      // a string/placement instruction reads as "no probe" rather than throwing.
      if (
        !v ||
        typeof v.set !== "number" ||
        !Number.isFinite(v.set) ||
        typeof v.from !== "number" ||
        !Number.isFinite(v.from)
      ) {
        return null;
      }
      // A fresh arm carries NO response: the measurement belongs to the render of
      // THIS from→to change, so re-arming always discards the old one.
      const probe: ProbeState = { param: v.param, from: v.from, to: v.set };
      // IMMUTABLE update (same reasoning as setRecipeApplied: fresh chain/session
      // refs so the probe card actually re-renders).
      set({
        session: { ...s, chains: { ...s.chains, [target]: { ...chain, probe } } },
      });
      await persist();
      return probe;
    },

    addProbeRender(input) {
      return guarded("addProbeRender", () => addProbeRenderImpl(input));
    },

    reanalyzeOtherTarget() {
      return guarded("reanalyze", async () => {
        const s = get().session;
        if (!s.ref || !s.base) {
          throw new Error(
            "reanalyzeOtherTarget(): requires reference and base images to already be set."
          );
        }
        const other = s.activeTarget === "vray7max" ? "vantage33" : "vray7max";
        set({ session: { ...s, activeTarget: other } });
        // Keep prefs.target in lockstep with the flip.
        STORE.setPrefs({ target: other });
        await persist();
        return analyzeImpl();
      });
    },

    async setRecipeApplied(param, applied) {
      if (get()._inFlight) {
        throw annotateError(
          new BusyError(
            "setRecipeApplied(): an analyze/attempt/reanalyze call is already in flight — wait for it to finish before changing the applied set."
          )
        );
      }
      set({ lastError: null });
      // IMMUTABLE update: build new recipeApplied/chain/chains/session objects rather than
      // mutating in place. RecipeView memoizes its rows on the recipeApplied REFERENCE
      // (useMemo dep); mutating in place left the ref unchanged, so the checkbox never
      // re-rendered ("applied" appeared frozen). New refs make the toggle actually apply.
      const s = get().session;
      const target = s.activeTarget;
      const chain = s.chains[target];
      if (!chain) return null;
      const nextApplied = { ...(chain.recipeApplied || {}), [param]: !!applied };
      set({
        session: { ...s, chains: { ...s.chains, [target]: { ...chain, recipeApplied: nextApplied } } },
      });
      await persist();
      return nextApplied;
    },

    async toggleAttemptApplied(attemptIndex, param) {
      if (get()._inFlight) {
        throw annotateError(
          new BusyError(
            "toggleAttemptApplied(): an analyze/attempt/reanalyze call is already in flight — wait for it to finish before changing the applied set."
          )
        );
      }
      set({ lastError: null });
      // IMMUTABLE update (same reasoning as setRecipeApplied): new appliedParams/attempt/
      // attempts/chain/session refs so the refine-panel checkbox re-renders instead of
      // snapping back.
      const s = get().session;
      const target = s.activeTarget;
      const chain = s.chains[target];
      if (!chain || !chain.attempts[attemptIndex]) return null;
      const att = chain.attempts[attemptIndex];
      const nextApplied = { ...(att.appliedParams || {}) };
      nextApplied[param] = nextApplied[param] === false ? true : false;
      const nextAttempts = chain.attempts.map((a, i) =>
        i === attemptIndex ? { ...a, appliedParams: nextApplied } : a
      );
      set({
        session: { ...s, chains: { ...s.chains, [target]: { ...chain, attempts: nextAttempts } } },
      });
      await persist();
      return nextApplied;
    },

    async boot() {
      // A restored session has no live EXR linear buffers (they are never persisted);
      // clear the side channel so a stale slider can't appear over a re-hydrated slot.
      set({ exrSlots: { ref: null, base: null, settings: null } });
      // Clobber guard (finding C23, 2026-07-13): the IndexedDB load below is async —
      // a user who drops an image (or acts at all) while it is in flight replaces the
      // session object; adopting the hydrated one afterwards would silently discard
      // that action. Every mutator swaps the session reference, so an identity check
      // on the pre-load session detects "user got here first".
      const preLoad = get().session;
      try {
        const latest = await STORE.loadLatest();
        if (get().session === preLoad) {
          set({ session: (latest as unknown as Session) || blankSession(get()._testSessionId) });
        }
      } catch (e) {
        annotateError(e);
        if (get().session === preLoad) {
          set({ session: blankSession(get()._testSessionId) });
        }
      }
      try {
        await STORE.pruneToNewest(SESSION_RETENTION_CAP);
      } catch {
        /* retention hygiene is best-effort; never block boot on it */
      }
      // STORE.loadLatest() above already opened (or failed to open) the DB, so
      // STORE.persistent is now authoritative — mirror it for the UI banner.
      set({ storagePersistent: STORE.persistent });
      return get().session;
    },

    async exportJSON() {
      return STORE.exportJSON(get().session as unknown as StoredSession);
    },

    async importJSON(str) {
      // In-flight gate (finding C18, 2026-07-13): an analyze/attempt resolving AFTER
      // an import re-reads get().session and would stamp its result onto — and
      // persist under — the freshly imported session (cross-session corruption),
      // while addAttempt's round lands in a detached chain (silent loss of a paid
      // model call). Same refusal every other mutator makes.
      if (get()._inFlight) {
        throw annotateError(
          new BusyError(
            "importJSON(): an analyze/attempt call is in flight — wait for it to finish before importing a session."
          )
        );
      }
      const imported = (await STORE.importJSON(str)) as unknown as Session;
      // Clear the EXR side channel exactly like boot()/reset(): the retained linear
      // buffers belong to the PREVIOUS session's slots. Left in place, the next
      // analyze would attach linear_evidence computed from the old EXRs to the
      // imported session's images — and the legend tells the model to PREFER that
      // (stale) block over the correct display-referred estimates.
      set({
        session: imported,
        lastError: null,
        exrSlots: { ref: null, base: null, settings: null },
      });
      return imported;
    },

    // -- expert chat -----------------------------------------------------------------
    chatMessages() {
      const chat = get().session.chat;
      return chat && Array.isArray(chat.messages) ? chat.messages : [];
    },

    async chatAppend(msg) {
      const s = get().session;
      const prev = s.chat && Array.isArray(s.chat.messages) ? s.chat.messages : [];
      const messages = [...prev, { ...msg, at: new Date().toISOString() }];
      while (messages.length > CHAT_CAP) messages.shift();
      set({ session: { ...s, chat: { messages } } });
      await persist();
      return get().session;
    },

    async chatCheckin(input, note) {
      const s = get().session;
      if (!s.ref) {
        throw new Error(
          "Load a reference image first — a check-in is measured against the reference."
        );
      }
      if (!slotMetricsUsable(s.ref)) {
        throw new Error(METRICS_HINT);
      }
      // Same ingest as addAttempt (EXR develop branch included), but NO model call,
      // no attempt number, no history round — the chat is advisory; the formal refine
      // loop stays the source of truth (the panel offers "log as attempt" separately).
      let captured: { dataUrl: string; metrics: MetricVector };
      if (input instanceof Blob && (await isExrFile(input as File))) {
        const dev = await developExrToCanvas(input);
        captured = await captureSlot(dev.canvas as unknown as DrawableSource);
      } else {
        captured = await captureSlot(input);
      }
      const evidence: CheckinEvidence = checkinEvidence(s.ref.metrics, captured.metrics);
      const message: ChatMsg = {
        role: "user",
        content:
          note && note.trim()
            ? note.trim()
            : "Here is my latest render — check it against the reference.",
        at: new Date().toISOString(),
        checkin: {
          dataUrl: captured.dataUrl,
          score: evidence.score,
          matchPercent: evidence.matchPercent,
          evidenceText: evidence.text,
        },
      };
      const prev = get().session.chat?.messages ?? [];
      const messages = [...prev, message];
      while (messages.length > CHAT_CAP) messages.shift();
      set({ session: { ...get().session, chat: { messages } } });
      await persist();
      return {
        message,
        evidence,
        preCaptured: { dataUrl: captured.dataUrl, metrics: captured.metrics },
      };
    },

    async chatClear() {
      set({ session: { ...get().session, chat: null } });
      await persist();
      return get().session;
    },
  };
});

// -- React hook: subscribe to the vanilla store with an optional selector. In the
// next phase's UI, `const state = useEngine(s => s.state())` etc. -------------------
export function useEngine<T>(selector: (s: EngineStore) => T): T {
  return useStore(engineStore, selector);
}

// Convenience: the whole store (no selector) for components that need everything.
export function useEngineStore(): EngineStore {
  return useStore(engineStore, (s) => s);
}

export default engineStore;
