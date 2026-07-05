// REALISTIC gateway smoke — drives the REAL POST handler end-to-end with model replies
// shaped the way the omega gateway actually returns them: NO tool_use block (the gateway
// ignores forced tool_choice — see route.ts), the recipe JSON living inside a TEXT block,
// usually after prose and/or a ```json fence, sometimes truncated. This is the single
// most under-tested surface (the gateway leg has only ever been stubbed with a clean
// tool_use); here we prove the actual parse → validate → clamp → re-ask path survives
// realistic model output — WITHOUT a live key. Mocked fetch, never the network.

import { describe, it, expect, vi, afterEach } from "vitest";
import { POST } from "../route";

// -- a realistic 8-move V-Ray recipe the way a competent model would emit it, using
//    real pack ids so validateRecipe accepts it (and one deliberately out-of-range
//    value to prove server-side clamping fires end-to-end). ---------------------------
const REALISTIC_RECIPE = {
  baseline: "factory_defaults",
  hdri_mood: "golden hour, low warm sun, clear sky",
  values: [
    { param: "vfb.exposure", set: 0.6, from: 0.0, step: 1, confidence: "high", why: "reference ~0.6 EV brighter (measured)" },
    { param: "cam.wb_kelvin", set: 5200, from: 6500, step: 1, confidence: "high", why: "warm reference highlights ~5200K" },
    { param: "sun.placement_azimuth", set: "azimuth ~110 deg", from: 135, step: 2, confidence: "medium", why: "key from frame left" },
    { param: "sun.placement_elevation", set: "elevation ~15 deg", from: 35, step: 2, confidence: "medium", why: "low, long shadows" },
    { param: "sun.turbidity", set: 35, from: 2.5, step: 2, confidence: "low", why: "hazy warmth (deliberately over range -> must clamp to 20)" },
    { param: "dome.intensity", set: 0.7, from: 1.0, step: 3, confidence: "medium", why: "cool skylight overpowering key" },
    { param: "cm.highlight_burn", set: 0.7, from: 1.0, step: 5, confidence: "medium", why: "reference rolls highlights off" },
    { param: "fog.enabled", set: "on", from: "off", step: 6, confidence: "low", why: "faint depth haze" },
  ],
  rationale: "lock exposure and WB first, then move and warm the key, tame the dome, roll highlights.",
  gi_notes: "Brute force + Light cache defaults hold",
  status: "continue",
};

// -- textReply(text, stop): the gateway's real shape — a single text block, no tool_use.
function textReply(text: string, stop = "end_turn") {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      stop_reason: stop,
      usage: { output_tokens: 1200 },
      content: [{ type: "text", text }],
    }),
    text: async () => "",
  } as unknown as Response;
}

// The ways a real model actually wraps the JSON in a text block.
const asBareJson = (r: unknown) => JSON.stringify(r);
const asFenced = (r: unknown) => "```json\n" + JSON.stringify(r, null, 2) + "\n```";
const asProseThenFence = (r: unknown) =>
  "Reading the evidence: the reference is warmer and about half a stop brighter, keyed from the " +
  "left. Here is the recipe:\n\n```json\n" + JSON.stringify(r) + "\n```\n\nThat should close most of the gap.";

function makeRequest(headerKey = "oc_test_key") {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", "x-omega-key": headerKey },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      system: "sys",
      userContent: [{ type: "text", text: "u" }],
      tool: { name: "emit_recipe" },
      mode: "recipe",
      target: "vray7max",
    }),
  });
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("REAL POST handler on realistic (tool_use-less) gateway replies", () => {
  it("bare JSON in a text block parses, validates, clamps, and returns the cleaned recipe", async () => {
    globalThis.fetch = vi.fn(async () => textReply(asBareJson(REALISTIC_RECIPE))) as typeof fetch;
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.recipe.values.length).toBe(8);
    // out-of-range turbidity (35) clamped to the pack ceiling (20) with the flag
    const turb = body.recipe.values.find((v: { param: string }) => v.param === "sun.turbidity");
    expect(turb.set).toBe(20);
    expect(turb.clamped).toBe(true);
    // placement strings pass through untouched
    const az = body.recipe.values.find((v: { param: string }) => v.param === "sun.placement_azimuth");
    expect(typeof az.set).toBe("string");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("JSON inside a ```json fence is extracted end-to-end", async () => {
    globalThis.fetch = vi.fn(async () => textReply(asFenced(REALISTIC_RECIPE))) as typeof fetch;
    const body = await (await POST(makeRequest())).json();
    expect(body.ok).toBe(true);
    expect(body.recipe.values.length).toBe(8);
  });

  it("prose + a fence (the common real shape) still yields the recipe", async () => {
    globalThis.fetch = vi.fn(async () => textReply(asProseThenFence(REALISTIC_RECIPE))) as typeof fetch;
    const body = await (await POST(makeRequest())).json();
    expect(body.ok).toBe(true);
    expect(body.recipe.hdri_mood).toContain("golden hour");
  });

  it("a first reply with NO parseable JSON (pure prose) triggers ONE re-send, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textReply("I need to think about the sun angle before emitting anything."))
      .mockResolvedValueOnce(textReply(asBareJson(REALISTIC_RECIPE)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const body = await (await POST(makeRequest())).json();
    expect(body.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // shape miss -> fresh re-send
  });

  it("a truncated first reply (stop_reason length, cut-off JSON) re-sends then succeeds", async () => {
    const cutOff = '{"baseline":"factory_defaults","values":[{"param":"sun.turbidity","set":8';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textReply(cutOff, "length")) // omega relays OpenAI-style "length"
      .mockResolvedValueOnce(textReply(asBareJson(REALISTIC_RECIPE)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const body = await (await POST(makeRequest())).json();
    expect(body.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("an invalid recipe (unknown param) in a text block re-asks with the errors, then succeeds", async () => {
    const bad = { ...REALISTIC_RECIPE, values: [{ param: "not.a.real.param", set: 5, from: 0, step: 2, confidence: "high", why: "x" }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textReply(asBareJson(bad)))
      .mockResolvedValueOnce(textReply(asBareJson(REALISTIC_RECIPE)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const body = await (await POST(makeRequest())).json();
    expect(body.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // the re-ask turn must carry the validation errors as a plain user text turn (no
    // tool_use_id exists to answer, since the gateway never sent a tool_use)
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body);
    const text = JSON.stringify(secondBody.messages);
    expect(text).toContain("invalid");
  });

  it("twice-unparseable replies surface a typed shape error (does not hang or throw)", async () => {
    globalThis.fetch = vi.fn(async () => textReply("still just thinking out loud, no json")) as typeof fetch;
    const body = await (await POST(makeRequest())).json();
    expect(body.ok).toBe(false);
    expect(body.error.kind).toBe("shape");
  });

  it("a correction-mode reply (moves[]) flows through the same realistic text path", async () => {
    const correction = {
      moves: [{ param: "sun.intensity_mult", to: 1.1, from: 1.0, step: 2, confidence: "high", why: "small level trim" }],
      rationale: "trim", status: "continue", status_reason: "close", applied_assumed: false,
    };
    const req = new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", "x-omega-key": "oc_test" },
      body: JSON.stringify({
        model: "claude-opus-4-8", system: "sys",
        userContent: [{ type: "text", text: "u" }],
        tool: { name: "emit_correction" }, mode: "correction", target: "vray7max",
      }),
    });
    globalThis.fetch = vi.fn(async () => textReply(asProseThenFence(correction))) as typeof fetch;
    const body = await (await POST(req)).json();
    expect(body.ok).toBe(true);
    expect(body.recipe.moves[0].param).toBe("sun.intensity_mult");
  });
});
