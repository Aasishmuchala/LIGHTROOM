// LightMatch server proxy to the omega gateway — the server-side port of the vanilla
// ADAPTER.call(). Moving the gateway call to the Next.js server means:
//   - NO CORS: the browser talks only to same-origin /api/analyze; the cross-origin
//     hop to omega.kesarcloud.in happens server-to-server.
//   - The API key NEVER appears in the client's network log or in any response body —
//     it arrives in the x-omega-key request header (preferred) or is read from the
//     server-only OMEGA_API_KEY env var, is used solely as the Bearer to the gateway,
//     and is never echoed back.
//
// Ported ADAPTER resilience (identical contract to the vanilla source):
//   - per-attempt AbortController TIMEOUT that spans headers AND the body read
//   - 3 retries on 429 / 5xx / network / timeout with 2s / 6s / 15s backoff
//   - 401 -> auth error, no retry
//   - stop_reason === "max_tokens" -> truncated error
//   - tool_use block present -> return its .input
//   - NO tool_use block (the omega gateway ignores the forced tool_choice and answers
//     with the recipe JSON inside a text block, often after prose + a markdown fence) ->
//     parse the outermost JSON object out of the concatenated text: a good parse is the
//     input, a `{` that never closes is a truncation, no `{` at all is a shape error.
//   - the schema re-ask: validate the input server-side with validateRecipe; on failure
//     re-send ONCE. The re-ask turn branches on the first response: a real tool_use is
//     answered with a wire-valid assistant tool_use -> user tool_result pair; a text-only
//     response is answered with the assistant text turn + a plain user text turn (no
//     tool_result, since there is no tool_use_id to answer). Then re-validate.
//
// The pure pieces (classify, BACKOFF_MS, buildReaskTurns, extractToolInput) are
// exported so the route test can assert them with a mocked fetch, never the network.

import { NextResponse } from "next/server";
import { validateRecipe } from "@/lib/schemas";
import type { ModeName, TargetId } from "@/lib/types";

// This route performs a live network request at request time — never prerender it.
export const dynamic = "force-dynamic";

const GATEWAY_URL = "https://omega.kesarcloud.in/v1/messages";

// -- backoff schedule: a CONSTANT (not a function of attempt number) so it is directly
// assertable in a test without calling fetch. 3 entries = 3 retry attempts after the
// first try (2s / 6s / 15s). -------------------------------------------------------
export const BACKOFF_MS = [2000, 6000, 15000] as const;

// -- per-attempt fetch timeout (ms). A gateway that accepts the socket but never
// responds would otherwise wedge `await fetch` forever and the retry loop would never
// fire. An abort is treated exactly like a network reject (retryable). -------------
export const TIMEOUT_MS = 120000;

export type RetryAction = "retry" | "auth" | "fatal";

// -- classify(status): pure. Maps an HTTP status to a retry-loop action.
//   "retry" — 429 or any 5xx: try again with backoff.
//   "auth"  — 401: key wrong/expired; no retry.
//   "fatal" — everything else (400/403/404/...): surface, do not retry.
// Network errors (fetch rejects, no status) are classified as "retry" by the caller
// directly, since there is no status code to pass here. ----------------------------
export function classify(status: number): RetryAction {
  if (status === 429) return "retry";
  if (status >= 500 && status <= 599) return "retry";
  if (status === 401) return "auth";
  return "fatal";
}

export type ContentBlock = Record<string, unknown> & { type: string };
export interface GatewayMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

// -- buildReaskTurns(firstResponse, errors): the wire-valid re-ask turns. Branches on
// whether the first response actually used the tool:
//   • tool_use path — on the Anthropic Messages wire an assistant tool_use turn MUST be
//     answered by a user turn whose content holds a tool_result block with the MATCHING
//     tool_use_id — a bare text turn is a 400 ("tool_use ids were found without
//     tool_result blocks"). Append the assistant echo + a user tool_result (is_error).
//   • text path — the omega gateway ignored the forced tool_choice and answered with a
//     plain text block (no tool_use). There is NO tool_use_id to answer, so a tool_result
//     turn would itself be wire-invalid ("unexpected tool_result"). Instead append the
//     assistant's text turn followed by a PLAIN USER TEXT turn carrying the errors and the
//     "only JSON" instruction.
// Pure — the route test asserts each branch's shape.
export function buildReaskTurns(
  firstResponse: { content: ContentBlock[] },
  errors: string[]
): [GatewayMessage, GatewayMessage] {
  const content = firstResponse.content || [];
  const toolUse = content.find((b) => b.type === "tool_use") as { id?: string } | undefined;
  const assistantTurn: GatewayMessage = {
    role: "assistant",
    content: firstResponse.content,
  };

  if (toolUse) {
    const userTurn: GatewayMessage = {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: `Your emit was invalid: ${JSON.stringify(errors)}. Re-emit the full corrected tool call.`,
        },
      ],
    };
    return [assistantTurn, userTurn];
  }

  // Text path: no tool_use to answer — send a plain user text turn instead.
  const userTurn: GatewayMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text:
          `Your JSON was invalid: ${JSON.stringify(errors)}. ` +
          "Re-emit ONLY the corrected JSON object — no prose, no markdown, no code fences, nothing else. " +
          "Your entire reply must be a single valid JSON object beginning with `{` and ending with `}`.",
      },
    ],
  };
  return [assistantTurn, userTurn];
}

// -- typed extraction result: either the tool input, or a typed error to return. ----
export type ExtractResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; kind: "truncated" | "shape"; message: string; raw: string };

// -- stripCodeFences(text): pure. Remove markdown code fences so the JSON body inside a
// ```json … ``` or bare ``` … ``` block is exposed to the brace scan. We do NOT require a
// closing fence (a truncated response may open ```json and never close it), so this only
// strips fence MARKER lines wherever they appear and returns the remaining text. -------
function stripCodeFences(text: string): string {
  // Drop any line that is just a fence marker: ``` optionally followed by a language tag
  // (```json, ```JSON, ``` ). Keeps every other line verbatim.
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*```[a-zA-Z0-9_-]*\s*$/.test(line))
    .join("\n");
}

// -- parseJsonFromText(text): pure, defensive, NEVER throws. Finds the outermost balanced
// { … } object in free text (prose + optional markdown fences) and JSON.parses it.
//   - returns the parsed object on success,
//   - returns { __truncated: true } when there IS an opening `{` but no balanced close
//     parses (a cut-off / incomplete JSON — a truncation, not a shape error),
//   - returns null when there is no JSON object at all.
// The brace scan tracks string state and backslash escapes so a `{` or `}` inside a JSON
// string literal does not throw the depth count off.
export type JsonFromText = Record<string, unknown> | { __truncated: true } | null;
export function parseJsonFromText(text: string): JsonFromText {
  if (typeof text !== "string" || text.length === 0) return null;
  const body = stripCodeFences(text);
  const start = body.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // Found the matching close for the outermost object — parse just that slice.
        const candidate = body.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
          // A balanced {…} that parsed to a non-object (shouldn't happen for `{`), or the
          // slice was somehow not an object: treat as no-JSON so the caller reports shape.
          return null;
        } catch {
          // Balanced braces but not valid JSON (e.g. contains an unclosed string that the
          // depth scan walked past): treat as truncated/incomplete rather than shape.
          return { __truncated: true };
        }
      }
    }
  }
  // Opened a `{` (possibly inside an unterminated string) but never balanced it: truncated.
  return { __truncated: true };
}

// -- extractToolInput(json): pure. Truncation guard (stop_reason === "max_tokens")
// first — a response cut at the token cap carries a half-written tool_use whose JSON is
// structurally incomplete, so surface it as truncated (with the raw body) rather than
// letting a partial recipe reach validation. Then, if there IS a tool_use block, return
// its .input. Otherwise fall back to the TEXT path: the omega gateway ignores the forced
// tool_choice and returns the recipe as JSON inside a text block (often after prose and a
// markdown fence), so concatenate all text blocks and extract the JSON object from them.
export function extractToolInput(json: {
  stop_reason?: string;
  content?: ContentBlock[];
}): ExtractResult {
  if (json && json.stop_reason === "max_tokens") {
    return {
      ok: false,
      kind: "truncated",
      message: "response truncated at max_tokens",
      raw: JSON.stringify(json),
    };
  }
  const block = Array.isArray(json.content)
    ? json.content.find((b) => b.type === "tool_use")
    : null;
  if (block) {
    return { ok: true, input: (block as unknown as { input: Record<string, unknown> }).input };
  }

  // No tool_use block — fall back to parsing JSON out of the text block(s).
  const text = Array.isArray(json.content)
    ? json.content
        .filter((b) => b.type === "text" && typeof (b as { text?: unknown }).text === "string")
        .map((b) => (b as unknown as { text: string }).text)
        .join("\n")
    : "";
  const parsed = parseJsonFromText(text);
  if (parsed && !("__truncated" in parsed)) {
    return { ok: true, input: parsed };
  }
  if (parsed && "__truncated" in parsed) {
    // A `{` was present but the JSON did not close/parse — the model's JSON was cut off.
    return {
      ok: false,
      kind: "truncated",
      message: "response text carried an incomplete (truncated) JSON object",
      raw: JSON.stringify(json),
    };
  }
  return {
    ok: false,
    kind: "shape",
    message: "Response contained no tool_use block and no JSON object in its text.",
    raw: JSON.stringify(json),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SendResult {
  json?: { stop_reason?: string; content?: ContentBlock[] };
  authError?: boolean;
  fatal?: string; // message
}

// -- one full send-with-retries against the gateway. Bounded by TIMEOUT_MS per attempt
// (spanning headers AND body read via a single AbortController). Returns a typed
// SendResult rather than throwing, so the caller can shape the JSON error response. --
async function send(
  key: string,
  requestBody: unknown,
  fetchImpl: typeof fetch
): Promise<SendResult> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < BACKOFF_MS.length + 1; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let outcome: SendResult & { retry?: boolean } = {};
    try {
      const res = await fetchImpl(GATEWAY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(requestBody),
        signal: ac.signal,
      });
      if (res.ok) {
        // Body read stays INSIDE the try, still under the live abort signal, so a
        // stalled body aborts here and falls into the network-retry catch below.
        const json = await res.json();
        outcome = { json };
      } else {
        const action = classify(res.status);
        if (action === "auth") {
          outcome = { authError: true };
        } else if (action === "retry") {
          outcome = { retry: true };
          lastErr = new Error(`Gateway returned HTTP ${res.status}`);
        } else {
          const bodyText = await res.text().catch(() => "");
          outcome = {
            fatal: `Gateway request failed: HTTP ${res.status}${bodyText ? " — " + bodyText : ""}`,
          };
        }
      }
    } catch (networkErr) {
      // fetch rejected (offline, DNS) OR our TIMEOUT_MS abort fired during the header
      // wait or body read — all the "network" retry case, no status to classify.
      outcome = { retry: true };
      lastErr = networkErr as Error;
    } finally {
      clearTimeout(t);
    }

    if (outcome.json !== undefined) return { json: outcome.json };
    if (outcome.authError) return { authError: true };
    if (outcome.fatal) return { fatal: outcome.fatal };
    // retry
    if (attempt < BACKOFF_MS.length) {
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }
    return { fatal: (lastErr && lastErr.message) || "Gateway request failed after retries." };
  }
  return { fatal: (lastErr && lastErr.message) || "Gateway request failed after retries." };
}

export interface AnalyzeRequestBody {
  model: string;
  system: string;
  userContent: ContentBlock[];
  tool: { name: string };
  mode: ModeName | string;
  target: TargetId | string;
}

// -- errorResponse(kind, message, raw?): the single typed-error JSON shape the client
// adapter expects. Never carries the key. -----------------------------------------
function errorResponse(
  kind: "auth" | "shape" | "network" | "truncated" | "invalid" | "other",
  message: string,
  raw?: string,
  status = 200
) {
  return NextResponse.json({ ok: false, error: { kind, message, raw } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  // Key from the request header (preferred) OR the server-only env var. Never logged,
  // never returned in any response.
  const headerKey = request.headers.get("x-omega-key") || "";
  const key = headerKey || process.env.OMEGA_API_KEY || "";
  if (!key) {
    return errorResponse(
      "auth",
      "No API key: send it in the x-omega-key header or set OMEGA_API_KEY on the server."
    );
  }

  let body: AnalyzeRequestBody;
  try {
    body = (await request.json()) as AnalyzeRequestBody;
  } catch {
    return errorResponse("other", "Request body was not valid JSON.");
  }
  const { model, system, userContent, tool, mode, target } = body || {};
  if (!model || !system || !Array.isArray(userContent) || !tool || !tool.name || !target) {
    return errorResponse(
      "other",
      "Request is missing one of: model, system, userContent[], tool{name}, target."
    );
  }

  const validateMode: ModeName | undefined = mode === "correction" ? "correction" : undefined;
  const messages: GatewayMessage[] = [{ role: "user", content: userContent }];

  const makeRequestBody = (msgs: GatewayMessage[]) => ({
    model,
    // 8192 (raised from 4096): the omega gateway can ignore the forced tool_choice and
    // answer with prose + the recipe JSON in a text block; at 4096 the prose ate the
    // budget and the JSON truncated mid-object. Headroom keeps the JSON intact even when
    // the model insists on narrating first. The no-prose system directive is the primary
    // fix; this is the belt-and-braces backstop.
    max_tokens: 8192,
    stream: false,
    system,
    messages: msgs,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
  });

  // -- first send ------------------------------------------------------------------
  const first = await send(key, makeRequestBody(messages), fetch);
  if (first.authError) {
    return errorResponse("auth", "Gateway returned 401 — the API key is missing or invalid.");
  }
  if (first.fatal || !first.json) {
    return errorResponse("network", first.fatal || "Gateway request failed.");
  }
  const firstExtract = extractToolInput(first.json);
  if (!firstExtract.ok) {
    return errorResponse(firstExtract.kind, firstExtract.message, firstExtract.raw);
  }

  // -- server-side validation + one-shot re-ask ------------------------------------
  const firstResult = validateRecipe(firstExtract.input, target, validateMode);
  if (firstResult.ok) {
    return NextResponse.json({ ok: true, recipe: firstResult.cleaned });
  }

  // Re-ask ONCE with a wire-valid assistant tool_use -> user tool_result turn.
  const [assistantTurn, userTurn] = buildReaskTurns(
    first.json as { content: ContentBlock[] },
    firstResult.errors
  );
  messages.push(assistantTurn, userTurn);

  const second = await send(key, makeRequestBody(messages), fetch);
  if (second.authError) {
    return errorResponse("auth", "Gateway returned 401 — the API key is missing or invalid.");
  }
  if (second.fatal || !second.json) {
    return errorResponse("network", second.fatal || "Gateway request failed on re-ask.");
  }
  const secondExtract = extractToolInput(second.json);
  if (!secondExtract.ok) {
    return errorResponse(secondExtract.kind, secondExtract.message, secondExtract.raw);
  }
  const secondResult = validateRecipe(secondExtract.input, target, validateMode);
  if (!secondResult.ok) {
    return errorResponse(
      "invalid",
      `Gateway response failed validation twice: ${JSON.stringify(secondResult.errors)}`
    );
  }
  return NextResponse.json({ ok: true, recipe: secondResult.cleaned });
}
