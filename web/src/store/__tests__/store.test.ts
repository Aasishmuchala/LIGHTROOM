// Store (persistence) tests — the ported vanilla STORE behavior. Runs in node with the
// browser-global shims from ../../test/setup (fake-indexeddb + localStorage + window),
// so the REAL IndexedDB path is exercised (not the in-memory degrade path).
//
// Each suite points STORE at an isolated DB name via _useDb() so a run never touches a
// real "lightmatch" database and suites don't cross-contaminate.

import "../../test/setup";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { STORE, type StoredSession } from "@/lib/store";
import { clearLocalStorage } from "../../test/setup";

// A valid 1x1 PNG data URL (matches DATAURL_RE) for the happy-path / XSS tests.
const VALID_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function validSession(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: "sess-" + Math.random().toString(36).slice(2),
    created: "2026-01-01T00:00:00.000Z",
    context: { scene: "", time: "", rig: "" },
    ref: { dataUrl: VALID_PNG },
    base: { dataUrl: VALID_PNG },
    settingsShot: null,
    activeTarget: "vray7max",
    chains: {
      vray7max: { recipe: null, attempts: [] },
      vantage33: { recipe: null, attempts: [] },
    },
    ...overrides,
  };
}

let restoreDb: string;
beforeEach(() => {
  clearLocalStorage();
  restoreDb = STORE._useDb("lightmatch-test-" + Math.random().toString(36).slice(2));
});
afterEach(() => {
  STORE._useDb(restoreDb);
});

describe("prefs", () => {
  it("returns defaults when unset", () => {
    const p = STORE.prefs();
    expect(p.model).toBe("claude-opus-4-8");
    expect(p.target).toBe("vray7max");
  });

  it("merges a partial patch over defaults and round-trips", () => {
    STORE.setPrefs({ target: "vantage33" });
    const p = STORE.prefs();
    expect(p.target).toBe("vantage33");
    expect(p.model).toBe("claude-opus-4-8"); // default preserved
  });

  it("survives a corrupt lm_prefs blob (falls back to defaults)", () => {
    localStorage.setItem("lm_prefs", "{not json");
    expect(STORE.prefs().model).toBe("claude-opus-4-8");
  });
});

describe("api key", () => {
  it("setKey TRIMS surrounding whitespace/newlines", () => {
    STORE.setKey("  sk-abc123\n");
    expect(STORE.key()).toBe("sk-abc123");
  });

  it("returns empty string when unset", () => {
    expect(STORE.key()).toBe("");
  });
});

describe("importJSON — shape validation", () => {
  it("rejects non-JSON", async () => {
    await expect(STORE.importJSON("{not json")).rejects.toThrow(/not valid JSON/);
  });

  it("rejects a missing/invalid id", async () => {
    const bad = JSON.stringify({ chains: {} });
    await expect(STORE.importJSON(bad)).rejects.toThrow(/session\.id/);
  });

  it("rejects a missing chains object", async () => {
    const bad = JSON.stringify({ id: "x" });
    await expect(STORE.importJSON(bad)).rejects.toThrow(/session\.chains/);
  });

  it("rejects a chain whose attempts is not an array", async () => {
    const bad = JSON.stringify({ id: "x", chains: { vray7max: { recipe: null, attempts: {} } } });
    await expect(STORE.importJSON(bad)).rejects.toThrow(/attempts\[\] array/);
  });

  it("rejects a recipe without an array values", async () => {
    const bad = JSON.stringify({
      id: "x",
      chains: { vray7max: { recipe: { values: "nope" }, attempts: [] } },
    });
    await expect(STORE.importJSON(bad)).rejects.toThrow(/without an array "values"/);
  });
});

describe("importJSON — XSS dataUrl boundary", () => {
  it("rejects a slot dataUrl that is not an image data URL (javascript: payload)", async () => {
    const bad = validSession({
      ref: { dataUrl: "javascript:alert(1)" } as unknown as StoredSession["ref"],
    });
    await expect(STORE.importJSON(JSON.stringify(bad))).rejects.toThrow(/invalid image payload/);
  });

  it("rejects a dataUrl smuggling an attribute-break (quote/space) in the base64 tail", async () => {
    const bad = validSession({
      base: { dataUrl: 'data:image/png;base64,AAAA" onerror=alert(1)' } as unknown as StoredSession["base"],
    });
    await expect(STORE.importJSON(JSON.stringify(bad))).rejects.toThrow(/invalid image payload/);
  });

  it("rejects a bad dataUrl hiding inside an attempt", async () => {
    const bad = validSession();
    bad.chains.vray7max.attempts = [{ dataUrl: "not-a-data-url" }];
    await expect(STORE.importJSON(JSON.stringify(bad))).rejects.toThrow(/invalid image payload/);
  });

  it("accepts a valid session and stamps created = now (so it becomes latest)", async () => {
    const s = validSession({ created: "2020-01-01T00:00:00.000Z" });
    const before = Date.now();
    const imported = await STORE.importJSON(JSON.stringify(s));
    const stampedMs = Date.parse(imported.created);
    expect(stampedMs).toBeGreaterThanOrEqual(before);
    // and it is now the latest saved session
    const latest = await STORE.loadLatest();
    expect(latest?.id).toBe(s.id);
  });
});

describe("saveSession / loadLatest / pruneToNewest", () => {
  it("loadLatest returns the highest-created session", async () => {
    await STORE.saveSession(validSession({ id: "a", created: "2026-01-01T00:00:00.000Z" }));
    await STORE.saveSession(validSession({ id: "b", created: "2026-03-01T00:00:00.000Z" }));
    await STORE.saveSession(validSession({ id: "c", created: "2026-02-01T00:00:00.000Z" }));
    const latest = await STORE.loadLatest();
    expect(latest?.id).toBe("b");
  });

  it("pruneToNewest(5) keeps only the newest 5 sessions", async () => {
    // Save 8 sessions with ascending created timestamps.
    for (let i = 0; i < 8; i++) {
      const month = String(i + 1).padStart(2, "0");
      await STORE.saveSession(validSession({ id: `s${i}`, created: `2026-${month}-01T00:00:00.000Z` }));
    }
    await STORE.pruneToNewest(5);
    const all = await STORE._all();
    expect(all.length).toBe(5);
    const ids = all.map((s) => s.id).sort();
    // The newest 5 are s3..s7 (months 04..08).
    expect(ids).toEqual(["s3", "s4", "s5", "s6", "s7"]);
  });

  it("pruneToNewest is a no-op when at or under the cap", async () => {
    await STORE.saveSession(validSession({ id: "only", created: "2026-01-01T00:00:00.000Z" }));
    await STORE.pruneToNewest(5);
    const all = await STORE._all();
    expect(all.length).toBe(1);
  });
});

describe("persistence flag", () => {
  it("reports persistent=true after a successful open (fake-indexeddb present)", async () => {
    await STORE.saveSession(validSession());
    expect(STORE.persistent).toBe(true);
  });
});
