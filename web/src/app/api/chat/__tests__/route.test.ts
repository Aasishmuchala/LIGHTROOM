// /api/chat — the expert-line proxy. Tests cover the pure wire-guards (buildChatSystem,
// sanitizeMessages) and the POST envelope contract (no-key, bad-JSON, malformed messages,
// image-forces-Opus, success), with fetch stubbed so no gateway call is made.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  POST,
  buildChatSystem,
  sanitizeMessages,
  VISION_MODEL,
  MAX_MESSAGES,
  MAX_IMAGE_B64_CHARS,
} from "@/app/api/chat/route";

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3007/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const userMsg = (content = "hi") => ({ role: "user", content });

afterEach(() => vi.restoreAllMocks());

describe("buildChatSystem", () => {
  it("embeds the renderer, digest, and the pack listing", () => {
    const s = buildChatSystem("vantage33", "SESSION DIGEST — foo");
    expect(s).toMatch(/Chaos Vantage 3.3/);
    expect(s).toMatch(/SESSION DIGEST — foo/);
    expect(s).toMatch(/PACK LISTING/);
    expect(s).toMatch(/RENDER CHECK-INS/);
  });
  it("defaults to V-Ray vocabulary for an unknown target", () => {
    expect(buildChatSystem(undefined, "")).toMatch(/V-Ray 7/);
  });
});

describe("sanitizeMessages", () => {
  it("rejects non-arrays, empties, and over-cap arrays", () => {
    expect(sanitizeMessages(null)).toBeNull();
    expect(sanitizeMessages([])).toBeNull();
    expect(sanitizeMessages(Array.from({ length: MAX_MESSAGES + 1 }, () => userMsg()))).toBeNull();
  });
  it("rejects a conversation not ending on a user turn", () => {
    expect(sanitizeMessages([userMsg(), { role: "assistant", content: "a" }])).toBeNull();
  });
  it("rejects a bad role or non-string content", () => {
    expect(sanitizeMessages([{ role: "system", content: "x" }])).toBeNull();
    expect(sanitizeMessages([{ role: "user", content: 5 }])).toBeNull();
  });
  it("rejects an oversized or non-base64 image", () => {
    expect(
      sanitizeMessages([{ role: "user", content: "x", image: { mediaType: "image/png", base64: "not base64!" } }])
    ).toBeNull();
    expect(
      sanitizeMessages([
        { role: "user", content: "x", image: { mediaType: "image/png", base64: "A".repeat(MAX_IMAGE_B64_CHARS + 1) } },
      ])
    ).toBeNull();
  });
  it("accepts a clean image-bearing user turn", () => {
    const out = sanitizeMessages([{ role: "user", content: "check", image: { mediaType: "image/jpeg", base64: "AAAA" } }]);
    expect(out).not.toBeNull();
    expect(out![0].image).toEqual({ mediaType: "image/jpeg", base64: "AAAA" });
  });
});

describe("POST envelope", () => {
  it("no key -> ok:false with a key hint, 200, no fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await POST(req({ model: "claude-opus-4-8", messages: [userMsg()] }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/key/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("invalid JSON body -> clean error envelope", async () => {
    const res = await POST(req("{not json", { "x-omega-key": "oc_k" }));
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/valid JSON/i);
  });

  it("malformed messages -> clean error envelope, no fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await POST(req({ model: "claude-opus-4-8", messages: "nope" }, { "x-omega-key": "oc_k" }));
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/malformed|missing/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("an image-bearing turn forces the Opus vision model even if gpt is picked", async () => {
    let sentModel = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sentModel = JSON.parse((init as RequestInit).body as string).model;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "verdict" }] }), { status: 200 });
    });
    const res = await POST(
      req(
        {
          model: "gpt-5.5",
          target: "vray7max",
          messages: [{ role: "user", content: "check", image: { mediaType: "image/png", base64: "AAAA" } }],
        },
        { "x-omega-key": "oc_k" }
      )
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.answer).toBe("verdict");
    expect(sentModel).toBe(VISION_MODEL);
  });

  it("a text-only turn keeps the picked model and returns the parsed text answer", async () => {
    let sentModel = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sentModel = JSON.parse((init as RequestInit).body as string).model;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "raise sun to 1.4" }] }), { status: 200 });
    });
    const res = await POST(
      req({ model: "gpt-5.5", target: "vray7max", messages: [userMsg("how?")] }, { "x-omega-key": "oc_k" })
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.answer).toBe("raise sun to 1.4");
    expect(sentModel).toBe("gpt-5.5");
  });

  it("maps a gateway 401 to a clean auth error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    const res = await POST(req({ model: "claude-opus-4-8", messages: [userMsg()] }, { "x-omega-key": "oc_bad" }));
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/401/);
  });
});
