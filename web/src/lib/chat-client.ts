// Client shim for the expert chat. Mirrors how-client: reads the omega key + model
// out of STORE and POSTs SAME-ORIGIN to /api/chat (key in the x-omega-key header,
// never to the gateway from the browser). The route does the omega call + resilience;
// this marshals the wire shape and enforces client-side history hygiene:
//   - only the last WIRE_TURNS turns travel (the digest carries the older context);
//   - only the NEWEST image travels (older check-in renders stay local — the model
//     already answered about them, and the route caps image blocks anyway).

import { STORE } from "./store";

export const WIRE_TURNS = 12;

export interface ExpertMsg {
  role: "user" | "assistant";
  content: string;
  /** Present on render check-in turns: the downscaled dataUrl the engine measured. */
  imageDataUrl?: string;
}

export interface ExpertResult {
  ok: boolean;
  answer?: string;
  error?: string;
}

function splitDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return m ? { mediaType: m[1], base64: m[2] } : null;
}

// -- toWire(messages): last WIRE_TURNS turns, image only on the newest image-bearing
// turn. Pure; exported for tests. ---------------------------------------------------
export function toWire(messages: ExpertMsg[]): Array<{
  role: "user" | "assistant";
  content: string;
  image?: { mediaType: string; base64: string };
}> {
  const recent = messages.slice(-WIRE_TURNS);
  let newestImageIdx = -1;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].imageDataUrl) {
      newestImageIdx = i;
      break;
    }
  }
  return recent.map((m, i) => {
    const base = { role: m.role, content: m.content };
    if (i === newestImageIdx && m.imageDataUrl) {
      const img = splitDataUrl(m.imageDataUrl);
      if (img) return { ...base, image: img };
    }
    return base;
  });
}

// askExpert(target, digest, messages): send the conversation and return the model's
// next answer (or a human error string). Never throws — the caller renders `error`
// inline and offers retry.
export async function askExpert(
  target: string,
  digest: string,
  messages: ExpertMsg[],
  fetchImpl?: typeof fetch
): Promise<ExpertResult> {
  const doFetch = fetchImpl || fetch;
  const model = STORE.prefs().model || "claude-opus-4-8";
  const key = STORE.key();
  if (!key) {
    return {
      ok: false,
      error: "No API key yet — paste your omega key in the header, then ask again.",
    };
  }

  let res: Response;
  try {
    res = await doFetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-omega-key": key },
      body: JSON.stringify({ model, target, digest, messages: toWire(messages) }),
    });
  } catch (e) {
    return {
      ok: false,
      error: "Could not reach the expert endpoint: " + ((e as Error)?.message || String(e)),
    };
  }

  let body: { ok?: boolean; answer?: string; error?: string };
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Expert endpoint returned a non-JSON response (HTTP ${res.status}).` };
  }
  if (body && body.ok && typeof body.answer === "string" && body.answer.trim()) {
    return { ok: true, answer: body.answer };
  }
  return { ok: false, error: (body && body.error) || `Expert request failed (HTTP ${res.status}).` };
}

const chatClient = { askExpert, toWire, WIRE_TURNS };
export default chatClient;
