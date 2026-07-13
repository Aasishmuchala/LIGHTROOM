// chat-client — toWire() history hygiene + askExpert() marshaling. STORE key/model
// are read from localStorage (jsdom-backed by the test setup).

import "../../test/setup";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { toWire, askExpert, WIRE_TURNS, type ExpertMsg } from "@/lib/chat-client";
import { STORE } from "@/lib/store";
import { clearLocalStorage } from "../../test/setup";

const PNG = "data:image/png;base64,AAAABBBBCCCC";

beforeEach(() => {
  clearLocalStorage();
});

describe("toWire", () => {
  it("keeps only the last WIRE_TURNS turns", () => {
    const msgs: ExpertMsg[] = Array.from({ length: WIRE_TURNS + 6 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `m${i}`,
    }));
    const wire = toWire(msgs);
    expect(wire.length).toBe(WIRE_TURNS);
    expect(wire[wire.length - 1].content).toBe(`m${msgs.length - 1}`);
  });

  it("attaches the image only to the NEWEST image-bearing turn", () => {
    const msgs: ExpertMsg[] = [
      { role: "user", content: "check 1", imageDataUrl: PNG },
      { role: "assistant", content: "not matched" },
      { role: "user", content: "check 2", imageDataUrl: PNG },
    ];
    const wire = toWire(msgs);
    expect(wire[0].image).toBeUndefined(); // older check-in image dropped
    expect(wire[2].image).toEqual({ mediaType: "image/png", base64: "AAAABBBBCCCC" });
  });

  it("drops an image whose dataUrl is not a clean image data URL", () => {
    const wire = toWire([{ role: "user", content: "x", imageDataUrl: "javascript:alert(1)" }]);
    expect(wire[0].image).toBeUndefined();
  });
});

describe("askExpert", () => {
  it("returns a friendly error and never calls fetch when no key is set", async () => {
    const fetchImpl = vi.fn();
    const r = await askExpert("vray7max", "digest", [{ role: "user", content: "hi" }], fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/key/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs to /api/chat with the key header and returns the answer", async () => {
    STORE.setKey("oc_testkey");
    STORE.setPrefs({ model: "claude-opus-4-8" });
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, answer: "raise the sun" }), { status: 200 })
    );
    const r = await askExpert("vray7max", "DIGEST", [{ role: "user", content: "how?" }], fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    expect(r.answer).toBe("raise the sun");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect((init as RequestInit).headers).toMatchObject({ "x-omega-key": "oc_testkey" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.target).toBe("vray7max");
    expect(body.digest).toBe("DIGEST");
    expect(body.model).toBe("claude-opus-4-8");
  });

  it("surfaces the route's error envelope", async () => {
    STORE.setKey("oc_testkey");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "Gateway returned 401" }), { status: 200 }));
    const r = await askExpert("vray7max", "", [{ role: "user", content: "x" }], fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401/);
  });

  it("never throws on a network failure", async () => {
    STORE.setKey("oc_testkey");
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); });
    const r = await askExpert("vray7max", "", [{ role: "user", content: "x" }], fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/offline|reach/i);
  });
});
