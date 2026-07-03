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
  type DrawableSource,
} from "@/lib/metrics";
import { PACKS } from "@/lib/packs";
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
export interface AttemptEntry {
  dataUrl: string;
  metrics: MetricVector;
  score: number;
  correction: Correction;
  appliedParams: Record<string, boolean>;
}
export interface Chain {
  recipe: Recipe | null;
  attempts: AttemptEntry[];
  _attemptCount: number;
  recipeApplied?: Record<string, boolean> | null;
  _evictedScores?: { score: number }[];
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
  kind: "busy" = "busy";
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
  // but never rendered): the in-flight promise or null.
  _inFlight: Promise<unknown> | null;
  // test seam: the client adapter fn the store calls. Defaults to analyzeViaApi; tests
  // overwrite it with a stub so no /api/analyze POST is made.
  _analyze: typeof analyzeViaApi;
  // test seam: a deterministic session id for STORE round-trips.
  _testSessionId: string | null;

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
  setActiveTarget(target: TargetId | string): Promise<Session>;
  setImage(slot: ImageSlotName, input: ImageInput): Promise<ImageSlot | { dataUrl: string }>;
  analyze(): Promise<Recipe>;
  addAttempt(input: ImageInput): Promise<{ score: number; correction: Correction }>;
  reanalyzeOtherTarget(): Promise<Recipe>;
  setRecipeApplied(param: string, applied: boolean): Promise<Record<string, boolean> | null>;
  toggleAttemptApplied(
    attemptIndex: number,
    param: string
  ): Promise<Record<string, boolean> | null>;
  boot(): Promise<Session>;
  exportJSON(): Promise<string>;
  importJSON(str: string): Promise<Session>;
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

  // -- guarded(fn): run fn() behind the _inFlight gate. If a gated op is already
  // running, return THAT SAME promise (fn never invoked twice). Clears lastError on
  // entry (a fresh attempt that then succeeds must not leave the old banner up), sets
  // _inFlight synchronously before any await inside fn can run, and clears it in a
  // finally so a rejected op still unblocks the next call. --------------------------
  const guarded = <T,>(fn: () => Promise<T>): Promise<T> => {
    const existing = get()._inFlight;
    if (existing) return existing as Promise<T>;
    set({ lastError: null });
    const p = (async () => {
      try {
        return await fn();
      } finally {
        set({ _inFlight: null });
      }
    })();
    set({ _inFlight: p });
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

  // -- attempt-number helpers (monotonic per-chain; matches "ATTEMPT N:" labels). ----
  const attemptNumberForChain = (chain: Chain | null, idx: number): number => {
    if (!chain || !Array.isArray(chain.attempts)) return idx + 1;
    const L = chain.attempts.length;
    if (typeof chain._attemptCount !== "number") return idx + 1;
    return chain._attemptCount - (L - 1 - idx);
  };

  // -- history for the active chain: recipe values[] normalized as round 0, then each
  // stored attempt's correction.moves as subsequent rounds. applied_assumed is true
  // ONLY when that round's backing map is absent. ----------------------------------
  const historyForActiveChain = (): HistoryRound[] => {
    const s = get().session;
    const chain = s.chains[s.activeTarget];
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
  const analyzeImpl = async (): Promise<Recipe> => {
    const s = get().session;
    if (deriveState(s) === "empty") {
      throw new Error(
        "analyze(): requires both reference and base images to be set first."
      );
    }
    const target = s.activeTarget;
    const metricsBundle = {
      reference: s.ref!.metrics,
      base: s.base!.metrics,
      diff: diffVectors(s.base!.metrics, s.ref!.metrics),
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
    const system = systemPrompt(target, "recipe");
    const userContent = buildUserContent({ mode: "recipe", images, metricsBundle, context: s.context });

    let cleaned: Record<string, unknown>;
    try {
      cleaned = await get()._analyze({
        model: STORE.prefs().model,
        system,
        userContent,
        tool: EMIT_RECIPE,
        mode: "recipe",
        target,
      });
    } catch (e) {
      throw annotateError(e);
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
    const target = s.activeTarget;
    const chain = s.chains[target];
    const captured = await captureSlot(input);
    const score = scoreVectors(s.ref!.metrics, captured.metrics);

    const metricsBundle = {
      reference: s.ref!.metrics,
      attempt: captured.metrics,
      diff: diffVectors(captured.metrics, s.ref!.metrics),
    };
    if (typeof chain._attemptCount !== "number") chain._attemptCount = chain.attempts.length;
    chain._attemptCount++;
    const attemptN = chain._attemptCount;
    const images: AdapterImage[] = [
      { role: "reference", dataUrl: s.ref!.dataUrl, mediaType: mediaTypeFromDataUrl(s.ref!.dataUrl) },
      { role: "attempt", n: attemptN, dataUrl: captured.dataUrl, mediaType: mediaTypeFromDataUrl(captured.dataUrl) },
    ];
    const history = historyForActiveChain();
    const system = systemPrompt(target, "correction");
    const userContent = buildUserContent({
      mode: "correction",
      images,
      metricsBundle,
      context: s.context,
      history,
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
    } catch (e) {
      throw annotateError(e);
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
    set({ session: { ...get().session } });
    await persist();
    return { score, correction };
  };

  return {
    session: blankSession(null),
    lastError: null,
    storagePersistent: true,
    _inFlight: null,
    _analyze: analyzeViaApi,
    _testSessionId: null,

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
      set({ session: s, lastError: null });
      return s;
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
      const captured = await captureSlot(input, { lossless: slot === "settings" });
      const s = get().session;
      const next = { ...s };
      if (slot === "ref") next.ref = captured;
      else if (slot === "base") next.base = captured;
      else if (slot === "settings") next.settingsShot = { dataUrl: captured.dataUrl };
      else throw new Error(`setImage: unknown slot "${slot}" (expected ref|base|settings)`);
      set({ session: next });
      await persist();
      return slot === "settings" ? { dataUrl: captured.dataUrl } : captured;
    },

    analyze() {
      return guarded(() => analyzeImpl());
    },

    addAttempt(input) {
      return guarded(() => addAttemptImpl(input));
    },

    reanalyzeOtherTarget() {
      return guarded(async () => {
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
      const chain = get().activeChain();
      if (!chain) return null;
      if (!chain.recipeApplied || typeof chain.recipeApplied !== "object") chain.recipeApplied = {};
      chain.recipeApplied[param] = !!applied;
      set({ session: { ...get().session } });
      await persist();
      return chain.recipeApplied;
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
      const chain = get().activeChain();
      if (!chain || !chain.attempts[attemptIndex]) return null;
      const att = chain.attempts[attemptIndex];
      att.appliedParams = att.appliedParams || {};
      att.appliedParams[param] = att.appliedParams[param] === false ? true : false;
      set({ session: { ...get().session } });
      await persist();
      return att.appliedParams;
    },

    async boot() {
      try {
        const latest = await STORE.loadLatest();
        set({ session: (latest as unknown as Session) || blankSession(get()._testSessionId) });
      } catch (e) {
        annotateError(e);
        set({ session: blankSession(get()._testSessionId) });
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
      const imported = (await STORE.importJSON(str)) as unknown as Session;
      set({ session: imported, lastError: null });
      return imported;
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
