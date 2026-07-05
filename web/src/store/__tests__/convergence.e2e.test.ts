// End-to-end convergence — "figure out the settings, provide them, and the loop
// measurably converges."
//
// This exercises the WHOLE mechanical chain with REAL math (no canned metric
// vectors): synthetic renders are measured by the real measureFromPixels photometry,
// the engine assembles the real prompt + evidence, the stubbed model reply is
// validated/clamped by the REAL validateRecipe exactly as the /api/analyze route
// does, and the refine loop's score is the real scoreVectors. What is stubbed is
// ONLY the network hop to the gateway.
//
// The scenario: a warm reference lit from the LEFT vs a dim cool base lit from the
// RIGHT. Attempt 1 lands halfway (score drops), attempt 2 is a near-perfect
// re-render (score enters the MATCH_THRESHOLD band -> the measured "matched" gate
// the RefineLedger shows fires at >= 97%).

import "../../test/setup";
import { beforeEach, describe, it, expect } from "vitest";
import { engineStore, type PreCaptured, type EngineStore } from "@/store/useEngine";
import { STORE } from "@/lib/store";
import { clearLocalStorage } from "../../test/setup";
import {
  measureFromPixels,
  scoreVectors,
  matchPercent,
  MATCH_THRESHOLD,
} from "@/lib/metrics";
import { validateRecipe } from "@/lib/schemas";
import { PACKS } from "@/lib/packs";
import type { ContentBlock } from "@/lib/client-adapter";

// ---------------------------------------------------------------------------------
// Synthetic renders (64x64 RGBA, fully opaque, deterministic).
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

// Reference: bright, warm, key light from the LEFT (luminance falls off to the right).
const refFill = (x: number): [number, number, number] => {
  const k = 1 - (x / W) * 0.55;
  return [235 * k, 200 * k, 150 * k];
};
// Base: dim, cool, key from the RIGHT — everything is wrong (level, warmth, direction).
const baseFill = (x: number): [number, number, number] => {
  const k = 0.45 + (x / W) * 0.35;
  return [90 * k, 110 * k, 150 * k];
};
// Attempt 1: halfway between base and reference (a first re-render that helped).
const midFill = (x: number, y: number): [number, number, number] => {
  const a = refFill(x);
  const b = baseFill(x);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
};
// Attempt 2: the reference plus a tiny deterministic dither (render noise).
const closeFill = (x: number, y: number): [number, number, number] => {
  const a = refFill(x);
  const d = ((x * 7 + y * 13) % 3) - 1; // -1 | 0 | +1
  return [a[0] + d, a[1] + d, a[2] + d];
};

const refM = measureFromPixels(render(refFill), W, H);
const baseM = measureFromPixels(render(baseFill), W, H);
const midM = measureFromPixels(render(midFill), W, H);
const closeM = measureFromPixels(render(closeFill), W, H);

const PNG = "data:image/png;base64,AAAA";
const pre = (metrics: typeof refM): PreCaptured => ({ dataUrl: PNG, metrics });

// ---------------------------------------------------------------------------------
// The stubbed model: returns a realistic RAW emit which is then validated + cleaned
// by the REAL validateRecipe — the same contract the /api/analyze route enforces.
// The recipe deliberately includes one out-of-range value (sun.turbidity 25 on a
// [2,20] range) to prove the clamp reaches the stored chain.
// ---------------------------------------------------------------------------------
const RAW_RECIPE = {
  baseline: "factory_defaults",
  hdri_mood: "warm late-afternoon, clear",
  values: [
    { param: "vfb.exposure", set: 0.8, from: 0.0, step: 1, confidence: "high", why: "reference is ~1 EV brighter" },
    { param: "cam.wb_kelvin", set: 5200, from: 6500, step: 1, confidence: "high", why: "warm reference highlights" },
    { param: "sun.placement_azimuth", set: 90, from: 135, step: 2, confidence: "medium", why: "key must come from frame LEFT" },
    { param: "sun.placement_elevation", set: 20, from: 35, step: 2, confidence: "medium", why: "long soft falloff" },
    { param: "sun.turbidity", set: 25, from: 2.5, step: 2, confidence: "low", why: "haze warmth (deliberately out of range)" },
    { param: "dome.intensity", set: 0.7, from: 1.0, step: 3, confidence: "medium", why: "cool skylight is overpowering the key" },
    { param: "light.multiplier", set: 45, from: 30, step: 4, confidence: "low", why: "left fill to hold the ratio" },
    { param: "cm.highlight_burn", set: 0.7, from: 1.0, step: 5, confidence: "medium", why: "reference rolls highlights off" },
  ],
  rationale: "close the level gap first, then move the key to the left and warm it",
  gi_notes: "Brute force + Light cache defaults hold",
  status: "continue",
};

const RAW_CORRECTION = {
  moves: [
    { param: "sun.intensity_mult", to: 1.1, from: 1.0, step: 2, confidence: "high", why: "small remaining level gap" },
  ],
  rationale: "trim only",
  status: "continue",
  status_reason: "spatial layout now matches; level within a hair",
  applied_assumed: false,
};

interface SeenRequest {
  mode: string;
  system: string;
  userContent: ContentBlock[];
  target: string;
}
const seen: SeenRequest[] = [];

beforeEach(async () => {
  clearLocalStorage();
  STORE._useDb("lightmatch-e2e-test-" + Math.random().toString(36).slice(2));
  seen.length = 0;
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
  engineStore.setState({
    _analyze: (async (req: SeenRequest) => {
      seen.push(req);
      const raw = req.mode === "correction" ? RAW_CORRECTION : RAW_RECIPE;
      // The route's contract, verbatim: validate + clean before anything reaches the UI.
      const v = validateRecipe(raw, req.target, req.mode === "correction" ? "correction" : undefined);
      if (!v.ok) throw new Error("stub emit failed validation: " + v.errors.join("; "));
      return v.cleaned;
    }) as unknown as EngineStore["_analyze"],
  });
});

describe("the synthetic scene is genuinely mismatched at the start", () => {
  it("base scores far outside the match band against the reference", () => {
    const s = scoreVectors(refM, baseM);
    expect(s).toBeGreaterThan(MATCH_THRESHOLD * 5);
    expect(matchPercent(s)).toBeLessThan(90);
  });
});

describe("full loop: analyze -> recipe -> attempts converge to the measured gate", () => {
  it("runs the whole chain with real measurements and real validation", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(refM));
    await st.setImage("base", pre(baseM));
    expect(engineStore.getState().state()).toBe("ready");

    // -- analyze: the model's raw emit is validated + clamped, then stored. --------
    const recipe = await engineStore.getState().analyze();
    expect(engineStore.getState().state()).toBe("analyzed");
    expect(recipe.values.length).toBe(RAW_RECIPE.values.length);

    // The out-of-range turbidity was clamped to the pack ceiling and flagged.
    const turb = recipe.values.find((v) => v.param === "sun.turbidity")!;
    expect(turb.set).toBe(20);
    expect((turb as unknown as { clamped: boolean }).clamped).toBe(true);
    // An in-range value passed through untouched.
    const wb = recipe.values.find((v) => v.param === "cam.wb_kelvin")!;
    expect(wb.set).toBe(5200);
    expect((wb as unknown as { clamped: boolean }).clamped).toBe(false);
    // Every emitted param is a real, lighting:true pack entry.
    for (const v of recipe.values) {
      const entry = PACKS.lookup("vray7max", v.param);
      expect(entry, v.param).toBeTruthy();
      expect(entry!.lighting).toBe(true);
    }

    // The outgoing request offered the model the COMPLETE lighting option set.
    expect(seen[0].mode).toBe("recipe");
    expect(seen[0].system.endsWith(PACKS.promptFragment("vray7max"))).toBe(true);
    // ...and carried the measured evidence (diff + spatial asymmetry pre-chew).
    const evidence0 = seen[0].userContent
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    expect(evidence0).toContain("COMPUTED EVIDENCE");
    expect(evidence0).toContain('"diff"');
    expect(evidence0).toContain("SPATIAL ASYMMETRY");
    // Measured WB/exposure grounding travels with the evidence: the warm-left
    // reference vs the cool base must yield real CCTs and a positive EV gap
    // (reference is brighter), so the model's step-1 lock is arithmetic.
    expect(evidence0).toContain('"wb_estimate_k"');
    expect(evidence0).toContain('"tint_gm"');
    expect(evidence0).toContain('"exposure_gap_ev"');
    const bundle0 = JSON.parse(evidence0.slice(evidence0.indexOf("{"), evidence0.lastIndexOf("}") + 1));
    expect(bundle0.wb_estimate_k.reference_highlights).toBeLessThan(bundle0.wb_estimate_k.current_highlights);
    expect(bundle0.exposure_gap_ev).toBeGreaterThan(0);
    // Spatial evidence: the reference is keyed from the LEFT (centroid x < 0), the
    // base from the RIGHT (x > 0) — the exact direction signal the azimuth move needs.
    expect(bundle0.light_centroid.reference.x).toBeLessThan(0);
    expect(bundle0.light_centroid.current.x).toBeGreaterThan(0);
    expect(bundle0.key_fill_ratio.reference).toBeGreaterThan(1);
    expect(bundle0.anchors.reference.p50).toBeGreaterThan(bundle0.anchors.current.p50);
    // Sky-region evidence travels too (2026-07-05): the key is ALWAYS present so the
    // model can tell "no sky detected" (null side) from "evidence missing".
    expect(evidence0).toContain('"sky_estimate"');
    expect(bundle0).toHaveProperty("sky_estimate");

    // -- attempt 1: halfway there — the measured score must drop, but not match. ----
    const a1 = await engineStore.getState().addAttempt(pre(midM));
    const scoreBase = scoreVectors(refM, baseM);
    expect(a1.score).toBeLessThan(scoreBase);
    expect(a1.score).toBeGreaterThan(MATCH_THRESHOLD);

    // -- attempt 2: a near-perfect re-render — enters the measured match band. ------
    const a2 = await engineStore.getState().addAttempt(pre(closeM));
    expect(a2.score).toBeLessThan(a1.score);
    expect(a2.score).toBeLessThanOrEqual(MATCH_THRESHOLD);
    expect(matchPercent(a2.score)).toBeGreaterThanOrEqual(97);

    // The RefineLedger's measured gate condition (best attempt within threshold).
    const chain = engineStore.getState().activeChain()!;
    const best = chain.attempts.reduce((b, a) => (a.score < b.score ? a : b), chain.attempts[0]);
    expect(best.score).toBeLessThanOrEqual(MATCH_THRESHOLD);

    // -- the correction rounds carried the full context back to the model. ----------
    expect(seen.length).toBe(3); // 1 recipe + 2 corrections
    const corr2 = seen[2];
    expect(corr2.mode).toBe("correction");
    const text2 = corr2.userContent
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    // Reference + numbered attempt images travel each round.
    expect(text2).toContain("REFERENCE:");
    expect(text2).toContain("ATTEMPT 2:");
    // The move history threads EVERY prior round: the recipe (round 0, with the
    // CLAMPED value — 20, not the raw 25) and correction round 1.
    expect(text2).toContain("MOVE HISTORY");
    expect(text2).toContain("round 0: sun.turbidity 2.5 -> 20");
    expect(text2).toContain("round 0: cam.wb_kelvin 6500 -> 5200");
    expect(text2).toContain("round 1: sun.intensity_mult 1 -> 1.1");
  });
});
