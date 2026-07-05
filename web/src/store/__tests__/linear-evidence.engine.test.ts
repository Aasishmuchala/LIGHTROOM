// EXR-native evidence wiring (2026-07-05) — the engine must spread linear_evidence
// into the metricsBundle ONLY when BOTH compared images are EXR-backed:
//   - analyze():   ref slot stats AND base slot stats  -> included;
//   - addAttempt(): ref slot stats AND this attempt EXR -> included (a PreCaptured/PNG
//     attempt is a mixed pair -> omitted);
//   - anything mixed / missing / pre-stats slot state   -> the key is ABSENT entirely
//     (never null, never a half-filled object).
// exrSlots is the in-memory side channel (never persisted), so tests inject it with
// engineStore.setState AFTER the PreCaptured setImage calls (a non-EXR setImage clears
// the slot's EXR state — that clearing is itself pinned below). Assertions read the
// captured _analyze request's userContent text — the exact bytes the model sees.

import "../../test/setup";
import { beforeEach, describe, it, expect } from "vitest";
import {
  engineStore,
  type PreCaptured,
  type EngineStore,
  type ExrSlotState,
} from "@/store/useEngine";
import { STORE } from "@/lib/store";
import { clearLocalStorage } from "../../test/setup";
import { linearStats, type LinearEvidence } from "@/lib/develop";
import type { ContentBlock } from "@/lib/client-adapter";
import type { MetricVector } from "@/lib/types";

// -- canned display-referred metrics (the PreCaptured escape hatch) -----------------
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

// -- synthetic EXR slot state: a textured linear buffer + REAL linearStats ----------
const W = 16;
const H = 16;
function linearBuf(gain: number): Float32Array {
  const out = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = (0.2 + ((i * 37) % 101) / 101) * gain; // deterministic texture, no zeros
    const p = i * 4;
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 1;
  }
  return out;
}
function exrSlot(gain: number): ExrSlotState {
  const linear = linearBuf(gain);
  return { linear, width: W, height: H, ev: 0, stats: linearStats(linear, W, H) };
}

// -- captured requests + the evidence text block the model actually reads -----------
interface SeenRequest {
  mode: string;
  userContent: ContentBlock[];
}
const seen: SeenRequest[] = [];
function evidenceText(req: SeenRequest): string {
  return req.userContent
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
function parseBundle(text: string): Record<string, unknown> {
  // The evidence block is legend + JSON + optional asymmetry line; neither the legend
  // nor the asymmetry line contains braces, so first-{ .. last-} is the bundle.
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

const fakeRecipe = () => ({
  baseline: "factory_defaults", hdri_mood: "clear",
  values: [{ param: "sun.intensity_mult", set: 1.2, from: 1.0, step: 2, confidence: "high", why: "w" }],
  rationale: "r", gi_notes: "g", status: "continue",
});
const fakeCorrection = () => ({
  moves: [{ param: "sun.intensity_mult", to: 1.1, from: 1.2, step: 2, confidence: "high", why: "trim" }],
  rationale: "r", status: "continue", status_reason: "s", applied_assumed: true,
});

beforeEach(async () => {
  clearLocalStorage();
  STORE._useDb("lightmatch-linear-evidence-" + Math.random().toString(36).slice(2));
  seen.length = 0;
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
  engineStore.setState({
    _analyze: (async (req: SeenRequest) => {
      seen.push(req);
      return req.mode === "correction" ? fakeCorrection() : fakeRecipe();
    }) as unknown as EngineStore["_analyze"],
  });
  // PreCaptured images FIRST (a non-EXR setImage clears the slot's EXR state), then
  // each test injects the exrSlots side channel it wants.
  await st.setImage("ref", pre(0));
  await st.setImage("base", pre(0.1));
});

describe("analyze(): linear_evidence gated on BOTH slots being EXR-backed", () => {
  it("both ref+base EXR-backed -> bundle carries linear_evidence with the exact gap", async () => {
    engineStore.setState({
      exrSlots: { ref: exrSlot(4), base: exrSlot(1), settings: null }, // ref 2 stops brighter
    });
    await engineStore.getState().analyze();
    const text = evidenceText(seen[0]);
    expect(text).toContain('"linear_evidence"');
    // The legend explains the override contract in the same request.
    expect(text).toContain("SCENE-REFERRED");
    const bundle = parseBundle(text);
    const le = bundle.linear_evidence as LinearEvidence;
    // Exact linear-domain gap (x4 gain = 2.00 stops), correct sign (ref brighter).
    expect(le.exposure_gap_ev_exact).toBe(2);
    expect(le.reference.median_lum!).toBeGreaterThan(le.current.median_lum!);
    expect(le.reference.highlight_cct_k).not.toBeNull();
    expect(le.current.dynamic_range_ev).not.toBeNull();
    // The display-referred evidence still travels alongside — override, not replace.
    expect(bundle.exposure_gap_ev).not.toBeUndefined();
    expect(bundle.wb_estimate_k).not.toBeUndefined();
  });

  it("mixed pair (ref EXR, base PNG) -> the key is absent entirely", async () => {
    engineStore.setState({ exrSlots: { ref: exrSlot(1), base: null, settings: null } });
    await engineStore.getState().analyze();
    expect(evidenceText(seen[0])).not.toContain('"linear_evidence"');
  });

  it("a slot whose EXR state predates the stats field contributes nothing (null-guard)", async () => {
    // Older injected/loaded state: buffer present, stats missing — must not crash and
    // must not emit a half-filled evidence block.
    const preStats = { linear: linearBuf(1), width: W, height: H, ev: 0 } as ExrSlotState;
    engineStore.setState({ exrSlots: { ref: exrSlot(2), base: preStats, settings: null } });
    await engineStore.getState().analyze();
    expect(evidenceText(seen[0])).not.toContain('"linear_evidence"');
  });

  it("replacing an EXR-backed slot with a PNG clears its EXR state -> evidence disappears", async () => {
    engineStore.setState({
      exrSlots: { ref: exrSlot(4), base: exrSlot(1), settings: null },
    });
    await engineStore.getState().setImage("base", pre(0.2)); // non-EXR replacement
    expect(engineStore.getState().exrSlots.base).toBeNull();
    await engineStore.getState().analyze();
    expect(evidenceText(seen[0])).not.toContain('"linear_evidence"');
  });
});

describe("addAttempt(): a non-EXR attempt against an EXR reference is a mixed pair", () => {
  it("correction bundle omits linear_evidence for a PreCaptured attempt even with ref stats", async () => {
    engineStore.setState({
      exrSlots: { ref: exrSlot(4), base: exrSlot(1), settings: null },
    });
    await engineStore.getState().analyze(); // seed the recipe (seen[0])
    await engineStore.getState().addAttempt(pre(0.05)); // PNG-shaped attempt
    expect(seen[1].mode).toBe("correction");
    const text = evidenceText(seen[1]);
    // The display-referred evidence is intact; the scene-referred block is absent.
    expect(text).toContain('"exposure_gap_ev"');
    expect(text).not.toContain('"linear_evidence"');
  });
});
