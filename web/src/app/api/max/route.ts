// /api/max — the LightMatch server's hop to the 3ds Max listener (cl0nazepamm/
// 3dsmax-mcp). The BROWSER never talks to Max directly; it POSTs a whitelisted
// action here and this route builds, sends, and parses the MAXScript itself.
//
// SECURITY BOUNDARY: this route accepts NO raw script from the client — only
//   {action:"ping"} | {action:"pull"} | {action:"apply", target, values[]}
// Apply values are validated against the pack (lighting:true only, numbers clamped)
// BEFORE any script is generated, and script generation only emits properties from
// export.ts's verified KNOWN_PROPS map. Both Max transports are loopback-only
// (named pipe / 127.0.0.1:8765), matching the listener's own binding.

import { NextResponse } from "next/server";
import { createConnection, type Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  buildMaxRequest,
  parseMaxResponse,
  buildPullScript,
  mapPullResult,
  splitApplyValues,
  buildApplyScript,
  mapApplyResult,
  type ApplyValue,
  type MaxResponse,
} from "@/lib/max-bridge";
import { PACKS } from "@/lib/packs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TCP_HOST = "127.0.0.1";
const TCP_PORT = 8765;
const DEFAULT_PIPE = "\\\\.\\pipe\\3dsmax-mcp";
const PING_TIMEOUT_MS = 4_000;
const SCRIPT_TIMEOUT_MS = 30_000;
// A frame is a single tiny JSON line; ~1 MB is generous. Caps the socket accumulator so
// a hostile/buggy loopback listener that streams bytes with no '\n' cannot drive the Node
// process toward OOM before the timeout fires. Reject flows to the next transport / offline.
const MAX_RESP_BYTES = 1_000_000;
// Only KNOWN_PROPS pass the lighting gate, so there are at most ~15 distinct setters; the
// map de-dup already bounds distinct params, this caps the raw list a client may submit.
const MAX_APPLY_VALUES = 256;

// -- activeInstancePipe(): the claimed-instance pipe written by the in-Max MCP_Claim
// macro (%LOCALAPPDATA%\3dsmax-mcp\active_instance.json). Absent/garbled → null. ----
async function activeInstancePipe(): Promise<string | null> {
  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return null;
    const raw = await readFile(`${localAppData}\\3dsmax-mcp\\active_instance.json`, "utf-8");
    const parsed = JSON.parse(raw) as { pipe?: string };
    return typeof parsed.pipe === "string" && parsed.pipe.startsWith("\\\\.\\pipe\\")
      ? parsed.pipe
      : null;
  } catch {
    return null;
  }
}

// -- sendOnce(pathOrPort, request): one newline-framed round trip on a socket (named
// pipe when `path`, TCP otherwise). Resolves with the raw response line. Exported
// for the integration test (mock listener on an ephemeral TCP port), same pattern
// as the analyze route's pure exports. ----------------------------------------------
export function sendOnce(
  opts: { path?: string; host?: string; port?: number },
  request: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      fn();
    };
    // `wrote` — did we already put the request on the wire? Surfaced on every rejection
    // so sendToMax can refuse to retry a SCENE-MUTATING apply on the next transport once
    // it may already be executing in Max (apply is NOT idempotent: lmFirstOrCreate /
    // lmVRayLightOfType create nodes). A pure connect/refused failure keeps wrote=false.
    let wrote = false;
    const rejectWrote = (e: Error): Error => {
      (e as Error & { wrote?: boolean }).wrote = wrote;
      return e;
    };
    const socket: Socket = opts.path
      ? createConnection({ path: opts.path })
      : createConnection({ host: opts.host!, port: opts.port! });
    const timer = setTimeout(
      () => done(() => reject(rejectWrote(new Error(`3ds Max did not respond within ${timeoutMs}ms`)))),
      timeoutMs
    );
    let buf = "";
    socket.on("connect", () => {
      wrote = true;
      socket.write(request);
    });
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      // RESPONSE SIZE CAP: refuse an unbounded, newline-less stream before it exhausts memory.
      if (buf.length > MAX_RESP_BYTES) {
        done(() => reject(rejectWrote(new Error("response from 3ds Max exceeded size cap"))));
        return;
      }
      if (buf.includes("\n")) done(() => resolve(buf));
    });
    socket.on("end", () => {
      if (buf.length) done(() => resolve(buf));
      else done(() => reject(rejectWrote(new Error("connection closed before a response arrived"))));
    });
    socket.on("error", (e) => done(() => reject(rejectWrote(e))));
  });
}

// -- sendToMax(command, type): claimed pipe → default pipe → TCP, first transport
// that answers wins. Every hop is loopback-only. ------------------------------------
async function sendToMax(
  command: string,
  type: "maxscript" | "ping",
  timeoutMs: number,
  // NON-IDEMPOTENT guard: when true, do NOT fall through to the next transport once the
  // request has already been written — a half-answering apply could otherwise run twice
  // (double-create nodes). Only apply sets this; ping/pull are read-only and safe to retry.
  noRetryAfterWrite = false
): Promise<MaxResponse> {
  const requestId = randomUUID().replace(/-/g, "");
  const request = buildMaxRequest(command, type, requestId);
  const attempts: { path?: string; host?: string; port?: number }[] = [];
  const claimed = await activeInstancePipe();
  if (claimed) attempts.push({ path: claimed });
  attempts.push({ path: DEFAULT_PIPE });
  attempts.push({ host: TCP_HOST, port: TCP_PORT });

  let lastError: Error | null = null;
  for (const a of attempts) {
    try {
      const raw = await sendOnce(a, request, timeoutMs);
      return parseMaxResponse(raw, requestId);
    } catch (e) {
      lastError = e as Error;
      // If the request was already on the wire and this call mutates the scene, stop:
      // retrying elsewhere risks a second apply against the same Max instance.
      if (noRetryAfterWrite && (e as Error & { wrote?: boolean }).wrote) break;
    }
  }
  throw lastError || new Error("no transport reached 3ds Max");
}

interface MaxRouteBody {
  action?: "ping" | "pull" | "apply";
  target?: string;
  values?: ApplyValue[];
}

export async function POST(request: Request): Promise<Response> {
  let body: MaxRouteBody;
  try {
    body = (await request.json()) as MaxRouteBody;
  } catch {
    return NextResponse.json({ ok: false, error: "body was not valid JSON" }, { status: 400 });
  }

  try {
    if (body.action === "ping") {
      const res = await sendToMax("", "ping", PING_TIMEOUT_MS);
      // the listener answers ping with a JSON string in `result`
      let info: Record<string, unknown> = {};
      try {
        info =
          typeof res.result === "string"
            ? (JSON.parse(res.result) as Record<string, unknown>)
            : ((res.result as Record<string, unknown>) ?? {});
      } catch {
        /* keep {} */
      }
      return NextResponse.json({ ok: res.success !== false, info });
    }

    if (body.action === "pull") {
      const res = await sendToMax(buildPullScript(), "maxscript", SCRIPT_TIMEOUT_MS);
      if (res.success === false) {
        return NextResponse.json({ ok: false, error: res.error || "pull failed in 3ds Max" });
      }
      const pulled = mapPullResult(res.result);
      if (!pulled) {
        return NextResponse.json({ ok: false, error: "pull returned an unreadable payload" });
      }
      return NextResponse.json({ ok: true, pulled });
    }

    if (body.action === "apply") {
      const target = body.target || "vray7max";
      // Cap the raw list up front so a client cannot force an arbitrarily large generated
      // script (DoS-flavored bloat). Only KNOWN_PROPS pass the gate below, but bound the
      // pre-validation work too. De-dup (last-writer-wins per param) happens after clamp.
      const raw = (Array.isArray(body.values) ? body.values : []).slice(0, MAX_APPLY_VALUES);
      // Pack-validate + clamp EVERY numeric before it can touch the scene.
      const byParam = new Map<string, ApplyValue>();
      for (const v of raw) {
        if (!v || typeof v.param !== "string") continue;
        const entry = PACKS.lookup(target, v.param);
        if (!entry || entry.lighting !== true) continue;
        if (typeof v.set === "number") {
          if (!Number.isFinite(v.set)) continue;
          byParam.set(v.param, { param: v.param, set: PACKS.clamp(target, v.param, v.set).value as number });
        } else if (typeof v.set === "string") {
          byParam.set(v.param, { param: v.param, set: v.set });
        }
      }
      const validated: ApplyValue[] = [...byParam.values()];
      const split = splitApplyValues(validated, target);
      if (split.scriptable.length === 0) {
        return NextResponse.json({
          ok: true,
          result: { applied: [], failed: [] },
          manual: split.manual,
        });
      }
      const res = await sendToMax(
        buildApplyScript(split.scriptable),
        "maxscript",
        SCRIPT_TIMEOUT_MS,
        true // apply is non-idempotent — don't retry across transports once written
      );
      if (res.success === false) {
        return NextResponse.json({ ok: false, error: res.error || "apply failed in 3ds Max" });
      }
      return NextResponse.json({
        ok: true,
        result: mapApplyResult(res.result),
        manual: split.manual,
      });
    }

    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    // Max not running / listener not up — a NORMAL state, reported as such.
    return NextResponse.json({
      ok: false,
      offline: true,
      error:
        "3ds Max is not reachable (" +
        ((e as Error)?.message || String(e)) +
        "). Start 3ds Max with the MCP listener installed and try again.",
    });
  }
}
