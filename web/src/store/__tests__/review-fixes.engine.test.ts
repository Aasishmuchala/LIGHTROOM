// Review-round engine fix (2026-07-05, finding #3): importJSON must clear the EXR
// side channel like boot()/reset() do — otherwise the PREVIOUS session's retained
// linear buffers keep feeding linear_evidence (which the legend tells the model to
// PREFER) into analyses of the IMPORTED session's completely unrelated images.

import "../../test/setup";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { engineStore, type EngineStore, type ExrSlotState } from "@/store/useEngine";
import { STORE } from "@/lib/store";
import { clearLocalStorage } from "../../test/setup";

const PNG = "data:image/png;base64,AAAA";

function fakeExrSlot(): ExrSlotState {
  return {
    linear: new Float32Array(16),
    width: 2,
    height: 2,
    ev: 1.5,
    stats: {
      median_lum: 0.2,
      p99_lum: 0.9,
      dynamic_range_ev: 4,
      highlight_cct_k: 5200,
      highlight_tint_gm: 0,
    },
  } as ExrSlotState;
}

function sessionJson(): string {
  return JSON.stringify({
    id: "imported-" + Math.random().toString(36).slice(2),
    created: "2026-01-01T00:00:00.000Z",
    context: { scene: "", time: "", rig: "" },
    ref: { dataUrl: PNG },
    base: { dataUrl: PNG },
    settingsShot: null,
    activeTarget: "vray7max",
    chains: {
      vray7max: { recipe: null, attempts: [] },
      vantage33: { recipe: null, attempts: [] },
    },
  });
}

beforeEach(() => {
  clearLocalStorage();
  STORE._useDb("lightmatch-reviewfix-" + Math.random().toString(36).slice(2));
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
  engineStore.setState({
    _analyze: vi.fn(async () => ({})) as unknown as EngineStore["_analyze"],
  });
});

describe("importJSON clears the EXR side channel", () => {
  it("stale linear buffers cannot survive into an imported session", async () => {
    engineStore.setState({
      exrSlots: { ref: fakeExrSlot(), base: fakeExrSlot(), settings: null },
    });
    expect(engineStore.getState().exrSlots.ref).not.toBeNull();

    await engineStore.getState().importJSON(sessionJson());

    const slots = engineStore.getState().exrSlots;
    expect(slots.ref).toBeNull();
    expect(slots.base).toBeNull();
    expect(slots.settings).toBeNull();
    // and the exposure slider affordance is gone with them
    expect(engineStore.getState().exrEv("ref")).toBeNull();
  });
});
