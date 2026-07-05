// Engine + store stress — flooding, concurrency spam, failure-mode recovery, and
// persistence under bulk. The invariants under attack:
//   - the attempt ledger stays bounded (ATTEMPTS_CAP) with correct numbering after
//     heavy eviction, and evicted scores are retained;
//   - the in-flight guard makes concurrent calls coalesce (never double-spends a
//     gateway call) and gated mutations throw BusyError instead of corrupting state;
//   - every adapter failure kind annotates lastError and leaves the session usable;
//   - the store survives bulk sessions + prune and big import round-trips.

import "../../test/setup";
import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  engineStore,
  ATTEMPTS_CAP,
  BusyError,
  type PreCaptured,
  type EngineStore,
} from "@/store/useEngine";
import { STORE, type StoredSession } from "@/lib/store";
import { AdapterError, type AdapterErrorKind } from "@/lib/client-adapter";
import type { MetricVector } from "@/lib/types";
import { clearLocalStorage } from "../../test/setup";

function metricVector(bias = 0): MetricVector {
  return {
    lum: { p1: 0.01 + bias, p5: 0.05 + bias, p25: 0.25 + bias, p50: 0.5 + bias, p75: 0.75 + bias, p95: 0.95, p99: 0.99, mean: 0.5 + bias },
    clip: { hi: 0.02, lo: 0.02 },
    contrast: { spread: 0.9, midSlope: 1.0 },
    wb: { shadow: { r: 0.1, g: 0.1, b: 0.1 }, highlight: { r: 0.8, g: 0.8, b: 0.8 }, warmthShadow: bias, warmthHighlight: 0, tint: 0 },
    sat: { mean: 0.2, p95: 0.4 },
    grid: new Array(16).fill(0.5),
  };
}
const PNG = "data:image/png;base64,AAAA";
const pre = (bias = 0): PreCaptured => ({ dataUrl: PNG, metrics: metricVector(bias) });

const fakeRecipe = () => ({
  baseline: "factory_defaults", hdri_mood: "clear",
  values: [{ param: "sun.intensity_mult", set: 1.2, from: 1.0, step: 2, confidence: "high", why: "w" }],
  rationale: "r", gi_notes: "g", status: "continue",
});
const fakeCorrection = (n: number) => ({
  moves: [{ param: "sun.intensity_mult", to: 1 + n / 100, from: 1.2, step: 2, confidence: "high", why: `trim ${n}` }],
  rationale: "r", status: "continue", status_reason: "s", applied_assumed: true,
});

beforeEach(async () => {
  clearLocalStorage();
  STORE._useDb("lightmatch-stress-" + Math.random().toString(36).slice(2));
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
  let n = 0;
  engineStore.setState({
    _analyze: vi.fn(async ({ mode }: { mode: string }) =>
      mode === "correction" ? fakeCorrection(++n) : fakeRecipe()
    ) as EngineStore["_analyze"],
  });
});

async function seedAnalyzed() {
  const st = engineStore.getState();
  await st.setImage("ref", pre(0));
  await st.setImage("base", pre(0.1));
  await st.analyze();
}

describe("attempt flooding — 20 attempts against a cap of 8", () => {
  it("ledger stays bounded, numbering stays monotonic, evicted scores retained", async () => {
    await seedAnalyzed();
    for (let i = 0; i < 20; i++) {
      await engineStore.getState().addAttempt(pre(0.2 - i * 0.005));
    }
    const st = engineStore.getState();
    const chain = st.activeChain()!;
    expect(chain.attempts.length).toBe(ATTEMPTS_CAP);
    expect(chain._attemptCount).toBe(20);
    expect(st.attemptInfo()).toEqual({ n: 20, cap: ATTEMPTS_CAP, stored: ATTEMPTS_CAP });
    // Oldest stored row is attempt 13 (20 - 8 + 1), newest is 20.
    expect(st.attemptNumberAt(0)).toBe(13);
    expect(st.attemptNumberAt(ATTEMPTS_CAP - 1)).toBe(20);
    expect(chain._evictedScores?.length).toBe(12);
    // Session survived 20 persists and still round-trips through the store.
    const loaded = await STORE.loadLatest();
    expect(loaded?.chains.vray7max.attempts.length).toBe(ATTEMPTS_CAP);
  });
});

describe("concurrency spam", () => {
  it("5 synchronous analyze() calls coalesce into ONE gateway call", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    const spy = engineStore.getState()._analyze as ReturnType<typeof vi.fn>;
    const results = await Promise.all([st.analyze(), st.analyze(), st.analyze(), st.analyze(), st.analyze()]);
    expect(spy).toHaveBeenCalledTimes(1);
    // Every caller received the same resolved recipe.
    for (const r of results) expect(r).toBe(results[0]);
  });

  it("addAttempt during in-flight analyze coalesces to the SAME promise (no orphan attempt)", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    let release!: (v: Record<string, unknown>) => void;
    engineStore.setState({
      _analyze: vi.fn(() => new Promise((res) => { release = res; })) as unknown as EngineStore["_analyze"],
    });
    const p1 = st.analyze();
    const p2 = st.addAttempt(pre(0.05)); // guarded -> returns the in-flight analyze promise
    release(fakeRecipe());
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2 as unknown);
    expect(engineStore.getState().activeChain()!.attempts.length).toBe(0);
  });

  it("setImage / applied-toggles during in-flight throw BusyError and change nothing", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    let release!: (v: Record<string, unknown>) => void;
    engineStore.setState({
      _analyze: vi.fn(() => new Promise((res) => { release = res; })) as unknown as EngineStore["_analyze"],
    });
    const inFlight = st.analyze();
    await expect(st.setImage("ref", pre(0.3))).rejects.toBeInstanceOf(BusyError);
    await expect(st.setRecipeApplied("sun.intensity_mult", false)).rejects.toBeInstanceOf(BusyError);
    await expect(st.toggleAttemptApplied(0, "sun.intensity_mult")).rejects.toBeInstanceOf(BusyError);
    release(fakeRecipe());
    await inFlight;
    // The ref image was NOT swapped by the rejected call.
    expect(engineStore.getState().session.ref!.metrics.lum.p50).toBe(0.5);
  });
});

describe("failure-mode recovery — every adapter kind, then success", () => {
  const KINDS: AdapterErrorKind[] = ["auth", "network", "truncated", "shape", "invalid", "other"];
  it.each(KINDS)("%s: lastError annotated, state stays ready, next call succeeds", async (kind) => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    engineStore.setState({
      _analyze: vi.fn(async () => { throw new AdapterError("boom " + kind, kind); }) as EngineStore["_analyze"],
    });
    await expect(st.analyze()).rejects.toThrow("boom " + kind);
    expect(engineStore.getState().lastError?.kind).toBe(kind);
    expect(engineStore.getState().state()).toBe("ready"); // no phantom recipe
    expect(engineStore.getState().activeChain()!.recipe).toBeNull();
    // Recovery: a working adapter clears the error and lands the recipe.
    engineStore.setState({ _analyze: vi.fn(async () => fakeRecipe()) as EngineStore["_analyze"] });
    await engineStore.getState().analyze();
    expect(engineStore.getState().lastError).toBeNull();
    expect(engineStore.getState().state()).toBe("analyzed");
  });
});

describe("failed refine rounds must not corrupt the ledger numbering", () => {
  it("a gateway failure mid-round consumes NO attempt number (labels stay put)", async () => {
    await seedAnalyzed();
    await engineStore.getState().addAttempt(pre(0.05)); // attempt 1, stored
    expect(engineStore.getState().attemptNumberAt(0)).toBe(1);

    // Three consecutive failures — a realistic omega-outage burst.
    engineStore.setState({
      _analyze: vi.fn(async () => { throw new AdapterError("gateway 500", "network"); }) as EngineStore["_analyze"],
    });
    for (let i = 0; i < 3; i++) {
      await expect(engineStore.getState().addAttempt(pre(0.04))).rejects.toThrow("gateway 500");
    }
    // The stored attempt is STILL attempt 1; the caption count did not inflate.
    expect(engineStore.getState().attemptInfo()).toEqual({ n: 1, cap: 8, stored: 1 });
    expect(engineStore.getState().attemptNumberAt(0)).toBe(1);

    // Recovery: the next successful round is attempt 2, not attempt 5.
    let n = 0;
    engineStore.setState({
      _analyze: vi.fn(async () => fakeCorrection(++n)) as EngineStore["_analyze"],
    });
    await engineStore.getState().addAttempt(pre(0.03));
    expect(engineStore.getState().attemptInfo().n).toBe(2);
    expect(engineStore.getState().attemptNumberAt(0)).toBe(1);
    expect(engineStore.getState().attemptNumberAt(1)).toBe(2);
  });

  it("a wrong-mode response (recipe shape to a correction request) is a typed shape error, not a crash", async () => {
    await seedAnalyzed();
    engineStore.setState({
      _analyze: vi.fn(async () => fakeRecipe()) as EngineStore["_analyze"], // recipe shape for BOTH modes
    });
    await expect(engineStore.getState().addAttempt(pre(0.05))).rejects.toThrow(/non-correction shape/);
    expect(engineStore.getState().lastError?.kind).toBe("shape");
    expect(engineStore.getState().attemptInfo().n).toBe(0); // no number consumed
    expect(engineStore.getState().activeChain()!.attempts.length).toBe(0);
  });

  it("a wrong-mode response to analyze (no values[]) never becomes a stored recipe", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    engineStore.setState({
      _analyze: vi.fn(async () => ({ moves: [], rationale: "r" })) as unknown as EngineStore["_analyze"],
    });
    await expect(engineStore.getState().analyze()).rejects.toThrow(/non-recipe shape/);
    expect(engineStore.getState().lastError?.kind).toBe("shape");
    expect(engineStore.getState().state()).toBe("ready");
    expect(engineStore.getState().activeChain()!.recipe).toBeNull();
  });
});

describe("target flip storm — chains stay isolated", () => {
  it("20 alternating flips + analyze on each target: recipes land on their own chains", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    for (let i = 0; i < 20; i++) {
      await st.setActiveTarget(i % 2 ? "vantage33" : "vray7max");
    }
    expect(engineStore.getState().activeTarget()).toBe("vantage33");
    await engineStore.getState().analyze(); // lands on vantage33
    await engineStore.getState().setActiveTarget("vray7max");
    expect(engineStore.getState().state()).toBe("ready"); // vray chain has no recipe yet
    await engineStore.getState().analyze();
    const s = engineStore.getState().session;
    expect(s.chains.vray7max.recipe).toBeTruthy();
    expect(s.chains.vantage33.recipe).toBeTruthy();
    await engineStore.getState().addAttempt(pre(0.02)); // active is vray7max
    expect(s.chains.vantage33.attempts.length).toBe(0);
    expect(engineStore.getState().session.chains.vray7max.attempts.length).toBe(1);
  });
});

describe("bulk persistence", () => {
  it("25 sessions -> pruneToNewest(5) keeps exactly the 5 newest", async () => {
    for (let i = 0; i < 25; i++) {
      await STORE.saveSession({
        id: `bulk-${String(i).padStart(2, "0")}`,
        created: new Date(1700000000000 + i * 60_000).toISOString(),
        context: {}, ref: null, base: null, settingsShot: null, activeTarget: "vray7max",
        chains: { vray7max: { recipe: null, attempts: [] }, vantage33: { recipe: null, attempts: [] } },
      } as unknown as StoredSession);
    }
    await STORE.pruneToNewest(5);
    const all = await STORE._all();
    expect(all.length).toBe(5);
    expect(all.map((s) => s.id).sort()).toEqual(["bulk-20", "bulk-21", "bulk-22", "bulk-23", "bulk-24"]);
  });

  it("a ~1.5MB session export/import round-trips intact and becomes latest", async () => {
    await seedAnalyzed();
    for (let i = 0; i < ATTEMPTS_CAP; i++) await engineStore.getState().addAttempt(pre(0.1));
    const s = engineStore.getState().session;
    // Fatten the payload: a ~150KB dataUrl per attempt (valid data: image prefix).
    const fat = "data:image/jpeg;base64," + "A".repeat(150_000);
    for (const att of s.chains.vray7max.attempts) att.dataUrl = fat;
    const exported = await engineStore.getState().exportJSON();
    expect(exported.length).toBeGreaterThan(1_000_000);
    const imported = JSON.parse(exported) as StoredSession & { id: string };
    imported.id = "fat-import";
    const st = engineStore.getState();
    const round = await st.importJSON(JSON.stringify(imported));
    expect(round.id).toBe("fat-import");
    expect(round.chains.vray7max.attempts.length).toBe(ATTEMPTS_CAP);
    expect((await STORE.loadLatest())?.id).toBe("fat-import");
  });
});
