// Scene priors — "remember what worked across sessions."
//
// Two layers under test:
//   1. STORE's localStorage-backed prior shelf (lm_priors): savePrior/loadPriors
//      round-trip, the 20-entry FIFO cap, corrupt-blob healing, and bestPrior's
//      ranking contract (same target + >= 1 exactly-equal NON-EMPTY context field;
//      more matching fields wins; ties go to the newer `at`).
//   2. The engine wiring: a refine chain that LANDS (measured score enters the
//      MATCH_THRESHOLD band, or the model declares handoff_to_grade) saves the
//      SETTLED sheet — recipe round 0 then every stored correction, last write per
//      param wins, applied:false rows skipped — and the NEXT analyze over a similar
//      context injects a "PRIOR —" bias block into the model request. A prior save
//      failure must never break the attempt flow (fire-and-forget).
//
// Follows the convergence e2e pattern: synthetic RGBA renders measured by the REAL
// measureFromPixels photometry drive real scores; only the network hop is stubbed.

import "../../test/setup";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { engineStore, type PreCaptured, type EngineStore } from "@/store/useEngine";
import { STORE, type Prior } from "@/lib/store";
import { clearLocalStorage } from "../../test/setup";
import { measureFromPixels, matchPercent, MATCH_THRESHOLD } from "@/lib/metrics";
import type { ContentBlock } from "@/lib/client-adapter";

// ---------------------------------------------------------------------------------
// Synthetic renders (64x64 RGBA, deterministic — same fills as the convergence e2e):
// warm-left reference, cool-right base (far outside the match band), a halfway
// attempt (score drops but stays above the gate), and a dithered near-copy of the
// reference (score inside the gate).
// ---------------------------------------------------------------------------------
const W = 64;
const H = 64;

function render(fill: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fill(x, y);
      const p = (y * W + x) * 4;
      data[p] = Math.max(0, Math.min(255, Math.round(r)));
      data[p + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[p + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[p + 3] = 255;
    }
  }
  return data;
}

const refFill = (x: number): [number, number, number] => {
  const k = 1 - (x / W) * 0.55;
  return [235 * k, 200 * k, 150 * k];
};
const baseFill = (x: number): [number, number, number] => {
  const k = 0.45 + (x / W) * 0.35;
  return [90 * k, 110 * k, 150 * k];
};
const midFill = (x: number): [number, number, number] => {
  const a = refFill(x);
  const b = baseFill(x);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
};
const closeFill = (x: number, y: number): [number, number, number] => {
  const a = refFill(x);
  const d = ((x * 7 + y * 13) % 3) - 1; // -1 | 0 | +1
  return [a[0] + d, a[1] + d, a[2] + d];
};

const refM = measureFromPixels(render(refFill), W, H);
const baseM = measureFromPixels(render(baseFill), W, H);
const midM = measureFromPixels(render((x) => midFill(x)), W, H);
const closeM = measureFromPixels(render(closeFill), W, H);

const PNG = "data:image/png;base64,AAAA";
const pre = (metrics: typeof refM): PreCaptured => ({ dataUrl: PNG, metrics });

// ---------------------------------------------------------------------------------
// Prior factory for the STORE-level tests.
// ---------------------------------------------------------------------------------
function mkPrior(over: Partial<Prior> = {}): Prior {
  return {
    target: "vray7max",
    context: { scene: "kitchen", time: "", rig: "" },
    values: [{ param: "sun.intensity_mult", value: 1.1 }],
    matchPercent: 97,
    at: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

// ---------------------------------------------------------------------------------
// Stubbed model emits for the engine tests. The recipe opens with three moves; the
// user skips dome.intensity (applied:false). Correction 1 trims the sun AND adds a
// fill light the user also skips; correction 2 trims the sun again — so the settled
// sheet must read {vfb.exposure: 0.8, sun.intensity_mult: 1.1} and NOTHING else.
// ---------------------------------------------------------------------------------
const RECIPE = {
  baseline: "factory_defaults",
  hdri_mood: "warm late afternoon",
  values: [
    { param: "vfb.exposure", set: 0.8, from: 0.0, step: 1, confidence: "high", why: "level" },
    { param: "sun.intensity_mult", set: 1.5, from: 1.0, step: 2, confidence: "high", why: "key" },
    { param: "dome.intensity", set: 0.7, from: 1.0, step: 3, confidence: "medium", why: "fill down" },
  ],
  rationale: "r",
  gi_notes: "g",
  status: "continue",
};
const CORRECTION_1 = {
  moves: [
    { param: "sun.intensity_mult", to: 1.2, from: 1.5, step: 2, confidence: "high", why: "trim" },
    { param: "light.multiplier", to: 40, from: 30, step: 4, confidence: "low", why: "fill" },
  ],
  rationale: "r",
  status: "continue",
  status_reason: "closer",
  applied_assumed: true,
};
const CORRECTION_2 = {
  moves: [
    { param: "sun.intensity_mult", to: 1.1, from: 1.2, step: 2, confidence: "high", why: "hair trim" },
  ],
  rationale: "r",
  status: "continue",
  status_reason: "within noise",
  applied_assumed: true,
};

interface SeenRequest {
  mode: string;
  userContent: ContentBlock[];
}
const seen: SeenRequest[] = [];

/** Stub the adapter: recipe-mode returns RECIPE; correction rounds return the given
 *  corrections in call order (the last one repeats if the test runs longer). */
function stubAnalyze(corrections: Array<Record<string, unknown>>) {
  let corrCall = 0;
  engineStore.setState({
    _analyze: (async (req: SeenRequest) => {
      seen.push(req);
      if (req.mode === "correction") {
        const c = corrections[Math.min(corrCall, corrections.length - 1)];
        corrCall++;
        return c;
      }
      return RECIPE;
    }) as unknown as EngineStore["_analyze"],
  });
}

/** All text blocks of a captured request, joined (for content assertions). */
function textOf(req: SeenRequest): string {
  return req.userContent
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

beforeEach(() => {
  clearLocalStorage();
  STORE._useDb("lightmatch-priors-test-" + Math.random().toString(36).slice(2));
  seen.length = 0;
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
  stubAnalyze([CORRECTION_1, CORRECTION_2]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===================================================================================
// STORE layer — savePrior / loadPriors / bestPrior
// ===================================================================================

describe("STORE.savePrior / loadPriors", () => {
  it("round-trips a prior through localStorage", () => {
    const p = mkPrior({ values: [{ param: "vfb.exposure", value: 0.8 }, { param: "cam.wb_kelvin", value: 5200 }] });
    STORE.savePrior(p);
    expect(STORE.loadPriors()).toEqual([p]);
  });

  it("caps at 20 entries FIFO (oldest out, newest kept)", () => {
    for (let i = 0; i < 25; i++) {
      STORE.savePrior(mkPrior({ values: [{ param: "n", value: i }] }));
    }
    const all = STORE.loadPriors();
    expect(all.length).toBe(STORE.PRIORS_CAP);
    expect(STORE.PRIORS_CAP).toBe(20);
    // entries 0..4 were evicted from the front; 5..24 survive in order.
    expect(all[0].values[0].value).toBe(5);
    expect(all[19].values[0].value).toBe(24);
  });

  it("a corrupt blob reads as [] and heals on the next save", () => {
    localStorage.setItem("lm_priors", "{definitely-not-json");
    expect(STORE.loadPriors()).toEqual([]);
    STORE.savePrior(mkPrior());
    expect(STORE.loadPriors().length).toBe(1);
  });

  it("a non-array JSON blob reads as []; junk rows inside an array are dropped", () => {
    localStorage.setItem("lm_priors", JSON.stringify({ not: "an array" }));
    expect(STORE.loadPriors()).toEqual([]);
    localStorage.setItem(
      "lm_priors",
      JSON.stringify([null, 42, "x", { target: "vray7max", values: [] }])
    );
    const all = STORE.loadPriors();
    expect(all.length).toBe(1);
    expect(all[0].target).toBe("vray7max");
  });
});

describe("STORE.bestPrior ranking", () => {
  const CTX = { scene: "kitchen", time: "dusk", rig: "sun_sky" };

  it("returns null when nothing is stored", () => {
    expect(STORE.bestPrior("vray7max", CTX)).toBeNull();
  });

  it("never crosses targets", () => {
    STORE.savePrior(mkPrior({ target: "vantage33" }));
    expect(STORE.bestPrior("vray7max", CTX)).toBeNull();
    expect(STORE.bestPrior("vantage33", CTX)).not.toBeNull();
  });

  it("requires at least one exactly-equal NON-EMPTY field (empty-vs-empty is no signal)", () => {
    STORE.savePrior(mkPrior({ context: { scene: "", time: "", rig: "" } }));
    // Both sides blank on every field: no match.
    expect(STORE.bestPrior("vray7max", { scene: "", time: "", rig: "" })).toBeNull();
    // Non-empty but different: no match either.
    expect(STORE.bestPrior("vray7max", { scene: "warehouse", time: "", rig: "" })).toBeNull();
  });

  it("two matching fields beat one — even when the one-field prior is newer", () => {
    STORE.savePrior(
      mkPrior({
        context: { scene: "kitchen", time: "dusk", rig: "" },
        values: [{ param: "winner", value: 1 }],
        at: "2026-01-01T00:00:00.000Z", // older
      })
    );
    STORE.savePrior(
      mkPrior({
        context: { scene: "kitchen", time: "", rig: "" },
        values: [{ param: "loser", value: 2 }],
        at: "2026-06-01T00:00:00.000Z", // newer, but only 1 field matches
      })
    );
    const best = STORE.bestPrior("vray7max", CTX)!;
    expect(best.values[0].param).toBe("winner");
  });

  it("equal field counts tie-break to the NEWER prior regardless of storage order", () => {
    // Saved newest-FIRST on purpose: the tiebreak must read `at`, not array position.
    STORE.savePrior(
      mkPrior({ values: [{ param: "newer", value: 1 }], at: "2026-06-01T00:00:00.000Z" })
    );
    STORE.savePrior(
      mkPrior({ values: [{ param: "older", value: 2 }], at: "2026-01-01T00:00:00.000Z" })
    );
    const best = STORE.bestPrior("vray7max", CTX)!;
    expect(best.values[0].param).toBe("newer");
  });
});

// ===================================================================================
// Engine layer — landing a chain saves the settled sheet
// ===================================================================================

describe("engine: a matched attempt saves the settled prior", () => {
  it("score <= MATCH_THRESHOLD triggers a save with last-write-wins, applied-only values", async () => {
    const st = engineStore.getState();
    await st.setContext({ scene: "kitchen", time: "dusk", rig: "sun_sky" });
    await st.setImage("ref", pre(refM));
    await st.setImage("base", pre(baseM));
    await engineStore.getState().analyze();
    // The user skips the recipe's dome move when re-rendering.
    await engineStore.getState().setRecipeApplied("dome.intensity", false);

    // Attempt 1 lands halfway: above the gate, status continue — NO prior yet.
    const a1 = await engineStore.getState().addAttempt(pre(midM));
    expect(a1.score).toBeGreaterThan(MATCH_THRESHOLD);
    expect(STORE.loadPriors().length).toBe(0);

    // The user also skips correction 1's fill-light move.
    await engineStore.getState().toggleAttemptApplied(0, "light.multiplier");

    // Attempt 2 enters the match band — the prior is saved.
    const a2 = await engineStore.getState().addAttempt(pre(closeM));
    expect(a2.score).toBeLessThanOrEqual(MATCH_THRESHOLD);
    const priors = STORE.loadPriors();
    expect(priors.length).toBe(1);
    const p = priors[0];
    expect(p.target).toBe("vray7max");
    expect(p.matchPercent).toBe(matchPercent(a2.score));
    expect(p.context).toEqual({ scene: "kitchen", time: "dusk", rig: "sun_sky" });
    expect(Number.isFinite(Date.parse(p.at))).toBe(true);
    // Settled sheet: recipe round 0 then corrections in order, last write per param
    // wins, applied:false rows (dome.intensity, light.multiplier) skipped.
    const byParam = Object.fromEntries(p.values.map((v) => [v.param, v.value]));
    expect(byParam["vfb.exposure"]).toBe(0.8);
    expect(byParam["sun.intensity_mult"]).toBe(1.1); // correction 2 supersedes 1.5 and 1.2
    expect(byParam["dome.intensity"]).toBeUndefined();
    expect(byParam["light.multiplier"]).toBeUndefined();
    expect(p.values.length).toBe(2);
  });

  it("a handoff_to_grade correction saves a prior even above the score gate", async () => {
    stubAnalyze([{ ...CORRECTION_1, status: "handoff_to_grade" }]);
    const st = engineStore.getState();
    await st.setContext({ scene: "atrium", time: "noon", rig: "hdri" });
    await st.setImage("ref", pre(refM));
    await st.setImage("base", pre(baseM));
    await engineStore.getState().analyze();

    const a = await engineStore.getState().addAttempt(pre(midM));
    expect(a.score).toBeGreaterThan(MATCH_THRESHOLD); // the gate did NOT fire...
    const priors = STORE.loadPriors();
    expect(priors.length).toBe(1); // ...the handoff did
    const byParam = Object.fromEntries(priors[0].values.map((v) => [v.param, v.value]));
    // Whole chain applied: recipe values plus the handoff correction's trims.
    expect(byParam["sun.intensity_mult"]).toBe(1.2);
    expect(byParam["light.multiplier"]).toBe(40);
    expect(byParam["dome.intensity"]).toBe(0.7);
  });

  it("a prior save failure (localStorage throws) never breaks the attempt flow", async () => {
    const st = engineStore.getState();
    await st.setContext({ scene: "kitchen", time: "", rig: "" });
    await st.setImage("ref", pre(refM));
    await st.setImage("base", pre(baseM));
    await engineStore.getState().analyze();

    const spy = vi
      .spyOn(globalThis.localStorage as Storage, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError (simulated)");
      });
    // The matched attempt must still resolve normally — the save is fire-and-forget.
    const a = await engineStore.getState().addAttempt(pre(closeM));
    expect(a.score).toBeLessThanOrEqual(MATCH_THRESHOLD);
    expect(a.correction.moves.length).toBeGreaterThan(0);
    spy.mockRestore();
    expect(STORE.loadPriors()).toEqual([]); // nothing landed, nothing broke
  });

  it("even STORE.savePrior itself throwing cannot break addAttempt (engine belt)", async () => {
    const st = engineStore.getState();
    await st.setContext({ scene: "kitchen", time: "", rig: "" });
    await st.setImage("ref", pre(refM));
    await st.setImage("base", pre(baseM));
    await engineStore.getState().analyze();

    const spy = vi.spyOn(STORE, "savePrior").mockImplementation(() => {
      throw new Error("boom (simulated contract violation)");
    });
    const a = await engineStore.getState().addAttempt(pre(closeM));
    expect(a.score).toBeLessThanOrEqual(MATCH_THRESHOLD);
    expect(spy).toHaveBeenCalledTimes(1); // the gate fired; the throw was swallowed
    spy.mockRestore();
  });
});

// ===================================================================================
// Engine layer — the next analyze injects the prior as a bias block
// ===================================================================================

describe("engine: analyze() injects the best prior into the model request", () => {
  it("a fresh session with a matching context gets a PRIOR block (values capped at 16)", async () => {
    // A remembered landing zone with 20 settled values — only the first 16 may print.
    STORE.savePrior(
      mkPrior({
        context: { scene: "kitchen", time: "", rig: "" },
        values: Array.from({ length: 20 }, (_, i) => ({
          param: `k${String(i).padStart(2, "0")}`,
          value: i,
        })),
        matchPercent: 97,
      })
    );

    const st = engineStore.getState();
    st.reset(); // a brand-new session, same scene
    await engineStore.getState().setContext({ scene: "kitchen", time: "", rig: "" });
    await engineStore.getState().setImage("ref", pre(refM));
    await engineStore.getState().setImage("base", pre(baseM));
    await engineStore.getState().analyze();

    const recipeReq = seen.find((r) => r.mode === "recipe")!;
    const priorBlock = recipeReq.userContent.find(
      (b): b is Extract<ContentBlock, { type: "text" }> =>
        b.type === "text" && b.text.startsWith("PRIOR —")
    );
    expect(priorBlock).toBeTruthy();
    const text = priorBlock!.text;
    // Names WHICH context fields matched, and how good the landing zone was.
    expect(text).toContain("(matching scene)");
    expect(text).toContain("~97%");
    // Values print as param=value, capped at 16: k15 is in, k16..k19 are not.
    expect(text).toContain("k00=0");
    expect(text).toContain("k15=15");
    expect(text).not.toContain("k16");
    // The trust ordering stays explicit — evidence beats memory.
    expect(text).toContain("Use as a starting bias; the measured evidence still wins on any conflict.");
  });

  it("no stored prior -> no PRIOR block, and analyze is unaffected", async () => {
    const st = engineStore.getState();
    await st.setContext({ scene: "kitchen", time: "dusk", rig: "" });
    await st.setImage("ref", pre(refM));
    await st.setImage("base", pre(baseM));
    const recipe = await engineStore.getState().analyze();
    expect(recipe.values.length).toBe(RECIPE.values.length);
    expect(textOf(seen[0])).not.toContain("PRIOR —");
  });

  it("a prior whose context does not overlap this session is NOT injected", async () => {
    STORE.savePrior(mkPrior({ context: { scene: "warehouse", time: "night", rig: "" } }));
    const st = engineStore.getState();
    await st.setContext({ scene: "kitchen", time: "dusk", rig: "" });
    await st.setImage("ref", pre(refM));
    await st.setImage("base", pre(baseM));
    await engineStore.getState().analyze();
    expect(textOf(seen[0])).not.toContain("PRIOR —");
  });
});
