// LightMatch expert chat — the "operator line" server proxy to the omega gateway.
// The user talks to a lighting TD who knows V-Ray 7 (3ds Max) and Chaos Vantage 3.3
// in the app's own exact-control vocabulary, is aware of the live session (digest
// built client-side by lib/chat-digest.sessionDigest), and — when a turn carries a
// render check-in — reads the measured evidence and issues a confirm / re-edit
// verdict grounded in those numbers.
//
// Same omega hard-won lessons as /api/analyze and /api/how (verified live 2026-07-04):
//   - NO tools / tool_choice (the gateway 500s on them) — this endpoint is prose-only.
//   - non-streaming; the answer is parsed out of the response's TEXT blocks.
//   - key in the x-omega-key header (or server-only OMEGA_API_KEY); never echoed.
//   - vision does NOT survive the gpt-5.5 wire (500) — any request carrying an image
//     block is forced onto claude-opus-4-8.
//   - ~100s wall-clock ceiling — the system prompt carries the same brevity guard
//     that rescued /api/analyze.

import { NextResponse } from "next/server";
import { promptFragment } from "@/lib/packs";

export const dynamic = "force-dynamic";

const GATEWAY_URL = "https://omega.kesarcloud.in/v1/messages";
export const TIMEOUT_MS = 90000;
export const BACKOFF_MS = [1500, 5000] as const;
export const VISION_MODEL = "claude-opus-4-8";

// Wire caps — a hostile/buggy client must not be able to relay unbounded payloads.
export const MAX_MESSAGES = 24;
export const MAX_TEXT_CHARS = 16000;
export const MAX_DIGEST_CHARS = 8000;
export const MAX_IMAGES = 2;
export const MAX_IMAGE_B64_CHARS = 3_000_000; // ~2.2MB decoded — far above a downscaled JPEG

interface ContentBlock {
  type: string;
  text?: string;
}
export interface ChatWireImage {
  mediaType?: string;
  base64?: string;
}
export interface ChatWireMessage {
  role?: "user" | "assistant";
  content?: string;
  image?: ChatWireImage | null;
}
interface ChatBody {
  model?: string;
  target?: string;
  digest?: string;
  messages?: ChatWireMessage[];
}

function rendererLabel(target: string | undefined): string {
  return target === "vantage33" ? "Chaos Vantage 3.3" : "V-Ray 7 (3ds Max, VFB + Render Setup)";
}

// -- buildChatSystem(target, digest): the expert persona. Exported for tests. -------
export function buildChatSystem(target: string | undefined, digest: string): string {
  const r = rendererLabel(target);
  const lines: string[] = [];
  lines.push(
    "OUTPUT BUDGET — READ FIRST: you have a strict output budget. Reason very briefly and answer " +
      "directly; a complete, concrete answer matters more than thorough deliberation. Plain text only — " +
      "no markdown headings, no code fences. When you give steps or moves, use a short numbered list."
  );
  lines.push("");
  lines.push(
    `You are a senior lighting TD and renderer operator sitting next to the user, and you know ${r} ` +
      "inside out — every tab, rollout, and field. You are the expert line inside LightMatch, the app that " +
      "measures a reference image against the user's render and issues exact lighting recipes. The user may " +
      "ask you anything about lighting, rendering, or the app's recipe; answer as the operator, not a manual."
  );
  lines.push("");
  lines.push(
    "Control vocabulary discipline: when you tell the user to change a setting that exists in the pack " +
      "listing below, name it by its EXACT ui_path breadcrumb and keep every numeric value inside the stated " +
      "range. Never invent a control name. If the right fix lives outside the pack (materials, geometry, " +
      "post), say so explicitly and give the best real-world guidance for " + r + "."
  );
  lines.push("");
  lines.push(
    "RENDER CHECK-INS: when a user turn carries a render image plus a CHECK-IN EVIDENCE block, the evidence " +
      "is deterministic photometry — trust it for magnitude, your eyes for direction. Answer with the verdict " +
      "FIRST in one sentence: either the lighting is MATCHED (evidence says so — tell them to stop lighting " +
      "and move to color grading) or not yet, with the match percentage. Then, when not matched, give the " +
      "SHORTEST prioritized list of re-edits (2-5 numbered moves): exact control, current -> new value, and " +
      "one clause on why, biggest photometric gap first. Do not re-issue moves the digest marks as already " +
      "applied unless the evidence shows they under- or over-shot; in that case say by how much to trim. " +
      "Never contradict the measured numbers."
  );
  lines.push("");
  if (digest) {
    lines.push(digest);
    lines.push("");
  }
  lines.push("PACK LISTING — the exact controls the app can address:");
  lines.push(promptFragment(target === "vantage33" ? "vantage33" : "vray7max"));
  return lines.join("\n");
}

// -- sanitizeMessages(raw): enforce the wire caps; returns null on a shape violation.
export function sanitizeMessages(raw: unknown): ChatWireMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  let images = 0;
  const out: ChatWireMessage[] = [];
  for (const m of raw as ChatWireMessage[]) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    if (typeof m.content !== "string" || m.content.length > MAX_TEXT_CHARS) return null;
    let image: ChatWireImage | undefined;
    if (m.image != null) {
      if (typeof m.image !== "object") return null;
      const mt = m.image.mediaType;
      const b64 = m.image.base64;
      if (
        typeof mt !== "string" ||
        !/^image\/(png|jpeg|webp)$/.test(mt) ||
        typeof b64 !== "string" ||
        b64.length === 0 ||
        b64.length > MAX_IMAGE_B64_CHARS ||
        !/^[A-Za-z0-9+/=]+$/.test(b64)
      ) {
        return null;
      }
      images++;
      if (images > MAX_IMAGES) return null;
      image = { mediaType: mt, base64: b64 };
    }
    out.push({ role: m.role, content: m.content, ...(image ? { image } : {}) });
  }
  // The gateway requires the conversation to end on a user turn.
  if (out[out.length - 1].role !== "user") return null;
  return out;
}

function toGatewayMessages(messages: ChatWireMessage[]) {
  return messages.map((m) => {
    if (m.image) {
      return {
        role: m.role,
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: m.image.mediaType, data: m.image.base64 },
          },
          { type: "text", text: m.content },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

function extractText(json: { content?: ContentBlock[] } | undefined): string {
  const c = json && Array.isArray(json.content) ? json.content : [];
  return c
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request): Promise<Response> {
  const key = request.headers.get("x-omega-key") || process.env.OMEGA_API_KEY || "";
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "No API key yet — paste your oc_ key in the header, then ask again." },
      { status: 200 }
    );
  }

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body was not valid JSON." }, { status: 200 });
  }
  const { model, target } = body || {};
  const digest = typeof body?.digest === "string" ? body.digest.slice(0, MAX_DIGEST_CHARS) : "";
  const messages = sanitizeMessages(body?.messages);
  if (!model || typeof model !== "string" || !messages) {
    return NextResponse.json(
      { ok: false, error: "Missing or malformed model / messages." },
      { status: 200 }
    );
  }

  // Vision does not survive the gpt wire on omega (verified 2026-07-04: 500) — any
  // image-bearing conversation runs on Opus regardless of the picker.
  const hasImage = messages.some((m) => !!m.image);
  const wireModel = hasImage && !/^claude/.test(model) ? VISION_MODEL : model;

  const requestBody = {
    model: wireModel,
    max_tokens: 2500,
    stream: false,
    system: buildChatSystem(target, digest),
    messages: toGatewayMessages(messages),
  };

  let lastErr = "";
  for (let attempt = 0; attempt < BACKOFF_MS.length + 1; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(requestBody),
        signal: ac.signal,
      });
      if (res.status === 401) {
        return NextResponse.json(
          { ok: false, error: "Gateway returned 401 — the API key is missing or invalid." },
          { status: 200 }
        );
      }
      if (res.ok) {
        // Body read stays under the LIVE abort signal — clearTimeout happens in the
        // finally below, AFTER res.json()/res.text() complete — so a gateway that
        // returns headers then stalls the body is still bounded by TIMEOUT_MS.
        // Same pattern as /api/analyze's send() (stress finding C13).
        const json = await res.json().catch(() => null);
        const answer = extractText(json as { content?: ContentBlock[] } | undefined);
        if (answer) return NextResponse.json({ ok: true, answer, model: wireModel });
        lastErr = "The model returned no answer — try asking again.";
      } else if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        lastErr = `Gateway returned HTTP ${res.status}`;
      } else {
        const bodyText = await res.text().catch(() => "");
        return NextResponse.json(
          {
            ok: false,
            error: `Gateway request failed: HTTP ${res.status}${bodyText ? " — " + bodyText.slice(0, 200) : ""}`,
          },
          { status: 200 }
        );
      }
    } catch (e) {
      lastErr =
        (e as Error)?.name === "AbortError"
          ? `Request timed out after ${TIMEOUT_MS}ms`
          : (e as Error)?.message || "network error";
    } finally {
      clearTimeout(t);
    }
    if (attempt < BACKOFF_MS.length) {
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }
  }
  return NextResponse.json({ ok: false, error: lastErr || "Gateway request failed." }, { status: 200 });
}
