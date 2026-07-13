// /api/max — END-TO-END integration: drives the REAL exported POST() handler through
// sendToMax's transport fallback (claimed pipe → default pipe → TCP 127.0.0.1:8765)
// against a protocol-faithful mock listener bound to the HARDCODED fallback port.
//
// This is the gap the other suites don't cover: route.test.ts / route.stress.test.ts
// drive sendOnce on an EPHEMERAL port, bypassing (a) the POST body/action dispatch,
// (b) the pack-validate + clamp + de-dup + cap loop, and (c) the pipe→TCP fallthrough
// that the route actually uses. Here the pipes don't exist on the test box, so every
// call must fall through to the TCP mock — proving the wired path works and is fast.
//
// Self-skips if :8765 is already bound (a real Max, or a parallel run) so it's safe in
// CI / on any machine.

import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { POST } from "../route";

const PORT = 8765;
let server: Server | null = null;
let bound = false;
let received: string[] = []; // every `command` the mock received (the generated MAXScript)

beforeAll(async () => {
  server = createServer((sock: Socket) => {
    sock.on("error", () => {});
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      let req: { command?: string; type?: string; requestId?: string } = {};
      try {
        req = JSON.parse(buf.slice(0, nl));
      } catch {
        sock.write('{"success":false,"error":"bad json"}\n');
        return;
      }
      received.push(req.command || "");
      const rid = req.requestId;
      if (req.type === "ping") {
        sock.write(
          JSON.stringify({ success: true, requestId: rid, result: JSON.stringify({ pong: true, renderer: "V_Ray_7", safeMode: true }) }) + "\n"
        );
        return;
      }
      const cmd = req.command || "";
      if (cmd.includes("rendererName")) {
        sock.write(
          JSON.stringify({
            success: true,
            requestId: rid,
            result: '{"renderer":"V_Ray_7","counts":{"suns":1,"vrayLights":2,"physCams":1},"params":{"sun.turbidity":3.1,"cm.type":6,"sun.enabled":"on"}}',
          }) + "\n"
        );
        return;
      }
      if (cmd.includes("okArr")) {
        sock.write(JSON.stringify({ success: true, requestId: rid, result: '{"applied":["sun.turbidity"],"failed":[]}' }) + "\n");
        return;
      }
      sock.write('{"success":false,"error":"unrecognized script"}\n');
    });
  });
  server.on("error", () => {});
  bound = await new Promise<boolean>((res) => {
    const onErr = () => res(false); // EADDRINUSE → skip
    server!.once("error", onErr);
    server!.listen(PORT, "127.0.0.1", () => {
      server!.off("error", onErr);
      res(true);
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((res) => server!.close(() => res()));
});

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/max", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}
const applyScript = () => received.find((c) => c.includes("okArr"));

describe("POST /api/max — full handler + pipe→TCP fallback against a mock Max on :8765", () => {
  it("ping falls through the (absent) pipes to TCP and returns listener info — fast", async () => {
    if (!bound) return expect(bound).toBe(false); // skipped: port busy
    received = [];
    const t0 = Date.now();
    const j = (await (await post({ action: "ping" })).json()) as { ok: boolean; info?: { pong?: boolean; renderer?: string } };
    expect(j.ok).toBe(true);
    expect(j.info?.pong).toBe(true);
    expect(j.info?.renderer).toBe("V_Ray_7");
    // the two non-existent pipe attempts must fail FAST (ENOENT), not hang to timeout
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("pull maps the mock scene back into pack vocabulary (cm.type int → label, missing[])", async () => {
    if (!bound) return;
    const j = (await (await post({ action: "pull" })).json()) as { ok: boolean; pulled: { vray: boolean; counts: unknown; params: Record<string, unknown>; missing: string[] } };
    expect(j.ok).toBe(true);
    expect(j.pulled.vray).toBe(true);
    expect(j.pulled.counts).toEqual({ suns: 1, vrayLights: 2, physCams: 1 });
    expect(j.pulled.params["sun.turbidity"]).toBe(3.1);
    expect(j.pulled.params["cm.type"]).toBe("Reinhard"); // int 6 reverse-mapped by the route
    expect(j.pulled.missing).toContain("cam.fnumber"); // not in the mock scene
  });

  it("apply CLAMPS an out-of-range value BEFORE it is ever scripted", async () => {
    if (!bound) return;
    received = [];
    const j = (await (await post({ action: "apply", target: "vray7max", values: [{ param: "sun.turbidity", set: 1e9 }] })).json()) as { ok: boolean };
    expect(j.ok).toBe(true);
    const s = applyScript() || "";
    expect(s).toMatch(/lmSun\.turbidity = /); // a setter was emitted
    expect(s).not.toContain("1000000000"); // ...but NOT the raw 1e9 — it was clamped
    expect(s).not.toContain("1e"); // and never exponential form
  });

  it("apply DE-DUPS a repeated param (last write wins → one setter)", async () => {
    if (!bound) return;
    received = [];
    await post({ action: "apply", target: "vray7max", values: [{ param: "sun.turbidity", set: 3 }, { param: "sun.turbidity", set: 6 }] });
    const s = applyScript() || "";
    const setters = s.split("\n").filter((l) => l.includes("lmSun.turbidity ="));
    expect(setters.length).toBe(1);
    expect(setters[0]).toContain("= 6");
  });

  it("apply with a valid param but UNMAPPABLE enum value → manual, Max is NOT called", async () => {
    if (!bound) return;
    received = [];
    const j = (await (await post({ action: "apply", target: "vray7max", values: [{ param: "cm.type", set: "NotARealToneMap" }] })).json()) as { ok: boolean; result: unknown; manual: { param: string }[] };
    expect(j.ok).toBe(true);
    expect(j.result).toEqual({ applied: [], failed: [] });
    expect(j.manual.some((m) => m.param === "cm.type")).toBe(true);
    expect(applyScript()).toBeUndefined(); // short-circuited: nothing scriptable → never hit Max
  });

  it("apply with a MAXScript-injection value never reaches the wire", async () => {
    if (!bound) return;
    received = [];
    await post({ action: "apply", target: "vray7max", values: [{ param: "sun.turbidity", set: "6); deletefile (getdir #temp); (" }] });
    const s = applyScript();
    // a string on a float param is dropped → either no scriptable command at all, or if
    // other values made a command, the hostile substring/turbidity-setter is absent.
    if (s) {
      expect(s).not.toContain("deletefile");
      expect(s).not.toMatch(/lmSun\.turbidity = 6\)/);
    }
  });

  it("5 concurrent pulls all succeed (each POST opens its own socket)", async () => {
    if (!bound) return;
    const results = await Promise.all(Array.from({ length: 5 }, () => post({ action: "pull" }).then((r) => r.json() as Promise<{ ok: boolean }>)));
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("malformed JSON body → HTTP 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/max", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("unknown action → HTTP 400", async () => {
    if (!bound) return;
    const res = await post({ action: "frobnicate" });
    expect(res.status).toBe(400);
  });
});

// -- Stress-finding regressions: C1 (JSON `null` body mislabeled as Max-offline and
// leaking the raw TypeError string) and C14 (no cross-origin protection on a route
// that mutates the running 3ds Max scene). The rejects never reach the wire, so they
// run whether or not the mock listener bound; the same-origin pass needs :8765. -----
const APPLY_BODY = {
  action: "apply",
  target: "vray7max",
  values: [{ param: "sun.turbidity", set: 6 }],
};

describe("POST /api/max — body-shape + cross-origin guards (C1, C14)", () => {
  it("JSON `null` body → clean 400 envelope, NOT offline:true, no internal error leak", async () => {
    const res = await post(null);
    expect(res.status).toBe(400);
    const j = (await res.json()) as { ok: boolean; offline?: boolean; error: string };
    expect(j.ok).toBe(false);
    expect(j.offline).toBeUndefined(); // must not be mislabeled "Max is offline"
    expect(j.error).not.toMatch(/not reachable|Cannot read propert/i); // no raw TypeError echo
  });

  it("JSON array / scalar bodies get the same clean non-offline reject", async () => {
    for (const b of [[1], 7, false]) {
      const j = (await (await post(b)).json()) as { ok: boolean; offline?: boolean };
      expect(j.ok).toBe(false);
      expect(j.offline).toBeUndefined();
    }
  });

  it("a no-preflight content-type (text/plain) is rejected and NEVER reaches Max", async () => {
    received = [];
    const res = await POST(
      new Request("http://localhost/api/max", {
        method: "POST",
        headers: { "content-type": "text/plain;charset=UTF-8" }, // the CORS "simple request" vector
        body: JSON.stringify(APPLY_BODY),
      })
    );
    expect(res.status).toBe(415);
    const j = (await res.json()) as { ok: boolean; error: string };
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/application\/json/);
    expect(received).toEqual([]); // no script ever hit the listener
  });

  it("a cross-origin Origin header is rejected even with application/json", async () => {
    received = [];
    const res = await POST(
      new Request("http://localhost/api/max", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example.com" },
        body: JSON.stringify(APPLY_BODY),
      })
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    expect(received).toEqual([]);
  });

  it("an unparseable Origin (sandboxed 'null') is treated as cross-origin", async () => {
    const res = await POST(
      new Request("http://localhost/api/max", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "null" },
        body: JSON.stringify(APPLY_BODY),
      })
    );
    expect(res.status).toBe(403);
  });

  it("a same-origin apply (Origin host matches the request host) still passes", async () => {
    if (!bound) return;
    received = [];
    const res = await POST(
      new Request("http://localhost/api/max", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify(APPLY_BODY),
      })
    );
    const j = (await res.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
    expect(applyScript()).toContain("lmSun.turbidity"); // the apply really ran
  });

  it("a content-type WITH charset parameter still passes (application/json; charset=utf-8)", async () => {
    if (!bound) return;
    const res = await POST(
      new Request("http://localhost/api/max", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ action: "ping" }),
      })
    );
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});
