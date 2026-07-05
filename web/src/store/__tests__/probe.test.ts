// Calibration-probe tests — suggestProbe (pure picker) + the engine's setProbe /
// addProbeRender path. Runs in node with the browser-global shims from
// ../../test/setup (the engine persists via STORE). The client adapter is STUBBED
// (engineStore._analyze) so NO /api/analyze POST is made; images are supplied
// pre-measured via the PreCaptured escape hatch so no canvas is required — the same
// harness style as engine.test.ts.

import "../../test/setup";
import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  engineStore,
  suggestProbe,
  type PreCaptured,
  type EngineStore,
} from "@/store/useEngine";
import { STORE } from "@/lib/store";
import type { MetricVector, Recipe, RecipeValue } from "@/lib/types";
import { clearLocalStorage } from "../../test/setup";

// -- a minimal-but-complete MetricVector (mirrors engine.test.ts). `bias` shifts the
// luminance percentiles so p50 tracks it: base bias 0.1 -> p50 0.6, probe bias 0.3 ->
// p50 0.8 — a probe that measurably came out BRIGHTER than the base. ----------------
function metricVector(bias = 0): MetricVector {
  return {
    lum: {
      p1: 0.01 + bias,
      p5: 0.05 + bias,
      p25: 0.25 + bias,
      p50: 0.5 + bias,
      p75: 0.75 + bias,
      p95: 0.95,
      p99: 0.99,
      mean: 0.5 + bias,
    },
    clip: { hi: 0.02, lo: 0.02 },
    contrast: { spread: 0.9, midSlope: 1.0 },
    wb: {
      shadow: { r: 0.1, g: 0.1, b: 0.1 },
      highlight: { r: 0.8, g: 0.8, b: 0.8 },
      warmthShadow: 0.0 + bias,
      warmthHighlight: 0.0,
      tint: 0.0,
    },
    sat: { mean: 0.2, p95: 0.4 },
    grid: new Array(16).fill(0.5),
  };
}

const PNG = "data:image/png;base64,AAAA";
function preCaptured(bias = 0): PreCaptured {
  return { dataUrl: PNG, metrics: metricVector(bias) };
}

// -- recipe factory: a full emit_recipe shell around the given values. -------------
function recipeWith(values: RecipeValue[]): Recipe {
  return {
    baseline: "factory_defaults",
    hdri_mood: "clear noon",
    values,
    rationale: "r",
    gi_notes: "g",
    status: "continue",
  };
}
// One recipe value (defaults keep each call to the interesting fields). ------------
function rv(partial: Partial<RecipeValue> & { param: string }): RecipeValue {
  return { set: 1, from: 0, step: 2, confidence: "high", why: "w", ...partial };
}

// -- the stub emits: a recipe with one numeric step-2 move (probe-able) plus one
// STRING move (must never be probe-able), and a minimal correction. -----------------
function fakeRecipe() {
  return recipeWith([
    rv({ param: "sun.intensity_mult", set: 1.2, from: 1.0, step: 2, why: "brighter" }),
    rv({ param: "env.background_mode", set: "Solid color", from: "Same as environment", step: 3 }),
  ]);
}
function fakeCorrection() {
  return {
    moves: [
      { param: "sun.intensity_mult", to: 1.1, from: 1.2, step: 2, confidence: "high", why: "trim" },
    ],
    rationale: "r",
    status: "continue",
    status_reason: "closer",
    applied_assumed: true,
  };
}

beforeEach(async () => {
  clearLocalStorage();
  STORE._useDb("lightmatch-probe-test-" + Math.random().toString(36).slice(2));
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
  engineStore.setState({
    _analyze: vi.fn(async ({ mode }: { mode: string }) =>
      mode === "correction" ? fakeCorrection() : fakeRecipe()
    ) as EngineStore["_analyze"],
  });
});

// Seed a ready session, then analyze so the chain has the fakeRecipe.
async function seedAnalyzed() {
  const st = engineStore.getState();
  await st.setImage("ref", preCaptured(0));
  await st.setImage("base", preCaptured(0.1));
  await engineStore.getState().analyze();
}

// ===========================================================================
// suggestProbe — the pure picker.
// ===========================================================================
describe("suggestProbe()", () => {
  it("picks the LARGEST relative numeric step-2..4 move, skipping step 1, step 5+, strings, and placements", () => {
    const recipe = recipeWith([
      // step 1 (exposure/WB — already arithmetic): rel would be 3/max(0, 10*0.1)=3,
      // the largest of all — MUST be skipped.
      rv({ param: "vfb.exposure", set: 3, from: 0, step: 1 }),
      // step 2 numeric: |0.2| / max(1, (2-0)*0.1) = 0.2.
      rv({ param: "sun.intensity_mult", set: 1.2, from: 1.0, step: 2 }),
      // step 3 numeric: |7| / max(1, (100-0)*0.1) = 0.7 — the expected winner.
      rv({ param: "dome.intensity", set: 8.0, from: 1.0, step: 3 }),
      // placement KIND (numeric values, rel would be 135/135 = 1.0 — the largest
      // eligible-step candidate): MUST be skipped because a placement is an
      // instruction, not a scalar knob.
      rv({ param: "sun.placement_azimuth", set: 0, from: 135, step: 2 }),
      // string values (dropdown): MUST be skipped.
      rv({ param: "env.background_mode", set: "Solid color", from: "Same as environment", step: 3 }),
      // step 5 numeric (rel 0.9 > 0.7): outside steps 2-4 — MUST be skipped.
      rv({ param: "cm.highlight_burn", set: 0.1, from: 1.0, step: 5 }),
    ]);
    expect(suggestProbe(recipe, "vray7max")).toEqual({
      param: "dome.intensity",
      from: 1.0,
      to: 8.0,
    });
  });

  it("returns null on an all-string recipe", () => {
    const recipe = recipeWith([
      rv({ param: "env.background_mode", set: "Solid color", from: "Same as environment", step: 3 }),
      rv({ param: "amb.color", set: "dark grey", from: "black", step: 4 }),
    ]);
    expect(suggestProbe(recipe, "vray7max")).toBeNull();
  });

  it("returns null when there is no recipe / no step-2..4 numeric move / no actual change", () => {
    expect(suggestProbe(null, "vray7max")).toBeNull();
    expect(suggestProbe(recipeWith([]), "vray7max")).toBeNull();
    // only step-1 moves:
    expect(
      suggestProbe(recipeWith([rv({ param: "vfb.exposure", set: 1, from: 0, step: 1 })]), "vray7max")
    ).toBeNull();
    // a step-2 "move" that changes nothing has no measurable response:
    expect(
      suggestProbe(
        recipeWith([rv({ param: "sun.intensity_mult", set: 1.0, from: 1.0, step: 2 })]),
        "vray7max"
      )
    ).toBeNull();
  });
});

// ===========================================================================
// setProbe / addProbeRender — the engine path.
// ===========================================================================
describe("setProbe() + addProbeRender()", () => {
  it("stores a measured response with the correct d_ev SIGN for a brighter probe", async () => {
    await seedAnalyzed();
    const probe = await engineStore.getState().setProbe("sun.intensity_mult");
    expect(probe).toEqual({ param: "sun.intensity_mult", from: 1.0, to: 1.2 });

    // Probe render measurably BRIGHTER than the base (p50 0.8 vs 0.6).
    const res = await engineStore.getState().addProbeRender(preCaptured(0.3));
    expect(res.d_ev).not.toBeNull();
    expect(res.d_ev!).toBeGreaterThan(0); // brighter probe ⇒ positive stops
    expect(res.d_ev!).toBe(0.42); // log2(0.8/0.6) ≈ 0.415, rounded to 2 decimals like exposure_gap_ev
    // Flat synthetic vectors: warmth/centroid/key:fill all measurably unchanged.
    expect(res.d_warmth_highlight).toBe(0);
    expect(res.d_centroid_x).toBe(0);
    expect(res.d_key_fill_ratio).toBe(0);
    // The response landed on the chain and re-probing REPLACES it: a darker render
    // (p50 0.3 vs 0.6) flips the sign to a full stop down.
    expect(engineStore.getState().activeChain()!.probe?.response?.d_ev).toBe(res.d_ev);
    const res2 = await engineStore.getState().addProbeRender(preCaptured(-0.2));
    expect(res2.d_ev!).toBe(-1); // log2(0.3/0.6) — darker probe ⇒ negative stops
    expect(engineStore.getState().activeChain()!.probe?.response?.d_ev).toBe(res2.d_ev);
  });

  it("setProbe returns null (and arms nothing) for a string move or an unknown param", async () => {
    await seedAnalyzed();
    // env.background_mode IS in the recipe, but as a string move — not probe-able.
    expect(await engineStore.getState().setProbe("env.background_mode")).toBeNull();
    expect(await engineStore.getState().setProbe("no.such_param")).toBeNull();
    expect(engineStore.getState().activeChain()!.probe ?? null).toBeNull();
  });

  it("addProbeRender is NOT an attempt: no score entry, no attempt number, no model call", async () => {
    await seedAnalyzed();
    const spy = vi.fn(async () => fakeCorrection());
    engineStore.setState({ _analyze: spy as unknown as EngineStore["_analyze"] });

    await engineStore.getState().setProbe("sun.intensity_mult");
    await engineStore.getState().addProbeRender(preCaptured(0.3));

    const chain = engineStore.getState().activeChain()!;
    expect(chain.attempts.length).toBe(0); // no ledger row
    expect(engineStore.getState().attemptInfo().n).toBe(0); // no attempt number consumed
    expect(engineStore.getState().state()).toBe("analyzed"); // probes don't enter "refining"
    expect(spy).not.toHaveBeenCalled(); // measuring a probe never calls the model
  });

  it("survives persistence: boot() restores the armed probe with its response", async () => {
    await seedAnalyzed();
    await engineStore.getState().setProbe("sun.intensity_mult");
    const res = await engineStore.getState().addProbeRender(preCaptured(0.3));
    engineStore.getState().reset();
    await engineStore.getState().boot();
    const chain = engineStore.getState().activeChain()!;
    expect(chain.probe?.param).toBe("sun.intensity_mult");
    expect(chain.probe?.response?.d_ev).toBe(res.d_ev);
  });
});

// ===========================================================================
// Evidence threading — the measured response reaches the model; the probe itself
// never appears as a history round or attempt.
// ===========================================================================
describe("probe evidence in model requests", () => {
  interface SeenCall {
    mode: string;
    userContent: Array<{ type: string; text?: string }>;
  }
  const textOf = (call: SeenCall): string =>
    call.userContent
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join("\n");

  it("a correction round after a measured probe carries MEASURED SCENE RESPONSE — and no probe round in the history", async () => {
    await seedAnalyzed();
    await engineStore.getState().setProbe("sun.intensity_mult");
    await engineStore.getState().addProbeRender(preCaptured(0.3));

    const spy = vi.fn(async (_args: SeenCall) => fakeCorrection());
    engineStore.setState({ _analyze: spy as unknown as EngineStore["_analyze"] });
    await engineStore.getState().addAttempt(preCaptured(0.2));

    expect(spy).toHaveBeenCalledTimes(1);
    const text = textOf(spy.mock.calls[0][0] as SeenCall);
    expect(text).toContain("MEASURED SCENE RESPONSE");
    // The exact single-knob change and the instruction to scale by it.
    expect(text).toContain("changing sun.intensity_mult 1->1.2 moved:");
    expect(text).toContain("Scale every magnitude in your moves by this measured sensitivity.");
    // The probe consumed NO history round: only the recipe's round 0 exists before
    // this first attempt (a probe wrongly recorded as an attempt would show round 1).
    const historyBlock = (spy.mock.calls[0][0] as SeenCall).userContent.find(
      (b) => b.type === "text" && (b.text || "").includes("MOVE HISTORY")
    );
    expect(historyBlock?.text).toContain("round 0: sun.intensity_mult 1 -> 1.2");
    expect(historyBlock?.text).not.toContain("round 1:");

    // ...and the attempt AFTER the probe is attempt 1 (the probe consumed no number).
    const chain = engineStore.getState().activeChain()!;
    expect(chain.attempts.length).toBe(1);
    expect(engineStore.getState().attemptNumberAt(0)).toBe(1);
  });

  it("a RE-ANALYZE after a measured probe carries MEASURED SCENE RESPONSE too", async () => {
    await seedAnalyzed();
    await engineStore.getState().setProbe("sun.intensity_mult");
    await engineStore.getState().addProbeRender(preCaptured(0.3));

    const spy = vi.fn(async (_args: SeenCall) => fakeRecipe());
    engineStore.setState({ _analyze: spy as unknown as EngineStore["_analyze"] });
    await engineStore.getState().analyze();

    const call = spy.mock.calls[0][0] as SeenCall;
    expect(call.mode).toBe("recipe");
    expect(textOf(call)).toContain("MEASURED SCENE RESPONSE");
  });

  it("without a measured response, no probe block is sent (armed-only probes teach nothing)", async () => {
    await seedAnalyzed();
    await engineStore.getState().setProbe("sun.intensity_mult"); // armed, never rendered

    const spy = vi.fn(async (_args: SeenCall) => fakeCorrection());
    engineStore.setState({ _analyze: spy as unknown as EngineStore["_analyze"] });
    await engineStore.getState().addAttempt(preCaptured(0.2));
    expect(textOf(spy.mock.calls[0][0] as SeenCall)).not.toContain("MEASURED SCENE RESPONSE");
  });
});
