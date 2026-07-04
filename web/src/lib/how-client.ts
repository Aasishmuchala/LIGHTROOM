// Client shim for the per-move "how do I do this?" chat. Mirrors client-adapter's
// analyzeViaApi: reads the omega key + selected model out of STORE and POSTs SAME-ORIGIN
// to /api/how (key in the x-omega-key header, never to the gateway from the browser).
// The route does the omega call + resilience; this just marshals the request/response.

import { STORE } from "./store";

export interface HowControlContext {
  name: string;
  path: string;
  value: number | string;
  from?: number | string;
  unit?: string;
  kind?: string;
  description?: string;
}

export interface HowMsg {
  role: "user" | "assistant";
  content: string;
}

export interface HowResult {
  ok: boolean;
  answer?: string;
  error?: string;
}

// askHow(target, control, messages): send the conversation for ONE control and return
// the model's next answer (or a human error string). Never throws — the caller renders
// `error` inline and offers retry.
export async function askHow(
  target: string,
  control: HowControlContext,
  messages: HowMsg[],
  fetchImpl?: typeof fetch
): Promise<HowResult> {
  const doFetch = fetchImpl || fetch;
  const model = STORE.prefs().model || "claude-opus-4-8";
  const key = STORE.key();
  if (!key) {
    return { ok: false, error: "No API key yet — paste your omega key in the header, then ask again." };
  }

  let res: Response;
  try {
    res = await doFetch("/api/how", {
      method: "POST",
      headers: { "content-type": "application/json", "x-omega-key": key },
      body: JSON.stringify({ model, target, control, messages }),
    });
  } catch (e) {
    return { ok: false, error: "Could not reach the help endpoint: " + ((e as Error)?.message || String(e)) };
  }

  let body: { ok?: boolean; answer?: string; error?: string };
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Help endpoint returned a non-JSON response (HTTP ${res.status}).` };
  }
  if (body && body.ok && typeof body.answer === "string" && body.answer.trim()) {
    return { ok: true, answer: body.answer };
  }
  return { ok: false, error: (body && body.error) || `Help request failed (HTTP ${res.status}).` };
}

export default { askHow };
