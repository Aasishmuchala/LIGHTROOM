// Live 3ds Max settings — engine wiring: setLiveSettings persists with the session,
// and the CURRENT SCENE SETTINGS evidence block reaches the model on analyze AND
// correction rounds (with the settings_screenshot baseline instruction), while
// sessions without live settings emit nothing.

import "../../test/setup";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { engineStore, type PreCaptured, type EngineStore } from "@/store/useEngine";
import { STORE } from "@/lib/store";
import type { MetricVector } from "@/lib/types";
import { clearLocalStorage } from "../../test/setup";
import type { ContentBlock } from "@/lib/client-adapter";

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
const pre = (b = 0): PreCaptured => ({ dataUrl: "data:image/png;base64,AAAA", metrics: metricVector(b) });

const fakeRecipe = () => ({
  baseline: "settings_screenshot", hdri_mood: "clear",
  values: [{ param: "sun.intensity_mult", set: 1.2, from: 1.0, step: 2, confidence: "high", why: "w" }],
  rationale: "r", gi_notes: "g", status: "continue",
});
const fakeCorrection = () => ({
  moves: [{ param: "sun.intensity_mult", to: 1.1, from: 1.2, step: 2, confidence: "high", why: "w" }],
  rationale: "r", status: "continue", status_reason: "s", applied_assumed: true,
});

const seen: { mode: string; text: string }[] = [];

beforeEach(async () => {
  clearLocalStorage();
  STORE._useDb("lightmatch-maxlive-" + Math.random().toString(36).slice(2));
  seen.length = 0;
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
  engineStore.setState({
    _analyze: vi.fn(async (req: { mode: string; userContent: ContentBlock[] }) => {
      seen.push({
        mode: req.mode,
        text: req.userContent
          .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n"),
      });
      return req.mode === "correction" ? fakeCorrection() : fakeRecipe();
    }) as unknown as EngineStore["_analyze"],
  });
});

const LIVE = {
  renderer: "V_Ray_7",
  at: "2026-07-05T12:00:00.000Z",
  counts: { suns: 1, vrayLights: 2, physCams: 1 },
  params: { "sun.turbidity": 3.1, "cam.iso": 100, "sun.enabled": "on" as const },
};

describe("live 3ds Max settings", () => {
  it("persist with the session and survive a store round trip", async () => {
    const st = engineStore.getState();
    await st.setLiveSettings(LIVE);
    expect(engineStore.getState().session.liveSettings?.params["cam.iso"]).toBe(100);
    const stored = await STORE.loadLatest();
    expect((stored as unknown as { liveSettings?: typeof LIVE }).liveSettings?.renderer).toBe("V_Ray_7");
    // clearing works too
    await engineStore.getState().setLiveSettings(null);
    expect(engineStore.getState().session.liveSettings).toBeNull();
  });

  it("ride into BOTH analyze and correction requests as CURRENT SCENE SETTINGS", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    await st.setLiveSettings(LIVE);
    await engineStore.getState().analyze();
    await engineStore.getState().addAttempt(pre(0.05));

    expect(seen.length).toBe(2);
    for (const req of seen) {
      expect(req.text).toContain("CURRENT SCENE SETTINGS");
      expect(req.text).toContain("read LIVE from 3ds Max");
      expect(req.text).toContain("sun.turbidity = 3.1");
      expect(req.text).toContain('baseline:"settings_screenshot"');
    }
  });

  it("absent live settings emit no block (old sessions unaffected)", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    await engineStore.getState().analyze();
    expect(seen[0].text).not.toContain("CURRENT SCENE SETTINGS");
  });
});
