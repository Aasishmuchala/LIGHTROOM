// /api/how — POST handler tests with a MOCKED fetch (never the network), same idiom
// as /api/analyze's route.test.ts. Pins the C13 stress fix: the per-attempt abort
// timer must span the BODY read, not just the header wait — a gateway that returns
// 200 headers then stalls the body forever must still be bounded by TIMEOUT_MS
// (60s) instead of hanging the help request. Fake timers drive the 60s aborts and
// the 1.5s/5s retry backoffs without real waiting.

import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

const TIMEOUT_MS = 60000; // mirrors the route's const
const BACKOFF_MS = [1500, 5000]; // mirrors the route's const

function makeRequest(): Request {
  return new Request("http://localhost/api/how", {
    method: "POST",
    headers: { "content-type": "application/json", "x-omega-key": "oc_test" },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      target: "vray7max",
      control: { name: "Turbidity", path: "Environment > Sun > Turbidity", value: 3 },
      messages: [{ role: "user", content: "how do I set this?" }],
    }),
  });
}

// A gateway response whose HEADERS arrived but whose BODY never does: json()/text()
// settle only when the route's own abort signal fires — exactly the overloaded-proxy
// headers-then-stall failure mode the finding describes.
function stalledResponse(status: number, signal: AbortSignal) {
  const stall = () =>
    new Promise<never>((_, reject) => {
      const onAbort = () =>
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort);
    });
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => stall(),
    text: () => stall(),
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/how (mocked fetch)", () => {
  it("happy path: gateway text blocks come back as ok:true answer", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: "1. Open Render Setup." }] }),
    })) as unknown as typeof fetch;
    const body = (await (await POST(makeRequest())).json()) as { ok: boolean; answer?: string };
    expect(body.ok).toBe(true);
    expect(body.answer).toContain("Render Setup");
  });

  it("headers-then-stalled BODY is bounded by TIMEOUT_MS on every attempt (C13)", async () => {
    vi.useFakeTimers();
    // each attempt: fetch resolves headers instantly, then json() stalls until abort
    const fetchMock = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) =>
      stalledResponse(200, init!.signal!)
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let settled = false;
    const p = POST(makeRequest()).then((r) => {
      settled = true;
      return r;
    });
    // Walk all 3 attempts: abort at 60s each, plus the 1.5s/5s backoff sleeps. Before
    // the fix, clearTimeout ran right after the headers resolved, so no timer existed,
    // json() never settled, and `settled` stayed false forever (the hang).
    await vi.advanceTimersByTimeAsync(
      (BACKOFF_MS.length + 1) * TIMEOUT_MS + BACKOFF_MS[0] + BACKOFF_MS[1] + 1000
    );
    expect(settled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(BACKOFF_MS.length + 1); // it retried, never hung
    const body = (await (await p).json()) as { ok: boolean };
    expect(body.ok).toBe(false); // clean error envelope, not a stuck spinner
  });

  it("non-ok branch: a stalled error-body read is bounded too (fatal 400 settles at the deadline)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) =>
      stalledResponse(400, init!.signal!)
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let settled = false;
    const p = POST(makeRequest()).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1000);
    expect(settled).toBe(true); // res.text() was rescued by the still-armed abort timer
    expect(fetchMock).toHaveBeenCalledTimes(1); // 400 is fatal — no retry
    const body = (await (await p).json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("HTTP 400");
  });
});
