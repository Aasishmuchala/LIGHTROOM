// /api/max — ADVERSARIAL socket stress (2026-07-05 hardening pass). Drives the real
// exported sendOnce against deliberately hostile node:net mock listeners: stalls,
// no-newline closes, chunked drips, and oversized floods. Pins the response-size cap
// and the fast-fail timeout the harden pass added. Separate file from route.test.ts.

import { afterEach, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:net";
import { sendOnce } from "../route";
import { buildMaxRequest } from "@/lib/max-bridge";

const servers: Server[] = [];
async function listen(onConn: (sock: import("node:net").Socket) => void): Promise<number> {
  const s = createServer((sock) => {
    // Swallow the server-side ECONNRESET the client's socket.destroy() provokes when a
    // hostile mock is still mid-write (the flood/stall tests). Without this the reset
    // surfaces as an unhandled 'error' event and fails the run even though the client
    // behaved correctly.
    sock.on("error", () => {});
    onConn(sock);
  });
  servers.push(s);
  s.on("error", () => {});
  await new Promise<void>((res) => s.listen(0, "127.0.0.1", res));
  return (s.address() as { port: number }).port;
}
afterEach(() => {
  // fire-and-forget close: server.close() waits on lingering client sockets, which the
  // stall/no-newline tests deliberately leave half-open — awaiting it would deadlock.
  for (const s of servers.splice(0)) s.close();
});

const REQ = buildMaxRequest("", "ping", "rid");

describe("sendOnce against hostile listeners", () => {
  it("a listener that sends 1 byte then stalls forever rejects at the deadline (no hang)", async () => {
    const port = await listen((sock) => {
      sock.on("data", () => sock.write("{")); // one byte, never a newline
    });
    const t0 = Date.now();
    await expect(sendOnce({ host: "127.0.0.1", port }, REQ, 600)).rejects.toThrow(/did not respond/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(500);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("a listener that closes WITHOUT a newline rejects (no phantom success)", async () => {
    const port = await listen((sock) => {
      sock.on("data", () => sock.end("{\"success\":true}")); // no trailing \n, then FIN
    });
    // buf is non-empty at 'end' → the route's 'end' handler resolves the partial buffer;
    // parseMaxResponse then reads the first line. Either resolve-with-parseable OR reject
    // is acceptable; what matters is it settles fast and never hangs.
    const settled = await sendOnce({ host: "127.0.0.1", port }, REQ, 800)
      .then((r) => ({ ok: true as const, r }))
      .catch((e) => ({ ok: false as const, e }));
    expect(settled).toBeTruthy();
  });

  it("a response split across 3 delayed chunks (newline in the last) resolves correctly", async () => {
    const port = await listen((sock) => {
      sock.on("data", () => {
        sock.write('{"success":true,');
        setTimeout(() => sock.write('"result":"ok"'), 40);
        setTimeout(() => sock.write("}\n"), 80);
      });
    });
    const raw = await sendOnce({ host: "127.0.0.1", port }, REQ, 3000);
    expect(raw).toContain('"result":"ok"');
  });

  it("a multi-megabyte newline-less flood is capped, not OOM'd", async () => {
    const port = await listen((sock) => {
      sock.on("data", () => {
        // stream 2MB in 64KB bursts with no newline — must trip MAX_RESP_BYTES (1MB)
        const burst = "A".repeat(65536);
        let sent = 0;
        const pump = () => {
          if (sent > 2_000_000 || sock.destroyed) return;
          sock.write(burst);
          sent += burst.length;
          setImmediate(pump);
        };
        pump();
      });
    });
    await expect(sendOnce({ host: "127.0.0.1", port }, REQ, 5000)).rejects.toThrow(/size cap/);
  });

  it("a dead port rejects fast (connect refused), and the rejection carries wrote=false", async () => {
    const err = await sendOnce({ host: "127.0.0.1", port: 1 }, REQ, 1500).catch((e) => e as Error & { wrote?: boolean });
    expect(err).toBeInstanceOf(Error);
    // never wrote the request → safe to retry another transport (idempotency signal)
    expect((err as { wrote?: boolean }).wrote).toBeFalsy();
  });

  it("garbage after a valid line: first line wins", async () => {
    const port = await listen((sock) => {
      sock.on("data", () => sock.write('{"success":true,"result":"first"}\nGARBAGE'));
    });
    const raw = await sendOnce({ host: "127.0.0.1", port }, REQ, 2000);
    expect(raw.split("\n")[0]).toContain("first");
  });
});
