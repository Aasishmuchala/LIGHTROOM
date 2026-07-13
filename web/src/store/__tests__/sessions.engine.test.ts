// Session switcher — the multi-area workflow's missing leg. Pins:
//   - STORE.listSessions summaries (newest first, best score across chains, thumb
//     only when DATAURL_RE-clean), loadById, renameSession (trim + cap);
//   - engine openSession (re-stamps created for prune survival + list order, clears
//     the EXR side channel and stale errors, refuses mid-flight), newSession (blank,
//     previous session stays persisted), deleteSession (live one swaps to newest);
//   - the raised retention cap actually keeps a big project's areas.

import "../../test/setup";
import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  engineStore,
  BusyError,
  SESSION_RETENTION_CAP,
  type EngineStore,
  type PreCaptured,
} from "@/store/useEngine";
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

const storedSession = (id: string, created: string, extra: Record<string, unknown> = {}) => ({
  id,
  created,
  context: { scene: "", time: "", rig: "" },
  ref: null,
  base: null,
  settingsShot: null,
  activeTarget: "vray7max",
  chains: {
    vray7max: { recipe: null, attempts: [] },
    vantage33: { recipe: null, attempts: [] },
  },
  ...extra,
});

beforeEach(() => {
  clearLocalStorage();
  STORE._useDb("lightmatch-sess-" + Math.random().toString(36).slice(2));
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
});

describe("STORE.listSessions / loadById / renameSession", () => {
  it("summarizes newest-first with best score across BOTH chains and a vetted thumb", async () => {
    await STORE.saveSession(storedSession("s-old", "2026-01-01T00:00:00.000Z", {
      name: "Living room",
      ref: { dataUrl: PNG, metrics: mv(0) },
      chains: {
        vray7max: { recipe: { values: [] }, attempts: [{ score: 12 }] },
        vantage33: { recipe: null, attempts: [{ score: 4 }] },
      },
      lockGlobals: true,
    }) as never);
    await STORE.saveSession(storedSession("s-new", "2026-02-01T00:00:00.000Z", {
      ref: { dataUrl: "javascript:alert(1)" }, // hostile thumb must be dropped
    }) as never);

    const list = await STORE.listSessions();
    expect(list.map((s) => s.id)).toEqual(["s-new", "s-old"]);
    const old = list[1];
    expect(old.name).toBe("Living room");
    expect(old.bestScore).toBe(4); // min across chains
    expect(old.attempts).toBe(2);
    expect(old.hasRecipe).toBe(true);
    expect(old.lockGlobals).toBe(true);
    expect(old.refThumb).toBe(PNG);
    expect(list[0].refThumb).toBeNull(); // hostile dataUrl never becomes a thumb
    expect(list[0].bestScore).toBeNull();
  });

  it("loadById returns the exact session; renameSession trims and caps", async () => {
    await STORE.saveSession(storedSession("s-x", "2026-01-01T00:00:00.000Z") as never);
    expect((await STORE.loadById("s-x"))?.id).toBe("s-x");
    expect(await STORE.loadById("nope")).toBeNull();

    await STORE.renameSession("s-x", "  " + "k".repeat(100));
    const renamed = await STORE.loadById("s-x");
    expect(renamed?.name).toBe("k".repeat(STORE.NAME_CAP));
    await STORE.renameSession("missing-id", "noop"); // must not throw
  });
});

describe("engine.openSession", () => {
  it("hydrates the stored session, re-stamps created, clears exr/error", async () => {
    await STORE.saveSession(storedSession("area-1", "2020-01-01T00:00:00.000Z", { name: "Kitchen" }) as never);
    // dirty the live state first
    await engineStore.getState().setImage("ref", pre(0));
    engineStore.setState({
      lastError: { kind: "other", at: "x" },
      exrSlots: { ref: { linear: new Float32Array(1), width: 1, height: 1, ev: 0 }, base: null, settings: null },
    });

    const opened = await engineStore.getState().openSession("area-1");
    expect(opened.id).toBe("area-1");
    expect(opened.name).toBe("Kitchen");
    expect(opened.created > "2020-01-01T00:00:00.000Z").toBe(true); // re-stamped
    expect(engineStore.getState().lastError).toBeNull();
    expect(engineStore.getState().exrSlots.ref).toBeNull();
    // it became loadLatest()'s pick (prune survival + list order)
    expect((await STORE.loadLatest())?.id).toBe("area-1");
  });

  it("throws on an unknown id and refuses mid-flight with BusyError", async () => {
    await expect(engineStore.getState().openSession("ghost")).rejects.toThrow(/no stored session/i);

    await engineStore.getState().setImage("ref", pre(0));
    await engineStore.getState().setImage("base", pre(0.1));
    let release!: (v: Record<string, unknown>) => void;
    engineStore.setState({
      _analyze: vi.fn(() => new Promise((res) => { release = res; })) as unknown as EngineStore["_analyze"],
    });
    const p = engineStore.getState().analyze();
    await STORE.saveSession(storedSession("area-2", "2020-01-01T00:00:00.000Z") as never);
    await expect(engineStore.getState().openSession("area-2")).rejects.toBeInstanceOf(BusyError);
    release({ baseline: "factory_defaults", hdri_mood: "x", values: [], rationale: "r", gi_notes: "g", status: "continue" });
    await p;
  });
});

describe("engine.newSession / deleteSession", () => {
  it("newSession swaps to a blank while the previous session stays persisted", async () => {
    await engineStore.getState().setImage("ref", pre(0));
    const prevId = engineStore.getState().session.id;
    const fresh = await engineStore.getState().newSession();
    expect(fresh.id).not.toBe(prevId);
    expect(fresh.ref).toBeNull();
    expect((await STORE.loadById(prevId))?.id).toBe(prevId); // still on disk
  });

  it("deleting the LIVE session swaps to the newest remaining one", async () => {
    await STORE.saveSession(storedSession("keeper", "2026-01-01T00:00:00.000Z", { name: "Keeper" }) as never);
    await engineStore.getState().setImage("ref", pre(0)); // persists the live session
    const liveId = engineStore.getState().session.id;
    const after = await engineStore.getState().deleteSession(liveId);
    expect(after.id).toBe("keeper");
    expect(await STORE.loadById(liveId)).toBeNull();
  });

  it("deleting a NON-live session leaves the live one alone", async () => {
    await STORE.saveSession(storedSession("bye", "2026-01-01T00:00:00.000Z") as never);
    const liveId = engineStore.getState().session.id;
    const after = await engineStore.getState().deleteSession("bye");
    expect(after.id).toBe(liveId);
    expect(await STORE.loadById("bye")).toBeNull();
  });
});

describe("retention", () => {
  it(`keeps ${SESSION_RETENTION_CAP} sessions — a six-area project survives boot's prune`, async () => {
    expect(SESSION_RETENTION_CAP).toBeGreaterThanOrEqual(24);
    for (let i = 0; i < SESSION_RETENTION_CAP + 3; i++) {
      await STORE.saveSession(
        storedSession(`a-${String(i).padStart(2, "0")}`, new Date(1700000000000 + i * 60000).toISOString()) as never
      );
    }
    await STORE.pruneToNewest(SESSION_RETENTION_CAP);
    const list = await STORE.listSessions();
    expect(list.length).toBe(SESSION_RETENTION_CAP);
    expect(list[0].id).toBe(`a-${String(SESSION_RETENTION_CAP + 2).padStart(2, "0")}`);
  });
});
