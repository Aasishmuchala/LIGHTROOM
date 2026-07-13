// Engine expert-chat methods: chatAppend / chatCheckin / chatClear + persistence,
// the CHAT_CAP bound, the "no reference" and "unusable metrics" guards, and the
// import sanitizer for session.chat.

import "../../test/setup";
import { beforeEach, describe, it, expect } from "vitest";
import { engineStore, CHAT_CAP, type PreCaptured } from "@/store/useEngine";
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

beforeEach(() => {
  clearLocalStorage();
  STORE._useDb("lightmatch-chat-" + Math.random().toString(36).slice(2));
  const st = engineStore.getState();
  st._testSessionId = null;
  st.reset();
});

describe("chatAppend + persistence + cap", () => {
  it("appends messages, stamps `at`, and round-trips through the store", async () => {
    await engineStore.getState().chatAppend({ role: "user", content: "why is my sun blown out?" });
    await engineStore.getState().chatAppend({ role: "assistant", content: "lower VFB exposure by 0.5" });
    const msgs = engineStore.getState().chatMessages();
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(typeof msgs[0].at).toBe("string");
    const loaded = await STORE.loadLatest();
    expect((loaded as { chat?: { messages: unknown[] } })?.chat?.messages.length).toBe(2);
  });

  it("bounds the transcript at CHAT_CAP, dropping the oldest", async () => {
    for (let i = 0; i < CHAT_CAP + 8; i++) {
      await engineStore.getState().chatAppend({ role: "user", content: `m${i}` });
    }
    const msgs = engineStore.getState().chatMessages();
    expect(msgs.length).toBe(CHAT_CAP);
    expect(msgs[msgs.length - 1].content).toBe(`m${CHAT_CAP + 7}`);
    expect(msgs[0].content).toBe(`m8`); // oldest 8 evicted
  });

  it("chatClear drops the whole transcript and persists the clear", async () => {
    await engineStore.getState().chatAppend({ role: "user", content: "x" });
    await engineStore.getState().chatClear();
    expect(engineStore.getState().chatMessages()).toEqual([]);
    const loaded = await STORE.loadLatest();
    expect((loaded as { chat?: unknown })?.chat).toBeFalsy();
  });
});

describe("chatCheckin", () => {
  it("measures a render vs the reference and appends a scored check-in turn", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    const res = await engineStore.getState().chatCheckin(pre(0)); // identical to ref
    expect(res.evidence.score).toBe(0);
    expect(res.evidence.matchPercent).toBe(100);
    expect(res.evidence.matched).toBe(true);
    expect(res.preCaptured.metrics).toBeTruthy();
    const last = engineStore.getState().chatMessages().slice(-1)[0];
    expect(last.role).toBe("user");
    expect(last.checkin?.matchPercent).toBe(100);
    expect(last.checkin?.evidenceText).toMatch(/CHECK-IN EVIDENCE/);
  });

  it("throws (does NOT append) when no reference is loaded", async () => {
    await expect(engineStore.getState().chatCheckin(pre(0))).rejects.toThrow(/reference/i);
    expect(engineStore.getState().chatMessages()).toEqual([]);
  });

  it("makes NO model call and does not touch the analyze in-flight gate", async () => {
    const st = engineStore.getState();
    await st.setImage("ref", pre(0));
    await st.setImage("base", pre(0.1));
    await engineStore.getState().chatCheckin(pre(0.2));
    expect(engineStore.getState()._inFlight).toBeNull();
  });
});

describe("import sanitizer for session.chat", () => {
  it("keeps a clean transcript and drops malformed rows", async () => {
    const session = {
      id: "imp-chat-1",
      created: "2020-01-01T00:00:00.000Z",
      context: { scene: "", time: "", rig: "" },
      ref: null,
      base: null,
      settingsShot: null,
      activeTarget: "vray7max",
      chains: { vray7max: { recipe: null, attempts: [] }, vantage33: { recipe: null, attempts: [] } },
      chat: {
        messages: [
          { role: "user", content: "keep me", at: "x" },
          { role: "bogus", content: "drop me" },
          { role: "assistant", content: 42 },
          { role: "assistant", content: "keep me too", at: "y" },
        ],
      },
    };
    const imported = await STORE.importJSON(JSON.stringify(session));
    const chat = (imported as unknown as { chat?: { messages: { content: string }[] } }).chat;
    expect(chat?.messages.length).toBe(2);
    expect(chat?.messages.map((m) => m.content)).toEqual(["keep me", "keep me too"]);
  });

  it("REJECTS the whole import when a check-in carries a hostile dataUrl", async () => {
    const session = {
      id: "imp-chat-2",
      created: "2020-01-01T00:00:00.000Z",
      context: { scene: "", time: "", rig: "" },
      ref: null,
      base: null,
      settingsShot: null,
      activeTarget: "vray7max",
      chains: { vray7max: { recipe: null, attempts: [] }, vantage33: { recipe: null, attempts: [] } },
      chat: {
        messages: [
          { role: "user", content: "check", at: "x", checkin: { dataUrl: "javascript:alert(1)", score: 5, matchPercent: 95, evidenceText: "e" } },
        ],
      },
    };
    await expect(STORE.importJSON(JSON.stringify(session))).rejects.toThrow(/invalid image payload/i);
  });

  it("preserves a check-in with a valid image dataUrl", async () => {
    const session = {
      id: "imp-chat-3",
      created: "2020-01-01T00:00:00.000Z",
      context: { scene: "", time: "", rig: "" },
      ref: null,
      base: null,
      settingsShot: null,
      activeTarget: "vray7max",
      chains: { vray7max: { recipe: null, attempts: [] }, vantage33: { recipe: null, attempts: [] } },
      chat: {
        messages: [
          { role: "user", content: "check", at: "x", checkin: { dataUrl: PNG, score: 5, matchPercent: 95, evidenceText: "e" } },
        ],
      },
    };
    const imported = await STORE.importJSON(JSON.stringify(session));
    const chat = (imported as unknown as { chat?: { messages: { checkin?: { dataUrl: string } }[] } }).chat;
    expect(chat?.messages[0].checkin?.dataUrl).toBe(PNG);
  });
});
