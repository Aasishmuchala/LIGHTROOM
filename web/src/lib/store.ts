// LightMatch persistence — ported faithfully from the vanilla app (lightmatch.html)
// STORE section. Adapted to Next.js/React idioms:
//   - localStorage access is SSR-guarded (typeof window) so importing this module on
//     the server never throws; on the server every localStorage-backed getter returns
//     its default and every setter is a silent no-op.
//   - IndexedDB is spoken via the `idb` package (openDB) rather than raw request
//     plumbing, but the behavior contract is identical to the vanilla source.
//
// Depends only on ./types — no React, no Zustand, no DOM beyond the storage globals it
// feature-detects.
//
// Degrade-never-throw contract (unchanged from vanilla): if IndexedDB is unavailable
// (SSR, private browsing, disabled storage, an open that rejects), STORE falls back to
// an in-memory Map and sets `persistent = false`. Nothing here ever throws out of boot;
// a failed IDB open is caught internally and the in-memory path takes over silently.

import { openDB, type IDBPDatabase } from "idb";
import type { TargetId } from "./types";
// KNOWN_PROPS is the allow-list that sanitizes the LIVE-pull path (max-bridge.mapPullResult).
// The import/persist path needs the SAME boundary, else a hand-crafted session file smuggles
// attacker-chosen rows into the model-facing "CURRENT SCENE SETTINGS" block. Pure map, no DOM.
import { KNOWN_PROPS } from "./export";

// ---------------------------------------------------------------------------
// Types for the persisted shapes this module validates (kept loose on purpose —
// the exact session object is ENGINE-owned; STORE only asserts the invariants the
// import boundary must guarantee).
// ---------------------------------------------------------------------------

export interface Prefs {
  model: string;
  target: TargetId | string;
  /** Consensus ×3 (2026-07-05 addition, ADDITIVE): when true, analyze() fires THREE
   *  identical model calls and merges them into one recipe (median numerics, majority
   *  strings) to kill run-to-run LLM variance — steadier values at 3× cost/time.
   *  Old lm_prefs blobs LACK this key; prefs() fills it from PREFS_DEFAULTS (false). */
  consensus: boolean;
}

/** A stored image slot: a data URL plus (for ref/base) its measured metrics. */
export interface StoredSlot {
  dataUrl: string;
  metrics?: unknown;
}

/** One settled parameter of a matched session: the LAST value the chain landed on
 *  (recipe round 0 then every correction, last write per param wins, applied-only). */
export interface PriorValue {
  param: string;
  value: number | string;
}

/** A scene prior (2026-07-05 addition): the settled values of a PAST session that
 *  reached the measured match gate (or a handoff_to_grade), keyed by target + the
 *  user's scene-context chips. The engine saves one when a chain lands; analyze()
 *  looks the best one up so a similar new scene starts biased toward a known-good
 *  landing zone instead of from scratch. */
export interface Prior {
  target: TargetId | string;
  /** The session's context chips as saved ({scene, time, rig}; extra keys allowed).
   *  Matching is EXACT-equality on non-empty fields — priors never fuzzy-match. */
  context: Record<string, string>;
  values: PriorValue[];
  /** The measured "% match" the session settled at (metrics.matchPercent of the
   *  triggering score) — travels into the prompt so the model knows how good the
   *  landing zone was. */
  matchPercent: number;
  /** ISO timestamp of the save — the recency tiebreaker in bestPrior. */
  at: string;
}

/** One per-target chain as persisted. Kept loose; ENGINE owns the exact recipe shape. */
export interface StoredChain {
  recipe: { values?: unknown[] } | null;
  attempts: unknown[];
  [k: string]: unknown;
}

/** A persisted session. `id`/`created`/`chains` are the load-bearing invariants. */
export interface StoredSession {
  id: string;
  created: string;
  /** Optional human label (session switcher rename); capped at NAME_CAP. */
  name?: string;
  context?: Record<string, unknown>;
  ref?: StoredSlot | null;
  base?: StoredSlot | null;
  settingsShot?: StoredSlot | null;
  activeTarget?: TargetId | string;
  chains: Record<string, StoredChain>;
  [k: string]: unknown;
}

/** What the session switcher lists — everything needed to recognize a session,
 *  none of its weight (attempt images etc. are NOT retained). */
export interface SessionSummary {
  id: string;
  created: string;
  name: string;
  activeTarget: string;
  /** The reference thumbnail (already-downscaled slot dataUrl), DATAURL_RE-vetted. */
  refThumb: string | null;
  attempts: number;
  /** Minimum look-distance across both chains' attempts; null when never scored. */
  bestScore: number | null;
  hasRecipe: boolean;
  lockGlobals: boolean;
}

const isBrowser = (): boolean => typeof window !== "undefined";

// A localStorage handle that is null on the server / where storage is blocked.
function ls(): Storage | null {
  try {
    if (!isBrowser()) return null;
    return window.localStorage;
  } catch {
    // Access to localStorage can throw in some embedder policies even in a browser.
    return null;
  }
}

// ---------------------------------------------------------------------------
// STORE — object literal that mirrors the vanilla single namespace so behavior maps
// one-to-one. Methods are written as an object (not a class) to match the vanilla
// source's shape; `this` is bound through normal method dispatch.
// ---------------------------------------------------------------------------

export const STORE = {
  // -- API key: localStorage under "lm_key". setKey TRIMS (pasted keys carry trailing
  // newlines/spaces and produce mystifying 401s). Note: in the Next.js port the key is
  // sent to our OWN /api/analyze route via a header, not to the gateway directly — but
  // it still lives here so the client can read it back into the key field. -----------
  key(): string {
    return ls()?.getItem("lm_key") || "";
  },
  setKey(k: string | null | undefined): void {
    ls()?.setItem("lm_key", (k || "").trim());
  },

  // -- prefs: {model, target, consensus}, localStorage JSON, defaults filled in on read
  PREFS_DEFAULTS: { model: "claude-opus-4-8", target: "vray7max", consensus: false } as Prefs,
  prefs(): Prefs {
    let stored: Partial<Prefs> = {};
    try {
      stored = JSON.parse(ls()?.getItem("lm_prefs") || "{}") || {};
    } catch {
      stored = {};
    }
    return Object.assign({}, this.PREFS_DEFAULTS, stored);
  },
  setPrefs(patch: Partial<Prefs>): Prefs {
    const merged = Object.assign({}, this.prefs(), patch || {});
    ls()?.setItem("lm_prefs", JSON.stringify(merged));
    return merged;
  },

  // -- SCENE PRIORS (2026-07-05 addition): "remember what worked" ----------------------
  // localStorage JSON array under "lm_priors", capped FIFO at PRIORS_CAP (oldest out —
  // a prior that survived 20 later matches is stale by definition). Lives in
  // localStorage, NOT IndexedDB: priors must outlive the 5-session IDB retention cap
  // (that cap is the whole reason they exist) and are tiny (params + scalars, no
  // images). Degrade-never-throw, like everything else in STORE: a corrupt/missing
  // blob reads as [], a blocked or full localStorage makes savePrior a silent no-op —
  // priors are a BIAS, never load-bearing state.
  PRIORS_KEY: "lm_priors",
  PRIORS_CAP: 20,

  // -- loadPriors(): every stored prior, oldest-first (append order). Rows that fail
  // the minimal shape check (object with a string target and an array values) are
  // dropped silently — one corrupt row must not poison the rest. ---------------------
  loadPriors(): Prior[] {
    try {
      const raw = ls()?.getItem(this.PRIORS_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (p): p is Prior =>
          !!p &&
          typeof p === "object" &&
          typeof (p as Prior).target === "string" &&
          Array.isArray((p as Prior).values)
      );
    } catch {
      return [];
    }
  },

  // -- savePrior(p): append + FIFO-trim + write back. Re-reads through loadPriors()
  // so a corrupt existing blob heals to [p] instead of throwing. Never throws
  // (localStorage.setItem can throw QuotaExceeded even when available). --------------
  savePrior(p: Prior): void {
    try {
      if (!p || typeof p.target !== "string" || !Array.isArray(p.values)) return;
      const all = this.loadPriors();
      all.push(p);
      while (all.length > this.PRIORS_CAP) all.shift(); // FIFO: oldest out
      ls()?.setItem(this.PRIORS_KEY, JSON.stringify(all));
    } catch {
      /* degrade: a prior that fails to save costs nothing but a lost head start */
    }
  },

  // -- bestPrior(target, context): the most relevant stored prior, or null. A prior
  // qualifies only on the SAME target AND at least one EXACTLY-equal NON-EMPTY context
  // field (empty-vs-empty is not a signal — every blank session would "match" every
  // other). Ranking: more matching fields wins; ties go to the NEWER `at` (a fresher
  // landing zone reflects the user's current workflow). `>=` on the tie so equal
  // timestamps fall to the later-stored (newer) row. ---------------------------------
  bestPrior(
    target: TargetId | string,
    context: Record<string, unknown> | null | undefined
  ): Prior | null {
    try {
      let best: Prior | null = null;
      let bestMatches = 0;
      let bestAt = "";
      for (const p of this.loadPriors()) {
        if (p.target !== target) continue;
        let matches = 0;
        if (context && p.context && typeof p.context === "object") {
          for (const [k, v] of Object.entries(context)) {
            if (typeof v === "string" && v !== "" && p.context[k] === v) matches++;
          }
        }
        if (matches < 1) continue;
        const at = typeof p.at === "string" ? p.at : "";
        if (matches > bestMatches || (matches === bestMatches && at >= bestAt)) {
          best = p;
          bestMatches = matches;
          bestAt = at;
        }
      }
      return best;
    } catch {
      return null;
    }
  },

  // -- IndexedDB plumbing -------------------------------------------------------------
  // DB_NAME is the real user database; _dbName is the ACTIVE name (a test seam so
  // suites can isolate against "lightmatch-test-*" and never touch the user's rows).
  DB_NAME: "lightmatch",
  DB_VERSION: 1,
  STORE_NAME: "sessions",
  _dbName: "lightmatch",
  persistent: true,
  _dbPromise: null as Promise<IDBPDatabase | null> | null,
  _mem: new Map<string, StoredSession>(), // in-memory fallback, keyed by session id

  // -- _useDb(name): switch the active IDB database name and invalidate the cached open
  // promise (a later _openDB() reopens against the new name). Also clears the in-memory
  // fallback map so an isolated test can't see the user's rows. Returns the previous
  // name so a caller can restore it in a finally. ------------------------------------
  _useDb(name: string): string {
    const prev = this._dbName;
    this._dbName = name;
    this._dbPromise = null;
    this._mem = new Map();
    return prev;
  },

  // -- _openDB(): open (lazily, cached) the active database via idb. Never rejects —
  // resolves to null and flips `persistent = false` when IDB is unavailable (SSR, no
  // indexedDB global, blocked storage, an open that throws). ------------------------
  _openDB(): Promise<IDBPDatabase | null> {
    if (this._dbPromise) return this._dbPromise;
    const storeName = this.STORE_NAME;
    this._dbPromise = (async () => {
      try {
        if (!isBrowser() || typeof indexedDB === "undefined") {
          this.persistent = false;
          return null;
        }
        const db = await openDB(this._dbName, this.DB_VERSION, {
          upgrade(database) {
            if (!database.objectStoreNames.contains(storeName)) {
              database.createObjectStore(storeName, { keyPath: "id" });
            }
          },
        });
        this.persistent = true;
        return db;
      } catch {
        this.persistent = false;
        return null;
      }
    })();
    return this._dbPromise;
  },

  // -- saveSession(s): upsert by id (IDB `put` is upsert-by-keyPath natively; the
  // in-memory fallback mirrors that with Map.set on the same id). The in-memory path
  // round-trips through JSON to decouple the stored copy from the caller's live object
  // (matching IDB's structured-clone copy-on-write semantics). -----------------------
  async saveSession(s: StoredSession): Promise<StoredSession> {
    const db = await this._openDB();
    if (!db) {
      this._mem.set(s.id, JSON.parse(JSON.stringify(s)));
      return s;
    }
    await db.put(this.STORE_NAME, s);
    return s;
  },

  // -- _all(): every stored session, unordered. In-memory path returns FRESH copies so
  // it matches IDB's getAll(), which deserializes a new object per call. ------------
  async _all(): Promise<StoredSession[]> {
    const db = await this._openDB();
    if (!db) {
      return Array.from(this._mem.values()).map((s) => JSON.parse(JSON.stringify(s)));
    }
    return (await db.getAll(this.STORE_NAME)) as StoredSession[];
  },

  // -- loadLatest(): the session with the highest `created` (ISO string — lexical
  // comparison is correct for same-format ISO-8601 timestamps). null if none exist. --
  async loadLatest(): Promise<StoredSession | null> {
    const all = await this._all();
    if (!all.length) return null;
    let best = all[0];
    for (const s of all) if (s.created > best.created) best = s;
    return best;
  },

  // -- deleteSession(id): removes a session by id (the retention/prune building block
  // and the test-cleanup mechanism). ------------------------------------------------
  async deleteSession(id: string): Promise<void> {
    const db = await this._openDB();
    if (!db) {
      this._mem.delete(id);
      return;
    }
    await db.delete(this.STORE_NAME, id);
  },

  // -- loadById(id): one session by key, or null. The session-switcher open path. ----
  async loadById(id: string): Promise<StoredSession | null> {
    const db = await this._openDB();
    if (!db) {
      const s = this._mem.get(id);
      return s ? (JSON.parse(JSON.stringify(s)) as StoredSession) : null;
    }
    return ((await db.get(this.STORE_NAME, id)) as StoredSession | undefined) ?? null;
  },

  // -- listSessions(): lightweight summaries of EVERY stored session, newest first —
  // the session-switcher's list. Full sessions are deserialized (IDB stores whole
  // objects) but only summary fields are RETAINED, so the big image payloads are
  // immediately collectible. bestScore is the minimum look-distance across BOTH
  // chains' attempts (the session's closest approach, whichever target) — the UI
  // renders it via matchPercent; null when no attempt was ever scored. --------------
  async listSessions(): Promise<SessionSummary[]> {
    const all = await this._all();
    const summaries = all.map((s) => {
      let bestScore: number | null = null;
      let attempts = 0;
      for (const key of Object.keys(s.chains || {})) {
        const chain = s.chains[key];
        const rows = chain && Array.isArray(chain.attempts) ? chain.attempts : [];
        attempts += rows.length;
        for (const a of rows as Array<{ score?: unknown }>) {
          if (a && typeof a.score === "number" && Number.isFinite(a.score)) {
            bestScore = bestScore === null ? a.score : Math.min(bestScore, a.score);
          }
        }
      }
      const hasRecipe = Object.keys(s.chains || {}).some((k) => !!s.chains[k]?.recipe);
      return {
        id: s.id,
        created: s.created,
        name: typeof s.name === "string" ? s.name : "",
        activeTarget: typeof s.activeTarget === "string" ? s.activeTarget : "vray7max",
        refThumb:
          s.ref && typeof s.ref.dataUrl === "string" && this.DATAURL_RE.test(s.ref.dataUrl)
            ? s.ref.dataUrl
            : null,
        attempts,
        bestScore,
        hasRecipe,
        lockGlobals: (s as { lockGlobals?: unknown }).lockGlobals === true,
      };
    });
    summaries.sort((a, b) => (a.created > b.created ? -1 : a.created < b.created ? 1 : 0));
    return summaries;
  },

  // -- renameSession(id, name): stamp a human label on a stored session (trimmed,
  // capped — same cap the import boundary enforces). No-op on a missing id. ----------
  async renameSession(id: string, name: string): Promise<void> {
    const s = await this.loadById(id);
    if (!s) return;
    s.name = String(name ?? "").trim().slice(0, this.NAME_CAP);
    await this.saveSession(s);
  },
  NAME_CAP: 60,

  // -- pruneToNewest(n): keep only the newest n sessions by `created`, deleting older
  // rows (highest survives — same ordering rule as loadLatest). Best-effort: a delete
  // failure on one row must not stop the rest. Default raised 5 → 24 (2026-07-13):
  // Area mode means ONE SESSION PER AREA on a big project — a cap of 5 silently ate
  // a six-room job's earlier rooms. -------------------------------------------------
  async pruneToNewest(n = 24): Promise<void> {
    const all = await this._all();
    if (all.length <= n) return;
    const sorted = all
      .slice()
      .sort((a, b) => (a.created > b.created ? -1 : a.created < b.created ? 1 : 0));
    const toDelete = sorted.slice(n);
    for (const s of toDelete) {
      try {
        await this.deleteSession(s.id);
      } catch {
        /* best-effort; one bad row must not stop the rest */
      }
    }
  },

  // -- exportJSON(session?): JSON string of the given session, or the latest SAVED one
  // when called with no argument (per the vanilla contract). ------------------------
  async exportJSON(session?: StoredSession): Promise<string> {
    const s = session !== undefined ? session : await this.loadLatest();
    return JSON.stringify(s);
  },

  // -- DATAURL_RE: the SINGLE source of truth for "is this dataUrl safe to put in an
  // <img src>". Deliberately strict — charset locked to [A-Za-z0-9+/=], so a smuggled
  // quote/space/angle-bracket that would break out of src="..." can never match. ----
  DATAURL_RE: /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/,

  // -- _validImportedDataUrl(v): acceptable when absent/null (the shape allows null
  // slots) OR a string matching DATAURL_RE. Any OTHER value is a violation. ---------
  _validImportedDataUrl(v: unknown): boolean {
    if (v === undefined || v === null) return true;
    return typeof v === "string" && this.DATAURL_RE.test(v);
  },

  // -- _sanitizeImportedLiveSettings(v): the import analogue of mapPullResult's KNOWN_PROPS
  // gate. liveSettings flows VERBATIM into buildUserContent's high-trust "CURRENT SCENE
  // SETTINGS" evidence block (client-adapter.ts), so an imported file must not be allowed to
  // inject arbitrary keys/values or an unbounded number of rows. Returns a CLEAN object, or
  // null when absent/malformed (null is a valid persisted state — older sessions lack it).
  // Drops any params key not in KNOWN_PROPS (own-property check — never inherited names),
  // coerces values to finite number | string, and is naturally capped by |KNOWN_PROPS|.
  _sanitizeImportedLiveSettings(v: unknown): {
    renderer: string;
    at: string;
    counts: { suns: number; vrayLights: number; physCams: number };
    params: Record<string, number | string>;
  } | null {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const rawParams =
      o.params && typeof o.params === "object" && !Array.isArray(o.params)
        ? (o.params as Record<string, unknown>)
        : {};
    const params: Record<string, number | string> = {};
    for (const [k, val] of Object.entries(rawParams)) {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_PROPS, k)) continue; // allow-list only
      if (typeof val === "number" && Number.isFinite(val)) params[k] = val;
      else if (typeof val === "string") params[k] = val;
    }
    // Nothing survivable → treat as no live block rather than persisting an empty husk.
    if (!Object.keys(params).length) return null;
    const rawCounts =
      o.counts && typeof o.counts === "object" ? (o.counts as Record<string, unknown>) : {};
    return {
      renderer: typeof o.renderer === "string" ? o.renderer : "unknown",
      at: typeof o.at === "string" ? o.at : "",
      counts: {
        suns: Number(rawCounts.suns) || 0,
        vrayLights: Number(rawCounts.vrayLights) || 0,
        physCams: Number(rawCounts.physCams) || 0,
      },
      params,
    };
  },

  // -- _sanitizeImportedChat(v): the import gate for the expert-chat transcript
  // (session.chat). Chat text is rendered as React text nodes (no HTML sink), so
  // malformed rows are DROPPED rather than fatal — but a check-in dataUrl feeds an
  // <img src> exactly like slot/attempt images, so an invalid one REJECTS the whole
  // import (same poison-file stance as the slot walk in importJSON). Caps lengths and
  // message count so an imported file can't smuggle unbounded model-facing text. ----
  CHAT_IMPORT_CAP: 40,
  CHAT_TEXT_CAP: 8000,
  _sanitizeImportedChat(v: unknown): { messages: unknown[] } | null {
    if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
    const raw = (v as { messages?: unknown }).messages;
    if (!Array.isArray(raw)) return null;
    const REJECT = "importJSON: session file contains an invalid image payload.";
    const messages: unknown[] = [];
    for (const m of raw) {
      if (!m || typeof m !== "object") continue;
      const o = m as Record<string, unknown>;
      if (o.role !== "user" && o.role !== "assistant") continue;
      if (typeof o.content !== "string") continue;
      const clean: Record<string, unknown> = {
        role: o.role,
        content: o.content.slice(0, this.CHAT_TEXT_CAP),
        at: typeof o.at === "string" ? o.at.slice(0, 40) : "",
      };
      if (o.checkin != null) {
        if (typeof o.checkin !== "object" || Array.isArray(o.checkin)) continue;
        const c = o.checkin as Record<string, unknown>;
        if (!this._validImportedDataUrl(c.dataUrl) || typeof c.dataUrl !== "string") {
          throw new Error(REJECT);
        }
        clean.checkin = {
          dataUrl: c.dataUrl,
          score: typeof c.score === "number" && Number.isFinite(c.score) ? c.score : 0,
          matchPercent:
            typeof c.matchPercent === "number" && Number.isFinite(c.matchPercent)
              ? c.matchPercent
              : 0,
          evidenceText:
            typeof c.evidenceText === "string" ? c.evidenceText.slice(0, this.CHAT_TEXT_CAP) : "",
        };
      }
      messages.push(clean);
    }
    if (!messages.length) return null;
    return { messages: messages.slice(-this.CHAT_IMPORT_CAP) };
  },

  // -- importJSON(str): validate the session shape, reject malformed with a clear
  // message, stamp `created` = now (so the import becomes loadLatest()'s newest and
  // survives prune), enforce the XSS boundary on every dataUrl, then save. ----------
  async importJSON(str: string): Promise<StoredSession> {
    let obj: unknown;
    try {
      obj = JSON.parse(str);
    } catch {
      throw new Error("importJSON: not valid JSON");
    }
    const o = obj as StoredSession;
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !o.id) {
      throw new Error("importJSON: missing/invalid session.id");
    }
    if (!o.chains || typeof o.chains !== "object") {
      throw new Error("importJSON: missing session.chains");
    }
    // -- SESSION-SHAPE VALIDATION: every chain must be a {recipe, attempts:[]} object
    // with attempts an ARRAY, and any recipe present must carry an array `values`.
    for (const target of Object.keys(o.chains)) {
      const chain = o.chains[target] as StoredChain;
      if (!chain || typeof chain !== "object") {
        throw new Error(`importJSON: chain "${target}" is not an object.`);
      }
      if (!Array.isArray(chain.attempts)) {
        throw new Error(`importJSON: chain "${target}" is missing an attempts[] array.`);
      }
      if (chain.recipe != null && !Array.isArray(chain.recipe.values)) {
        throw new Error(`importJSON: chain "${target}" has a recipe without an array "values".`);
      }
    }
    // -- ACTIVATE THE IMPORT: stamp `created` to now so loadLatest() returns it and
    // prune can't drop it as stale (deliberately overrides any timestamp in the file).
    // STRICTLY AFTER the current latest: loadLatest() compares with `>` — an import
    // landing in the same millisecond as the last save would TIE on the ISO string and
    // lose to IndexedDB key order, so the imported session would silently not load.
    let stamp = new Date().toISOString();
    const prev = await this.loadLatest();
    if (prev && prev.created >= stamp) {
      const prevMs = Date.parse(prev.created);
      if (Number.isFinite(prevMs)) stamp = new Date(prevMs + 1).toISOString();
    }
    o.created = stamp;
    // -- STORED-XSS BOUNDARY (CRITICAL): every dataUrl-bearing field is untrusted and
    // flows into an <img src="${...}"> sink. Walk them all and REJECT the whole import
    // on the first bad payload — do NOT strip-and-continue.
    const REJECT = "importJSON: session file contains an invalid image payload.";
    const slotVals = [o.ref?.dataUrl, o.base?.dataUrl, o.settingsShot?.dataUrl];
    for (const dv of slotVals) {
      if (!this._validImportedDataUrl(dv)) throw new Error(REJECT);
    }
    for (const target of Object.keys(o.chains)) {
      const chain = o.chains[target] as StoredChain;
      const attempts = chain && Array.isArray(chain.attempts) ? chain.attempts : [];
      for (const att of attempts as Array<{ dataUrl?: unknown }>) {
        if (att && !this._validImportedDataUrl(att.dataUrl)) throw new Error(REJECT);
      }
    }
    // -- LIVE-SETTINGS BOUNDARY: liveSettings never went through the KNOWN_PROPS allow-list
    // (that lives on the pull path only), so an imported file could carry arbitrary,
    // unbounded, model-facing rows. Replace it with a sanitized copy (or null). Cast through
    // the loose StoredSession shape — this field is engine-owned and not in STORE's type.
    (o as unknown as { liveSettings?: unknown }).liveSettings =
      this._sanitizeImportedLiveSettings((o as unknown as { liveSettings?: unknown }).liveSettings);
    // -- CHAT BOUNDARY: same posture — sanitize the transcript (or drop it); an
    // invalid check-in dataUrl inside it throws REJECT from the sanitizer itself.
    (o as unknown as { chat?: unknown }).chat = this._sanitizeImportedChat(
      (o as unknown as { chat?: unknown }).chat
    );
    // -- AREA-MODE FLAG: engine-owned boolean; anything but literal true imports as
    // false (a truthy string here would silently lock a session's globals).
    (o as unknown as { lockGlobals?: unknown }).lockGlobals =
      (o as unknown as { lockGlobals?: unknown }).lockGlobals === true;
    // -- NAME: plain trimmed string, same cap renameSession enforces; anything else
    // drops to absent (a non-string name must not reach the switcher list).
    if (typeof o.name === "string") o.name = o.name.trim().slice(0, this.NAME_CAP);
    else delete (o as { name?: unknown }).name;
    await this.saveSession(o);
    return o;
  },
};

export default STORE;
