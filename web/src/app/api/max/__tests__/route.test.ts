// /api/max integration — a REAL socket round trip against a mock 3ds Max listener
// speaking the exact cl0nazepamm/3dsmax-mcp wire protocol (one JSON line in, one
// JSON line out), plus timeout/refusal behavior. No 3ds Max required: this verifies
// every layer of the bridge below the actual Max process.

import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createServer, type Server, type Socket as NetSocket } from "node:net";
import { sendOnce } from "../route";
import {
  buildMaxRequest,
  parseMaxResponse,
  buildPullScript,
  mapPullResult,
  buildApplyScript,
  mapApplyResult,
} from "@/lib/max-bridge";

// -- the mock listener: parses the request line, answers like mcp_server.ms would. --
let server: Server;
let port: number;
const seen: { command: string; type: string }[] = [];

// a plausible V-Ray scene state the mock "reads" when the pull script arrives
const MOCK_SCENE: Record<string, number | string> = {
  "sun.enabled": "on",
  "sun.turbidity": 3.1,
  "sun.intensity_mult": 1.0,
  "cam.iso": 100,
  "cm.type": 6,
};

beforeAll(async () => {
  server = createServer((socket: NetSocket) => {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      let req: { command?: string; type?: string; requestId?: string } = {};
      try {
        req = JSON.parse(line);
      } catch {
        socket.write(JSON.stringify({ success: false, error: "bad json" }) + "\n");
        return;
      }
      seen.push({ command: req.command || "", type: req.type || "" });

      if (req.type === "ping") {
        socket.write(
          JSON.stringify({
            success: true,
            requestId: req.requestId,
            result: JSON.stringify({ pong: true, renderer: "V_Ray_7", maxVersion: 2026, safeMode: true }),
          }) + "\n"
        );
        return;
      }
      const cmd = req.command || "";
      if (cmd.includes('\\"renderer\\"') || cmd.includes("rendererName")) {
        // the pull script — answer with the mock scene state
        const params = Object.entries(MOCK_SCENE)
          .map(([k, v]) => `"${k}":${typeof v === "string" ? `"${v}"` : v}`)
          .join(",");
        socket.write(
          JSON.stringify({
            success: true,
            requestId: req.requestId,
            result: `{"renderer":"V_Ray_7","counts":{"suns":1,"vrayLights":2,"physCams":1},"params":{${params}}}`,
          }) + "\n"
        );
        return;
      }
      if (cmd.includes("okArr")) {
        // the apply script — pretend every setter but one landed
        socket.write(
          JSON.stringify({
            success: true,
            requestId: req.requestId,
            result: '{"applied":["sun.turbidity","sun.enabled"],"failed":["cam.iso"]}',
          }) + "\n"
        );
        return;
      }
      socket.write(JSON.stringify({ success: false, error: "unrecognized script" }) + "\n");
    });
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

describe("socket round trips against a protocol-faithful mock listener", () => {
  it("ping: request framed correctly, pong parsed back", async () => {
    const raw = await sendOnce(
      { host: "127.0.0.1", port },
      buildMaxRequest("", "ping", "rid1"),
      3000
    );
    const res = parseMaxResponse(raw);
    expect(res.success).toBe(true);
    const info = JSON.parse(res.result as string);
    expect(info.pong).toBe(true);
    expect(info.renderer).toBe("V_Ray_7");
    expect(seen.at(-1)).toMatchObject({ type: "ping" });
  });

  it("pull: the real pull script travels, the scene state maps back into pack vocabulary", async () => {
    const raw = await sendOnce(
      { host: "127.0.0.1", port },
      buildMaxRequest(buildPullScript(), "maxscript", "rid2"),
      5000
    );
    const res = parseMaxResponse(raw);
    expect(res.success).toBe(true);
    const pulled = mapPullResult(res.result)!;
    expect(pulled.vray).toBe(true);
    expect(pulled.counts).toEqual({ suns: 1, vrayLights: 2, physCams: 1 });
    expect(pulled.params["sun.turbidity"]).toBe(3.1);
    expect(pulled.params["cm.type"]).toBe("Reinhard"); // int 6 reverse-mapped
    expect(pulled.missing).toContain("cam.fnumber"); // mock scene didn't report it
  });

  it("apply: the real apply script travels, per-value results map back", async () => {
    const script = buildApplyScript([
      { param: "sun.turbidity", set: 6 },
      { param: "sun.enabled", set: "on" },
      { param: "cam.iso", set: 200 },
    ]);
    const raw = await sendOnce(
      { host: "127.0.0.1", port },
      buildMaxRequest(script, "maxscript", "rid3"),
      5000
    );
    const result = mapApplyResult(parseMaxResponse(raw).result);
    expect(result.applied).toEqual(["sun.turbidity", "sun.enabled"]);
    expect(result.failed).toEqual(["cam.iso"]);
  });

  it("a dead port rejects fast instead of hanging", async () => {
    await expect(
      sendOnce({ host: "127.0.0.1", port: 1 }, buildMaxRequest("", "ping", "rid4"), 1500)
    ).rejects.toThrow();
  });

  it("a silent server times out at the deadline", async () => {
    const silent = createServer(() => {
      /* accept and say nothing */
    });
    await new Promise<void>((res) => silent.listen(0, "127.0.0.1", res));
    const silentPort = (silent.address() as { port: number }).port;
    try {
      await expect(
        sendOnce({ host: "127.0.0.1", port: silentPort }, buildMaxRequest("", "ping", "rid5"), 700)
      ).rejects.toThrow(/did not respond/);
    } finally {
      // fire-and-forget: close() WAITS for lingering server-side sockets, and awaiting
      // it here deadlocks the test even though the client already gave up.
      silent.close();
    }
  });
});
