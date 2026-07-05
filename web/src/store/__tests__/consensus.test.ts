// Consensus ×3 tests — the run-to-run-variance killer. When STORE.prefs().consensus
// is true, analyze() fires THREE identical model calls (Promise.allSettled) and merges
// the fulfilled recipes into ONE: numeric `set`s -> MEDIAN (clamped defensively),
// string `set`s -> MAJORITY (tie -> first run), per-param metadata (from/step/
// confidence/why) from the FIRST run that emitted the param, consensus_n = how many
// runs agreed, envelope from the first fulfilled run + a consensus:{runs} marker.
// Correction rounds stay single-call (history-coupled trims — merging three parallel
// corrections would match no single model's coherent plan), so only analyze() is
// exercised here. Same harness as engine.test.ts: node + browser-global shims, the
// client adapter stubbed via engineStore._analyze, images via PreCaptured.

import "../../test/setup";
import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  engineStore,
  mergeConsensusRecipes,
  type PreCaptured,
  type EngineStore,
} from "@/store/useEngine";
import { STORE } from "@/lib/store";
import { AdapterError } from "@/lib/client-adapter";
import type { MetricVector, Recipe } from "@/lib/types";
import { clearLocalStorage } from "../../test/setup";

// -- a minimal-but-complete MetricVector (same shape engine.test.ts uses) so
// diffVectors/scoreVectors and the evidence helpers run. ----------------------------
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

// -- the three DIFFERENT recipe emits the stub returns (per-call). All params are
// real vray7max pack ids with in-range values so the defensive clamp is a no-op in
// the median tests (clamping is exercised separately below).
//   agreement plan: sun.turbidity + sun.sky_model + dome.intensity in ALL THREE runs,
//   cm.highlight_burn in runs B+C only (n=2), light.multiplier in run A only (n=1).
function val(param: string, set: number | string, from: number | string, step: number, why: string) {
  return { param, set, from, step, confidence: "high", why };
}
function runRecipe(label: "A" | "B" | "C"): Record<string, unknown> {
  const values =
    label === "A"
      ? [
          val("sun.turbidity", 5, 2.5, 2, "whyA"),
          val("sun.sky_model", "CIE Overcast", "PRG Clear Sky", 3, "skyA"),
          val("dome.intensity", 2, 1.0, 3, "domeA"),
          val("light.multiplier", 40, 30, 4, "fillA"),
        ]
      : label === "B"
      ? [
          val("sun.turbidity", 7, 2.5, 2, "whyB"),
          val("sun.sky_model", "CIE Overcast", "PRG Clear Sky", 3, "skyB"),
          val("dome.intensity", 3, 1.0, 3, "domeB"),
          val("cm.highlight_burn", 0.7, 1.0, 5, "burnB"),
        ]
      : [
          val("sun.turbidity", 9, 2.5, 2, "whyC"),
          val("sun.sky_model", "Hosek et al.", "PRG Clear Sky", 3, "skyC"),
          val("dome.intensity", 4, 1.0, 3, "domeC"),
          val("cm.highlight_burn", 0.6, 1.0, 5, "burnC"),
        ];
  return {
    baseline: "factory_defaults",
    hdri_mood: `mood ${label}`,
    values,
    rationale: `rationale ${label}`,
    gi_notes: `gi ${label}`,
    status: "continue",
  };
}

// -- stub cycling A -> B -> C by call order (analyze fires the three calls in order
// synchronously, so mockResolvedValueOnce chaining is deterministic). ---------------
function stubRuns(...runs: Array<Record<string, unknown> | Error>) {
  const fn = vi.fn();
  for (const r of runs) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  engineStore.setState({ _analyze: fn as unknown as EngineStore["_analyze"] });
  return fn;
}

beforeEach(async () => {
  clearLocalStorage();
  STORE._useDb("lightmatch-consensus-test-" + Math.random().toString(36).slice(2));
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
});

async function seedReady() {
  const st = engineStore.getState();
  await st.setImage("ref", preCaptured(0));
  await st.setImage("base", preCaptured(0.1));
}

function valueOf(recipe: Recipe, param: string) {
  return recipe.values.find((v) => v.param === param);
}

describe("consensus OFF (default prefs)", () => {
  it("makes exactly ONE _analyze call and stores an unmarked recipe", async () => {
    await seedReady();
    const spy = stubRuns(runRecipe("A"));
    const recipe = await engineStore.getState().analyze();
    expect(spy).toHaveBeenCalledTimes(1);
    // No consensus envelope / per-value counts leak onto a single-call recipe.
    expect(recipe.consensus).toBeUndefined();
    expect(valueOf(recipe, "sun.turbidity")?.consensus_n).toBeUndefined();
    expect(engineStore.getState().state()).toBe("analyzed");
  });
});

describe("consensus ON — merge behavior through analyze()", () => {
  beforeEach(() => {
    STORE.setPrefs({ consensus: true });
  });

  it("fires THREE calls carrying the identical request object", async () => {
    await seedReady();
    const spy = stubRuns(runRecipe("A"), runRecipe("B"), runRecipe("C"));
    await engineStore.getState().analyze();
    expect(spy).toHaveBeenCalledTimes(3);
    // Identical request: the SAME assembled object goes to all three calls.
    expect(spy.mock.calls[1][0]).toBe(spy.mock.calls[0][0]);
    expect(spy.mock.calls[2][0]).toBe(spy.mock.calls[0][0]);
  });

  it("numeric sets merge to the MEDIAN (5/7/9 -> 7)", async () => {
    await seedReady();
    stubRuns(runRecipe("A"), runRecipe("B"), runRecipe("C"));
    const recipe = await engineStore.getState().analyze();
    expect(valueOf(recipe, "sun.turbidity")?.set).toBe(7);
    expect(valueOf(recipe, "dome.intensity")?.set).toBe(3); // median of 2/3/4
  });

  it("string sets merge to the MAJORITY (2×'CIE Overcast' vs 1×'Hosek et al.')", async () => {
    await seedReady();
    stubRuns(runRecipe("A"), runRecipe("B"), runRecipe("C"));
    const recipe = await engineStore.getState().analyze();
    expect(valueOf(recipe, "sun.sky_model")?.set).toBe("CIE Overcast");
  });

  it("metadata (from/step/confidence/why) comes from the FIRST run that emitted the param", async () => {
    await seedReady();
    stubRuns(runRecipe("A"), runRecipe("B"), runRecipe("C"));
    const recipe = await engineStore.getState().analyze();
    expect(valueOf(recipe, "sun.turbidity")?.why).toBe("whyA");
    // cm.highlight_burn first appears in run B — B's metadata, median of B+C's sets.
    const burn = valueOf(recipe, "cm.highlight_burn");
    expect(burn?.why).toBe("burnB");
    expect(burn?.set).toBeCloseTo(0.65, 10); // median of two = their midpoint
  });

  it("counts agreement per param and KEEPS single-run params with consensus_n 1", async () => {
    await seedReady();
    stubRuns(runRecipe("A"), runRecipe("B"), runRecipe("C"));
    const recipe = await engineStore.getState().analyze();
    expect(valueOf(recipe, "sun.turbidity")?.consensus_n).toBe(3);
    expect(valueOf(recipe, "cm.highlight_burn")?.consensus_n).toBe(2);
    // Emitted by run A only — kept (dropping data silently is worse), flagged n=1.
    const fill = valueOf(recipe, "light.multiplier");
    expect(fill).toBeDefined();
    expect(fill?.consensus_n).toBe(1);
    expect(fill?.set).toBe(40);
  });

  it("carries the envelope from the first fulfilled run plus consensus:{runs:3}", async () => {
    await seedReady();
    stubRuns(runRecipe("A"), runRecipe("B"), runRecipe("C"));
    const recipe = await engineStore.getState().analyze();
    expect(recipe.hdri_mood).toBe("mood A");
    expect(recipe.rationale).toBe("rationale A");
    expect(recipe.gi_notes).toBe("gi A");
    expect(recipe.consensus).toEqual({ runs: 3 });
  });

  it("one rejection out of three still succeeds — merged from the 2 survivors, runs:2", async () => {
    await seedReady();
    stubRuns(new AdapterError("gateway hiccup", "network"), runRecipe("B"), runRecipe("C"));
    const recipe = await engineStore.getState().analyze();
    expect(recipe.consensus).toEqual({ runs: 2 });
    // Envelope from the first FULFILLED run (B — run A never arrived).
    expect(recipe.hdri_mood).toBe("mood B");
    // Median of an even set is the midpoint: turbidity 7/9 -> 8.
    expect(valueOf(recipe, "sun.turbidity")?.set).toBe(8);
    expect(valueOf(recipe, "sun.turbidity")?.consensus_n).toBe(2);
    // The failed run leaves no error banner behind a successful consensus.
    expect(engineStore.getState().lastError).toBeNull();
    expect(engineStore.getState().state()).toBe("analyzed");
  });

  it("all three rejected -> throws the FIRST rejection reason via annotateError", async () => {
    await seedReady();
    stubRuns(
      new AdapterError("gateway down", "network"),
      new AdapterError("second failure", "other"),
      new AdapterError("third failure", "other")
    );
    await expect(engineStore.getState().analyze()).rejects.toThrow(/gateway down/);
    // annotateError recorded the first reason's typed kind.
    expect(engineStore.getState().lastError?.kind).toBe("network");
    expect(engineStore.getState().state()).toBe("ready"); // no recipe stored
  });

  it("all three fulfilled but shape-invalid -> typed shape error, nothing stored", async () => {
    await seedReady();
    const junk = { moves: [] }; // a correction-shaped reply has no values[]
    stubRuns(junk, junk, junk);
    await expect(engineStore.getState().analyze()).rejects.toMatchObject({ kind: "shape" });
    expect(engineStore.getState().activeChain()?.recipe).toBeNull();
  });

  it("merged recipe persists (survives reset + boot) and state() is analyzed", async () => {
    await seedReady();
    stubRuns(runRecipe("A"), runRecipe("B"), runRecipe("C"));
    await engineStore.getState().analyze();
    expect(engineStore.getState().state()).toBe("analyzed");
    const savedId = engineStore.getState().session.id;

    // Wipe the live session; boot must restore the MERGED recipe intact.
    engineStore.getState().reset();
    await engineStore.getState().boot();
    expect(engineStore.getState().session.id).toBe(savedId);
    const restored = engineStore.getState().activeChain()?.recipe as Recipe;
    expect(restored?.consensus).toEqual({ runs: 3 });
    expect(valueOf(restored, "sun.turbidity")?.set).toBe(7);
    expect(valueOf(restored, "light.multiplier")?.consensus_n).toBe(1);
  });
});

// ---------------------------------------------------------------------------------
// mergeConsensusRecipes — pure-function edges the engine path above doesn't reach.
// ---------------------------------------------------------------------------------
describe("mergeConsensusRecipes (pure)", () => {
  const envelope = {
    baseline: "factory_defaults",
    hdri_mood: "m",
    rationale: "r",
    gi_notes: "g",
    status: "continue",
  };
  const mk = (values: Array<Record<string, unknown>>) => ({ ...envelope, values });

  it("string tie (all three differ) resolves to the FIRST run's value", () => {
    const merged = mergeConsensusRecipes(
      [
        mk([val("sun.sky_model", "CIE Overcast", "PRG Clear Sky", 3, "a")]),
        mk([val("sun.sky_model", "Hosek et al.", "PRG Clear Sky", 3, "b")]),
        mk([val("sun.sky_model", "Preetham et al.", "PRG Clear Sky", 3, "c")]),
      ],
      "vray7max"
    );
    const v = (merged.values as Array<Record<string, unknown>>)[0];
    expect(v.set).toBe("CIE Overcast");
    expect(v.consensus_n).toBe(3);
  });

  it("defensively clamps an out-of-range even-count midpoint (18/40 -> 29 -> 20, clamped)", () => {
    // sun.turbidity range is [2, 20]: two runs at 18 and 40 average to 29, which the
    // post-merge clamp must pull back into range and FLAG.
    const merged = mergeConsensusRecipes(
      [
        mk([val("sun.turbidity", 18, 2.5, 2, "a")]),
        mk([val("sun.turbidity", 40, 2.5, 2, "b")]),
      ],
      "vray7max"
    );
    const v = (merged.values as Array<Record<string, unknown>>)[0];
    expect(v.set).toBe(20);
    expect(v.clamped).toBe(true);
  });

  it("re-enforces values maxItems 32 by dropping lowest-consensus_n items (last first)", () => {
    // Run A: p0..p29 (30 params). Run B: p0..p27 shared (n=2) + q1..q4 unique (n=1).
    // Union = 34 -> two over the cap. n=1 items are p28,p29,q1..q4; ties drop from
    // the END, so q4 then q3 go and everything else survives.
    const a = mk(Array.from({ length: 30 }, (_, i) => val(`p${i}`, i, 0, 2, "a")));
    const b = mk([
      ...Array.from({ length: 28 }, (_, i) => val(`p${i}`, i + 1, 0, 2, "b")),
      ...[1, 2, 3, 4].map((i) => val(`q${i}`, i, 0, 2, "b")),
    ]);
    const merged = mergeConsensusRecipes([a, b], "vray7max");
    const values = merged.values as Array<Record<string, unknown>>;
    expect(values.length).toBe(32);
    const params = values.map((v) => v.param);
    expect(params).toContain("p28");
    expect(params).toContain("p29");
    expect(params).toContain("q1");
    expect(params).toContain("q2");
    expect(params).not.toContain("q3");
    expect(params).not.toContain("q4");
    expect(merged.consensus).toEqual({ runs: 2 });
  });
});
