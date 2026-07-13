// Area mode (session.lockGlobals) — the big-project layer, end to end at the engine:
//   - the system prompt sent to the adapter carries the AREA MODE constraint;
//   - scene-global moves the model emits anyway are WITHHELD (never stored in
//     values/moves, never in the applied map) and disclosed on withheld_globals;
//   - the flag persists, exports, and round-trips the import sanitizer safely.

import "../../test/setup";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { engineStore, withholdGlobals, type EngineStore, type PreCaptured } from "@/store/useEngine";
import { systemPrompt } from "@/lib/schemas";
import { sessionDigest } from "@/lib/chat-digest";
import { STORE } from "@/lib/store";
import type { MetricVector } from "@/lib/types";
import { clearLocalStorage } from "../../test/setup";

function mv(bias = 0): MetricVector {
  return {
    lum: { p1: 0.01 + bias, p5: 0.05 + bias, p25: 0.25 + bias, p50: 0.5 + bias, p75: 0.75 + bias, p95: 0.95, p99: 0.99, mean: 0.5 + bias },
    clip: { hi: 0.02, lo: 0.02 },
    contrast: { spread: 0.9, midSlope: 1.0 },
    wb: { shadow: { r: 0.1, g: 0.1, b: 0.1 }, highlight: { r: 0.8, g: 0.8, b: 0.8 }, warmthShadow: 0, warmthHighlight: 0, tint: 0 },
    sat: { mean: 0.2, p95: 0.4 },
    grid: new Array(16).fill(0.5),
  };
}
const PNG = "data:image/png;base64,QUJD";
const pre = (bias = 0): PreCaptured => ({ dataUrl: PNG, metrics: mv(bias) });

// A recipe that mixes scopes: camera + local (allowed) and sun + fog (global).
const mixedRecipe = () => ({
  baseline: "factory_defaults",
  hdri_mood: "clear",
  values: [
    { param: "cam.iso", set: 200, from: 100, step: 1, confidence: "high", why: "open a stop" },
    { param: "light.multiplier", set: 40, from: 30, step: 4, confidence: "high", why: "raise fill" },
    { param: "sun.intensity_mult", set: 1.4, from: 1.0, step: 2, confidence: "high", why: "hotter key" },
    { param: "fog.distance", set: 80, from: 200, step: 6, confidence: "medium", why: "haze" },
  ],
  rationale: "r",
  gi_notes: "g",
  status: "continue",
});
const mixedCorrection = () => ({
  moves: [
    { param: "post.exposure_value", to: 12.5, from: 13, step: 1, confidence: "high", why: "half stop" },
    { param: "sun.size_mult", to: 4, from: 1, step: 2, confidence: "medium", why: "softer shadows" },
  ],
  rationale: "r",
  status: "continue",
  status_reason: "s",
  applied_assumed: true,
});

beforeEach(async () => {
  clearLocalStorage();
  STORE._useDb("lightmatch-lock-" + Math.random().toString(36).slice(2));
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
});

describe("withholdGlobals (pure)", () => {
  it("splits values by scope and parks globals on withheld_globals", () => {
    const out = withholdGlobals(mixedRecipe() as unknown as Record<string, unknown>, "values");
    const values = out.values as Array<{ param: string }>;
    expect(values.map((v) => v.param)).toEqual(["cam.iso", "light.multiplier"]);
    const withheld = out.withheld_globals as Array<{ param: string; set: unknown }>;
    expect(withheld.map((w) => w.param)).toEqual(["sun.intensity_mult", "fog.distance"]);
    expect(withheld[0].set).toBe(1.4);
  });
  it("returns the object unchanged when nothing is global", () => {
    const r = { values: [{ param: "cam.iso", set: 100 }] };
    expect(withholdGlobals(r, "values")).toBe(r);
  });
});

describe("systemPrompt Area-mode constraint", () => {
  it("appears only when lockGlobals is set", () => {
    expect(systemPrompt("vray7max", "recipe")).not.toMatch(/AREA MODE/);
    const locked = systemPrompt("vray7max", "recipe", { lockGlobals: true });
    expect(locked).toMatch(/AREA MODE — SCENE GLOBALS ARE LOCKED/);
    expect(locked).toMatch(/cam\.\*/);
    expect(locked).toMatch(/light\.\*/);
  });
});

describe("engine enforcement", () => {
  it("analyze with lockGlobals: prompt constrained, globals withheld from the stored recipe", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    await st.setLockGlobals(true);
    const spy = vi.fn(async () => mixedRecipe());
    engineStore.setState({ _analyze: spy as unknown as EngineStore["_analyze"] });

    const recipe = await engineStore.getState().analyze();

    // the wire carried the constraint
    const sentSystem = (spy.mock.calls[0] as unknown as [{ system: string }])[0].system;
    expect(sentSystem).toMatch(/AREA MODE — SCENE GLOBALS ARE LOCKED/);
    // stored recipe: only camera+local moves; globals disclosed, not applied
    expect(recipe.values.map((v) => v.param)).toEqual(["cam.iso", "light.multiplier"]);
    expect(recipe.withheld_globals?.map((w) => w.param)).toEqual([
      "sun.intensity_mult",
      "fog.distance",
    ]);
    // persisted that way too
    const loaded = await STORE.loadLatest();
    const storedRecipe = (loaded as { chains: Record<string, { recipe: { values: { param: string }[] } }> })
      .chains.vray7max.recipe;
    expect(storedRecipe.values.length).toBe(2);
  });

  it("addAttempt with lockGlobals: correction trims filtered the same way", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    await st.setLockGlobals(true);
    engineStore.setState({
      _analyze: vi.fn(async ({ mode }: { mode: string }) =>
        mode === "correction" ? mixedCorrection() : mixedRecipe()
      ) as unknown as EngineStore["_analyze"],
    });
    await engineStore.getState().analyze();
    const { correction } = await engineStore.getState().addAttempt(pre(0.05));

    expect(correction.moves.map((m) => m.param)).toEqual(["post.exposure_value"]);
    expect(correction.withheld_globals?.map((w) => w.param)).toEqual(["sun.size_mult"]);
    // the withheld move never entered the applied map
    const att = engineStore.getState().activeChain()!.attempts[0];
    expect(Object.keys(att.appliedParams)).toEqual(["post.exposure_value"]);
  });

  it("unlocked sessions are untouched (same stub, all moves land)", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    engineStore.setState({
      _analyze: vi.fn(async () => mixedRecipe()) as unknown as EngineStore["_analyze"],
    });
    const recipe = await engineStore.getState().analyze();
    expect(recipe.values.length).toBe(4);
    expect(recipe.withheld_globals).toBeUndefined();
  });
});

describe("persistence + digest + import boundary", () => {
  it("setLockGlobals persists and survives a reload via loadLatest", async () => {
    await engineStore.getState().setLockGlobals(true);
    const loaded = await STORE.loadLatest();
    expect((loaded as { lockGlobals?: boolean }).lockGlobals).toBe(true);
  });

  it("sessionDigest tells the chat operator the globals are locked", () => {
    const d = sessionDigest({
      activeTarget: "vray7max",
      ref: {},
      base: {},
      lockGlobals: true,
      chains: { vray7max: { recipe: null, attempts: [] } },
    });
    expect(d).toMatch(/AREA MODE/);
    expect(d).toMatch(/LOCKED/);
  });

  it("import coerces a non-boolean lockGlobals to false (a string must not lock a session)", async () => {
    const base = {
      id: "imp-lock",
      created: "2020-01-01T00:00:00.000Z",
      context: { scene: "", time: "", rig: "" },
      ref: null, base: null, settingsShot: null, activeTarget: "vray7max",
      chains: { vray7max: { recipe: null, attempts: [] }, vantage33: { recipe: null, attempts: [] } },
    };
    const truthy = await STORE.importJSON(JSON.stringify({ ...base, lockGlobals: "yes" }));
    expect((truthy as { lockGlobals?: boolean }).lockGlobals).toBe(false);
    const real = await STORE.importJSON(JSON.stringify({ ...base, id: "imp-lock2", lockGlobals: true }));
    expect((real as { lockGlobals?: boolean }).lockGlobals).toBe(true);
  });
});
