// LightMatch "how do I do this?" per-move help — a small server proxy to the omega
// gateway, separate from /api/analyze. Given ONE recipe control (its renderer UI path,
// target value, and pack description) plus a short conversation, it asks the model for
// exact, click-by-click UI steps to set that control in V-Ray 7 / Chaos Vantage 3.3.
//
// Same omega hard-won lessons as /api/analyze: NO tools/tool_choice (the gateway 500s on
// them), non-streaming, key in the x-omega-key header (or OMEGA_API_KEY), and the answer
// text is parsed out of the response's TEXT blocks (thinking blocks are ignored).

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATEWAY_URL = "https://omega.kesarcloud.in/v1/messages";
const TIMEOUT_MS = 60000;
const BACKOFF_MS = [1500, 5000] as const;

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
}
interface HowControl {
  name?: string;
  path?: string; // the renderer UI breadcrumb
  value?: string | number;
  from?: string | number;
  unit?: string;
  kind?: string;
  description?: string;
}
interface HowMessage {
  role: "user" | "assistant";
  content: string;
}
interface HowBody {
  model?: string;
  target?: string;
  control?: HowControl;
  messages?: HowMessage[];
}

function rendererLabel(target: string | undefined): string {
  return target === "vantage33" ? "Chaos Vantage 3.3" : "V-Ray 7 (3ds Max, VFB + Render Setup)";
}

// -- Build the system prompt: a renderer operator giving exact UI steps for ONE control.
function buildSystem(target: string | undefined, c: HowControl): string {
  const r = rendererLabel(target);
  const loc = c.path ? ` It lives at: ${c.path}.` : "";
  const val =
    c.value !== undefined && c.value !== null && c.value !== ""
      ? ` Target value: ${c.value}${c.unit ? " " + c.unit : ""}${c.from !== undefined && c.from !== "" ? ` (from ${c.from})` : ""}.`
      : "";
  const desc = c.description ? ` Reference note on this control: ${c.description}` : "";
  return (
    `You are an expert operator of ${r}, sitting next to a user who is applying a lighting-match recipe. ` +
    `They need to perform ONE control change and want to know EXACTLY how, in the UI. ` +
    `The control is "${c.name || "this setting"}".${loc}${val}${desc}\n\n` +
    `Answer with precise, numbered, click-by-click steps: name the exact tab / rollout / panel / field, ` +
    `what to click, and what to type. Be concise and concrete — no preamble, no theory unless asked. If the ` +
    `user asks a follow-up ("I can't find it", "will this change my exposure?"), answer in THIS control's ` +
    `context only. Reason briefly; output the steps directly as plain text (short numbered list). Do not use ` +
    `markdown headings or code fences.`
  );
}

function extractText(json: { content?: ContentBlock[] } | undefined): string {
  const c = json && Array.isArray(json.content) ? json.content : [];
  const text = c
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
  return text;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request): Promise<Response> {
  const key = request.headers.get("x-omega-key") || process.env.OMEGA_API_KEY || "";
  if (!key) {
    return NextResponse.json({ ok: false, error: "No API key: set it in the header at the top of the page." }, { status: 200 });
  }

  let body: HowBody;
  try {
    body = (await request.json()) as HowBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body was not valid JSON." }, { status: 200 });
  }
  const { model, target, control, messages } = body || {};
  if (!model || !control || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ ok: false, error: "Missing model, control, or messages." }, { status: 200 });
  }

  const requestBody = {
    model,
    max_tokens: 1400,
    stream: false,
    system: buildSystem(target, control),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
        return NextResponse.json({ ok: false, error: "Gateway returned 401 — the API key is missing or invalid." }, { status: 200 });
      }
      if (res.ok) {
        // Body read stays under the LIVE abort signal — clearTimeout happens in the
        // finally below, AFTER res.json()/res.text() complete — so a gateway that
        // returns headers then stalls the body is still bounded by TIMEOUT_MS.
        // Same pattern as /api/analyze's send() (stress finding C13).
        const json = await res.json().catch(() => null);
        const answer = extractText(json as { content?: ContentBlock[] } | undefined);
        if (answer) return NextResponse.json({ ok: true, answer });
        lastErr = "The model returned no steps — try asking again.";
      } else if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        lastErr = `Gateway returned HTTP ${res.status}`;
      } else {
        const bodyText = await res.text().catch(() => "");
        return NextResponse.json({ ok: false, error: `Gateway request failed: HTTP ${res.status}${bodyText ? " — " + bodyText.slice(0, 200) : ""}` }, { status: 200 });
      }
    } catch (e) {
      lastErr = (e as Error)?.name === "AbortError" ? `Request timed out after ${TIMEOUT_MS}ms` : ((e as Error)?.message || "network error");
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
