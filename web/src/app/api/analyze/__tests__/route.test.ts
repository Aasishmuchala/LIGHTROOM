// API route tests — the pure resilience pieces (classifier, backoff constants, re-ask
// turn shape, tool-input extraction) plus the POST handler's re-ask flow with a MOCKED
// fetch (never the network). Runs in the node environment; no browser globals needed.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  classify,
  BACKOFF_MS,
  TIMEOUT_MS,
  buildReaskTurns,
  extractToolInput,
  parseJsonFromText,
  POST,
  type ContentBlock,
} from "@/app/api/analyze/route";

describe("classify(status)", () => {
  it("429 and 5xx are retryable", () => {
    expect(classify(429)).toBe("retry");
    expect(classify(500)).toBe("retry");
    expect(classify(503)).toBe("retry");
    expect(classify(599)).toBe("retry");
  });
  it("401 is auth (no retry)", () => {
    expect(classify(401)).toBe("auth");
  });
  it("other 4xx are fatal", () => {
    expect(classify(400)).toBe("fatal");
    expect(classify(403)).toBe("fatal");
    expect(classify(404)).toBe("fatal");
  });
});

describe("backoff / timeout constants", () => {
  it("BACKOFF_MS is exactly [2000, 6000, 15000] (3 retry attempts)", () => {
    expect([...BACKOFF_MS]).toEqual([2000, 6000, 15000]);
  });
  it("TIMEOUT_MS is a positive number", () => {
    expect(TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("buildReaskTurns", () => {
  it("tool_use first-response -> assistant echo + a user tool_result with the MATCHING tool_use_id", () => {
    const first = {
      content: [
        { type: "text", text: "thinking" },
        { type: "tool_use", id: "toolu_123", name: "emit_recipe", input: { bad: true } },
      ] as ContentBlock[],
    };
    const [assistantTurn, userTurn] = buildReaskTurns(first, ['unknown param "x"']);

    // assistant turn echoes the model's own content verbatim (wire requirement).
    expect(assistantTurn.role).toBe("assistant");
    expect(assistantTurn.content).toBe(first.content);

    // user turn is a single tool_result naming the errors, with the matching id.
    expect(userTurn.role).toBe("user");
    expect(userTurn.content).toHaveLength(1);
    const tr = userTurn.content[0] as {
      type: string;
      tool_use_id: string;
      is_error: boolean;
      content: string;
    };
    expect(tr.type).toBe("tool_result");
    expect(tr.tool_use_id).toBe("toolu_123"); // <-- matches the tool_use id
    expect(tr.is_error).toBe(true);
    // The errors array is JSON-stringified into the message (quotes escaped).
    expect(tr.content).toContain("unknown param");
    expect(tr.content).toContain("Re-emit the full corrected tool call");
  });

  it("TEXT first-response -> assistant echo + a PLAIN user text turn (no tool_result)", () => {
    const first = {
      content: [{ type: "text", text: "Looking at the evidence... {\"values\":[]}" }] as ContentBlock[],
    };
    const [assistantTurn, userTurn] = buildReaskTurns(first, ['"values" is absent or empty']);

    expect(assistantTurn.role).toBe("assistant");
    expect(assistantTurn.content).toBe(first.content);

    expect(userTurn.role).toBe("user");
    expect(userTurn.content).toHaveLength(1);
    const blk = userTurn.content[0] as { type: string; text?: string; tool_use_id?: string };
    // It is a plain text block — NOT a tool_result (there is no tool_use_id to answer).
    expect(blk.type).toBe("text");
    expect(blk).not.toHaveProperty("tool_use_id");
    expect(userTurn.content.some((b) => (b as { type: string }).type === "tool_result")).toBe(false);
    // Carries the errors + the "only JSON" instruction.
    expect(blk.text).toContain("values");
    expect(blk.text).toMatch(/ONLY the corrected JSON object/);
    expect(blk.text).toMatch(/no prose/i);
  });
});

describe("parseJsonFromText", () => {
  it("parses a bare {...} object", () => {
    expect(parseJsonFromText('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });
  it("parses JSON inside a ```json fence", () => {
    const t = "```json\n{\"a\":1}\n```";
    expect(parseJsonFromText(t)).toEqual({ a: 1 });
  });
  it("parses JSON inside a plain ``` fence", () => {
    const t = "```\n{\"a\":2}\n```";
    expect(parseJsonFromText(t)).toEqual({ a: 2 });
  });
  it("parses JSON that follows prose", () => {
    const t = "Looking at the evidence and the measurements... \n```\n{\"a\":3,\"nested\":{\"k\":\"v\"}}\n```";
    expect(parseJsonFromText(t)).toEqual({ a: 3, nested: { k: "v" } });
  });
  it("is not thrown off by braces INSIDE a JSON string literal", () => {
    const t = 'prose {"why":"push { and } around","set":2}';
    expect(parseJsonFromText(t)).toEqual({ why: "push { and } around", set: 2 });
  });
  it("returns the truncation signal for an unterminated {...", () => {
    const t = 'Looking... {"values":[{"param":"sun.elevation","set":8,"from":45';
    const r = parseJsonFromText(t);
    expect(r).toEqual({ __truncated: true });
  });
  it("returns null for text with no JSON object", () => {
    expect(parseJsonFromText("no json here at all")).toBeNull();
    expect(parseJsonFromText("")).toBeNull();
  });
});

describe("extractToolInput", () => {
  it("returns the tool_use input on a well-formed response", () => {
    const res = extractToolInput({
      content: [{ type: "tool_use", id: "t", name: "emit_recipe", input: { a: 1 } } as ContentBlock],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.input).toEqual({ a: 1 });
  });
  it("flags a max_tokens truncation as kind:truncated", () => {
    const res = extractToolInput({ stop_reason: "max_tokens", content: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("truncated");
  });
  it("TEXT block with fenced JSON after prose -> ok:true with the parsed object", () => {
    const res = extractToolInput({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Looking at the evidence... \n```\n{\"baseline\":\"factory_defaults\",\"values\":[]}\n```",
        } as ContentBlock,
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.input).toEqual({ baseline: "factory_defaults", values: [] });
  });
  it("TEXT block with a cut-off JSON object -> kind:truncated", () => {
    const res = extractToolInput({
      stop_reason: "end_turn",
      content: [
        { type: "text", text: 'Looking... {"values":[{"param":"sun.elevation","set":8' } as ContentBlock,
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("truncated");
  });
  it("flags a text response carrying NO JSON as kind:shape", () => {
    const res = extractToolInput({ content: [{ type: "text", text: "hi, no json here" } as ContentBlock] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("shape");
  });
});

// -- helpers to build a valid recipe/correction gateway response ----------------------
function gatewayRecipe(input: unknown, id = "toolu_1") {
  return {
    ok: true,
    json: async () => ({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id, name: "emit_recipe", input }],
    }),
    text: async () => "",
    status: 200,
  } as unknown as Response;
}

const VALID_RECIPE_INPUT = {
  baseline: "factory_defaults",
  hdri_mood: "noon",
  values: [
    { param: "sun.intensity_mult", set: 1.2, from: 1.0, step: 2, confidence: "high", why: "w" },
  ],
  rationale: "r",
  gi_notes: "g",
  status: "continue",
};

function makeRequest(headerKey?: string) {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headerKey ? { "x-omega-key": headerKey } : {}),
    },
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

describe("POST handler (mocked fetch)", () => {
  it("returns ok:true with the cleaned recipe on a first-try valid emit", async () => {
    globalThis.fetch = vi.fn(async () => gatewayRecipe(VALID_RECIPE_INPUT)) as typeof fetch;
    const res = await POST(makeRequest("sk-test"));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.recipe.values[0].param).toBe("sun.intensity_mult");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("re-asks ONCE when the first emit is invalid, then succeeds — and the 2nd request carries a tool_result", async () => {
    const invalid = { ...VALID_RECIPE_INPUT, values: [{ ...VALID_RECIPE_INPUT.values[0], param: "not.a.real.param" }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gatewayRecipe(invalid, "toolu_A"))
      .mockResolvedValueOnce(gatewayRecipe(VALID_RECIPE_INPUT, "toolu_B"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await POST(makeRequest("sk-test"));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The SECOND request body must include the assistant tool_use echo + a user
    // tool_result whose tool_use_id matches the first response's tool_use id.
    const secondInit = fetchMock.mock.calls[1][1] as { body: string };
    const sentBody = JSON.parse(secondInit.body);
    const msgs = sentBody.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    const toolResult = msgs
      .flatMap((m) => m.content)
      .find((b) => b.type === "tool_result") as { tool_use_id: string; is_error: boolean } | undefined;
    expect(toolResult).toBeTruthy();
    expect(toolResult?.tool_use_id).toBe("toolu_A");
    expect(toolResult?.is_error).toBe(true);
  });

  it("returns kind:auth on a 401 (no retry)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "unauthorized",
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const res = await POST(makeRequest("sk-bad"));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.kind).toBe("auth");
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry on auth
  });

  it("returns kind:auth when no key is provided (header absent, env unset)", async () => {
    const prev = process.env.OMEGA_API_KEY;
    delete process.env.OMEGA_API_KEY;
    globalThis.fetch = vi.fn(async () => gatewayRecipe(VALID_RECIPE_INPUT)) as typeof fetch;
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.kind).toBe("auth");
    expect(globalThis.fetch).not.toHaveBeenCalled(); // rejected before any gateway call
    if (prev !== undefined) process.env.OMEGA_API_KEY = prev;
  });

  it("never leaks the key in the response body", async () => {
    globalThis.fetch = vi.fn(async () => gatewayRecipe(VALID_RECIPE_INPUT)) as typeof fetch;
    const res = await POST(makeRequest("sk-super-secret-123"));
    const text = await res.text();
    expect(text).not.toContain("sk-super-secret-123");
  });

  it("sends max_tokens 8192 in the request body", async () => {
    const fetchMock = vi.fn(async () => gatewayRecipe(VALID_RECIPE_INPUT)) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    await POST(makeRequest("sk-test"));
    const init = (fetchMock as unknown as { mock: { calls: [string, { body: string }][] } }).mock
      .calls[0][1];
    const sent = JSON.parse(init.body);
    expect(sent.max_tokens).toBe(8192);
  });

  it("TEXT gateway path: prose + fenced JSON (no tool_use) is parsed to ok:true", async () => {
    // The exact captured omega shape: a text block with prose then the recipe JSON in a
    // markdown fence, and NO tool_use block — the bug this fix targets.
    const textResponse = {
      ok: true,
      json: async () => ({
        model: "claude-opus-4-8",
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text:
              "Looking at the evidence, the reference is warmer and lower-key.\n\n```json\n" +
              JSON.stringify(VALID_RECIPE_INPUT) +
              "\n```",
          },
        ],
      }),
      text: async () => "",
      status: 200,
    } as unknown as Response;
    globalThis.fetch = vi.fn(async () => textResponse) as typeof fetch;

    const res = await POST(makeRequest("sk-test"));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.recipe.values[0].param).toBe("sun.intensity_mult");
  });

  it("TEXT gateway path that is TRUNCATED (cut-off JSON) returns kind:truncated", async () => {
    const cutOff = {
      ok: true,
      json: async () => ({
        model: "claude-opus-4-8",
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text:
              "Looking at the evidence...\n```json\n{\"baseline\":\"factory_defaults\",\"values\":[{\"param\":\"sun.intensity_mult\",\"set\":1.2,\"from\":1.0",
          },
        ],
      }),
      text: async () => "",
      status: 200,
    } as unknown as Response;
    globalThis.fetch = vi.fn(async () => cutOff) as typeof fetch;

    const res = await POST(makeRequest("sk-test"));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.kind).toBe("truncated");
  });
});
