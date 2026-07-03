// Engine store (state machine) tests — the ported vanilla ENGINE behavior. Runs in
// node with the browser-global shims from ../../test/setup (the engine persists via
// STORE, which needs indexedDB/localStorage). The client adapter is STUBBED (engineStore
// ._analyze) so NO /api/analyze POST is made; images are supplied pre-measured via the
// PreCaptured escape hatch so no canvas is required.

import "../../test/setup";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { engineStore, type PreCaptured, type EngineStore } from "@/store/useEngine";
import { STORE } from "@/lib/store";
import type { MetricVector } from "@/lib/types";
import { clearLocalStorage } from "../../test/setup";

// -- a minimal-but-complete MetricVector so diffVectors/scoreVectors run. `bias` shifts
// every scalar so two vectors differ (score > 0). ---------------------------------
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

// -- a valid emit_recipe the stub returns for recipe mode. -------------------------
function fakeRecipe() {
  return {
    baseline: "factory_defaults",
    hdri_mood: "clear noon",
    values: [
      { param: "sun.intensity_mult", set: 1.2, from: 1.0, step: 2, confidence: "high", why: "brighter" },
    ],
    rationale: "r",
    gi_notes: "g",
    status: "continue",
  };
}
// -- a valid emit_correction the stub returns for correction mode. -----------------
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

// Reset the store + storage before each test.
beforeEach(async () => {
  clearLocalStorage();
  STORE._useDb("lightmatch-engine-test-" + Math.random().toString(36).slice(2));
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
  // Default stub: echo a recipe or correction based on the request mode.
  engineStore.setState({
    _analyze: vi.fn(async ({ mode }: { mode: string }) =>
      mode === "correction" ? fakeCorrection() : fakeRecipe()
    ) as EngineStore["_analyze"],
  });
});

// Seed a ready session (ref + base measured) via the pre-captured slot path.
async function seedReady() {
  const st = engineStore.getState();
  await st.setImage("ref", preCaptured(0));
  await st.setImage("base", preCaptured(0.1));
}

describe("state machine", () => {
  it("starts empty and becomes ready once ref + base are set", async () => {
    expect(engineStore.getState().state()).toBe("empty");
    await seedReady();
    expect(engineStore.getState().state()).toBe("ready");
  });
});

describe("analyze()", () => {
  it("stores the returned recipe under the active chain and moves to analyzed", async () => {
    await seedReady();
    const recipe = await engineStore.getState().analyze();
    expect(recipe.values[0].param).toBe("sun.intensity_mult");
    const chain = engineStore.getState().activeChain();
    expect(chain?.recipe?.values?.[0]?.param).toBe("sun.intensity_mult");
    expect(engineStore.getState().state()).toBe("analyzed");
  });

  it("clears lastError on a successful run", async () => {
    await seedReady();
    engineStore.setState({ lastError: { kind: "network", at: "x" } });
    await engineStore.getState().analyze();
    expect(engineStore.getState().lastError).toBeNull();
  });

  it("throws (and does not enter analyzed) when called before ready", async () => {
    await expect(engineStore.getState().analyze()).rejects.toThrow(/reference and base/);
  });
});

describe("addAttempt()", () => {
  it("computes a score and stores the correction under the active chain", async () => {
    await seedReady();
    await engineStore.getState().analyze();
    const { score, correction } = await engineStore.getState().addAttempt(preCaptured(0.2));
    expect(typeof score).toBe("number");
    expect(score).toBeGreaterThan(0); // attempt (bias 0.2) differs from ref (bias 0)
    expect(correction.moves[0].param).toBe("sun.intensity_mult");
    expect(engineStore.getState().state()).toBe("refining");
    const chain = engineStore.getState().activeChain();
    expect(chain?.attempts.length).toBe(1);
    expect(chain?.attempts[0].score).toBe(score);
  });

  it("enforces the 8-attempt FIFO cap while numbering keeps climbing", async () => {
    await seedReady();
    await engineStore.getState().analyze();
    for (let i = 0; i < 10; i++) {
      await engineStore.getState().addAttempt(preCaptured(0.1 + i * 0.01));
    }
    const chain = engineStore.getState().activeChain();
    expect(chain?.attempts.length).toBe(8); // capped
    expect(chain?._attemptCount).toBe(10); // monotonic, keeps climbing
    // the newest stored attempt is number 10
    expect(engineStore.getState().attemptNumberAt(7)).toBe(10);
    // two evicted scores were retained
    expect(chain?._evictedScores?.length).toBe(2);
  });
});

describe("reanalyzeOtherTarget()", () => {
  it("flips activeTarget, creates the 2nd chain's recipe, and updates prefs.target", async () => {
    await seedReady();
    await engineStore.getState().analyze(); // recipe on vray7max
    expect(engineStore.getState().activeTarget()).toBe("vray7max");

    await engineStore.getState().reanalyzeOtherTarget();
    expect(engineStore.getState().activeTarget()).toBe("vantage33");
    expect(STORE.prefs().target).toBe("vantage33");
    // both chains now have a recipe; the original is untouched
    const s = engineStore.getState().session;
    expect(s.chains.vray7max.recipe).not.toBeNull();
    expect(s.chains.vantage33.recipe).not.toBeNull();
  });
});

describe("applied toggles", () => {
  it("setRecipeApplied(param,false) is reflected in the round-0 history as applied:false", async () => {
    await seedReady();
    await engineStore.getState().analyze();
    await engineStore.getState().setRecipeApplied("sun.intensity_mult", false);
    const chain = engineStore.getState().activeChain();
    expect(chain?.recipeApplied?.["sun.intensity_mult"]).toBe(false);

    // Assert the history a correction call would send marks that row applied:false.
    // (Exercised by adding an attempt and inspecting the stubbed adapter's userContent.)
    const spy = vi.fn(async (_args: { userContent: Array<{ type: string; text?: string }> }) =>
      fakeCorrection()
    );
    engineStore.setState({ _analyze: spy as unknown as EngineStore["_analyze"] });
    await engineStore.getState().addAttempt(preCaptured(0.3));
    const call = spy.mock.calls[0][0];
    const historyBlock = call.userContent.find(
      (b) => b.type === "text" && (b.text || "").includes("MOVE HISTORY")
    );
    expect(historyBlock?.text).toMatch(/sun\.intensity_mult.*applied: false/);
  });

  it("toggleAttemptApplied flips a stored correction row to applied:false", async () => {
    await seedReady();
    await engineStore.getState().analyze();
    await engineStore.getState().addAttempt(preCaptured(0.2));
    const before = engineStore.getState().activeChain()!.attempts[0].appliedParams["sun.intensity_mult"];
    expect(before).toBe(true);
    await engineStore.getState().toggleAttemptApplied(0, "sun.intensity_mult");
    const after = engineStore.getState().activeChain()!.attempts[0].appliedParams["sun.intensity_mult"];
    expect(after).toBe(false);
  });
});

describe("in-flight guard", () => {
  it("setImage throws a BusyError while an analyze is in flight", async () => {
    await seedReady();
    // A slow adapter so the guard stays held while we fire setImage.
    let release: (v: unknown) => void = () => {};
    const slow = new Promise((r) => (release = r));
    engineStore.setState({
      _analyze: (async () => {
        await slow;
        return fakeRecipe();
      }) as unknown as EngineStore["_analyze"],
    });
    const p = engineStore.getState().analyze();
    await expect(engineStore.getState().setImage("ref", preCaptured(0))).rejects.toMatchObject({
      kind: "busy",
    });
    release(null);
    await p; // let the analyze settle
  });
});

describe("boot / persistence", () => {
  it("boot restores the latest saved session", async () => {
    await seedReady();
    await engineStore.getState().analyze();
    const savedId = engineStore.getState().session.id;
    // Wipe the live session, then boot should restore from STORE.
    engineStore.getState().reset();
    expect(engineStore.getState().session.id).not.toBe(savedId);
    await engineStore.getState().boot();
    expect(engineStore.getState().session.id).toBe(savedId);
  });
});
