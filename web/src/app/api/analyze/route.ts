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
//   - no tool_use block -> shape error carrying the raw response text
//   - stop_reason === "max_tokens" -> truncated error
//   - the schema re-ask: validate the tool input server-side with validateRecipe; on
//     failure re-send ONCE with a wire-valid assistant tool_use -> user tool_result
//     turn carrying the errors, then re-validate.
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

// -- buildReaskTurns(firstResponse, errors): the wire-valid re-ask turns. On the
// Anthropic Messages wire an assistant tool_use turn MUST be answered by a user turn
// whose content holds a tool_result block with the MATCHING tool_use_id — a bare text
// turn is a 400 ("tool_use ids were found without tool_result blocks"). Returns the
// two messages to append: the assistant turn (echoing the model's own content) and the
// user tool_result turn (is_error:true) naming the validation errors. Pure — the route
// test asserts the tool_result carries the same tool_use_id as the assistant tool_use.
export function buildReaskTurns(
  firstResponse: { content: ContentBlock[] },
  errors: string[]
): [GatewayMessage, GatewayMessage] {
  const toolUse = (firstResponse.content || []).find((b) => b.type === "tool_use") as
    | { id?: string }
    | undefined;
  const assistantTurn: GatewayMessage = {
    role: "assistant",
    content: firstResponse.content,
  };
  const userTurn: GatewayMessage = {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: toolUse?.id,
        is_error: true,
        content: `Your emit was invalid: ${JSON.stringify(errors)}. Re-emit the full corrected tool call.`,
      },
    ],
  };
  return [assistantTurn, userTurn];
}

// -- typed extraction result: either the tool input, or a typed error to return. ----
export type ExtractResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; kind: "truncated" | "shape"; message: string; raw: string };

// -- extractToolInput(json): pure. Truncation guard (stop_reason === "max_tokens")
// first — a response cut at the token cap carries a half-written tool_use whose JSON is
// structurally incomplete, so surface it as truncated (with the raw body) rather than
// letting a partial recipe reach validation. Then the no-tool_use guard -> shape. ---
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
  if (!block) {
    return {
      ok: false,
      kind: "shape",
      message: "Response contained no tool_use block.",
      raw: JSON.stringify(json),
    };
  }
  return { ok: true, input: (block as unknown as { input: Record<string, unknown> }).input };
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
    max_tokens: 4096,
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
