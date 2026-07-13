// EXR exposure COMMIT QUEUE — pins for createEvCommitQueue, the pure scheduler behind
// DropSlot's EV slider (stress finding C5, 2026-07-13: the slider used to fire a
// FULL-resolution redevelop + re-encode + re-measure + persist on EVERY 0.1-EV drag
// tick, with overlapping async commits able to land out of order). Contract under
// test:
//   debounce  : a drag burst collapses to ONE trailing commit carrying the NEWEST EV;
//   serialize : commits never overlap — a monotonic request counter marks the newest
//               ask, the in-flight completion re-dispatches it, and intermediate asks
//               are dropped (so last-commit-wins IS newest-wins by construction);
//   resilience: a rejected commit never wedges the queue; cancel() drops queued work
//               without killing the queue.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEvCommitQueue, EV_COMMIT_DELAY_MS } from "@/components/lib";

// -- helpers ------------------------------------------------------------------------

/** A promise whose settlement the test controls — stands in for a slow 4K redevelop. */
function gate() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain the microtask queue (the queue's dispatch/completion chain is a handful of
 *  promise hops — 10 passes is comfortably past it, timer-independent). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// ------------------------------------------------------------------------------------
// Trailing debounce: one commit per drag pause, newest value.
// ------------------------------------------------------------------------------------
describe("createEvCommitQueue — trailing debounce", () => {
  it("collapses a 30-tick drag into ONE commit carrying the newest EV", async () => {
    const calls: number[] = [];
    const q = createEvCommitQueue((ev) => {
      calls.push(ev);
    });
    // 0.1-EV ticks arriving faster than the trailing delay (a real drag).
    for (let i = 1; i <= 30; i++) {
      q.request(i / 10);
      await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS / 4);
    }
    expect(calls).toEqual([]); // still dragging — nothing committed yet
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    expect(calls).toEqual([3]); // exactly one commit, the final EV
  });

  it("a later drag after a pause commits again — the queue is reusable", async () => {
    const calls: number[] = [];
    const q = createEvCommitQueue((ev) => {
      calls.push(ev);
    });
    q.request(1);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    expect(calls).toEqual([1]);
    q.request(2);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    expect(calls).toEqual([1, 2]);
  });

  it("an already-committed ask never re-fires, however long the idle", async () => {
    const calls: number[] = [];
    const q = createEvCommitQueue((ev) => {
      calls.push(ev);
    });
    q.request(1);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS * 20);
    expect(calls).toEqual([1]);
  });
});

// ------------------------------------------------------------------------------------
// Serialization: commits never overlap; only the newest ask may follow an in-flight one.
// ------------------------------------------------------------------------------------
describe("createEvCommitQueue — serialization", () => {
  it("never overlaps commits: a newer EV asked mid-commit waits, then lands exactly once", async () => {
    let active = 0;
    let maxActive = 0;
    const gates: Array<ReturnType<typeof gate>> = [];
    const calls: number[] = [];
    const q = createEvCommitQueue((ev) => {
      calls.push(ev);
      active += 1;
      maxActive = Math.max(maxActive, active);
      const g = gate();
      gates.push(g);
      return g.promise.finally(() => {
        active -= 1;
      });
    });

    q.request(1);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    expect(calls).toEqual([1]); // dispatched, still in flight (gate unresolved)

    q.request(2);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS * 3);
    expect(calls).toEqual([1]); // its timer fired, but NO second dispatch while in flight

    gates[0].resolve();
    await flushMicrotasks();
    expect(calls).toEqual([1, 2]); // completion re-dispatched the newest ask

    gates[1].resolve();
    await flushMicrotasks();
    expect(maxActive).toBe(1); // at no point did two commits run at once
  });

  it("intermediate EVs asked during a slow commit are dropped — only the newest lands", async () => {
    const gates: Array<ReturnType<typeof gate>> = [];
    const calls: number[] = [];
    const q = createEvCommitQueue((ev) => {
      calls.push(ev);
      const g = gate();
      gates.push(g);
      return g.promise;
    });

    q.request(1);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS); // commit(1) in flight
    q.request(2);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    q.request(3);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    gates[0].resolve();
    await flushMicrotasks();
    expect(calls).toEqual([1, 3]); // 2 was superseded before it could dispatch

    gates[1].resolve();
    await flushMicrotasks();
    expect(calls).toEqual([1, 3]); // and nothing re-fires after the last commit
  });

  it("completion does NOT commit early while the user is still dragging (timer armed)", async () => {
    const gates: Array<ReturnType<typeof gate>> = [];
    const calls: number[] = [];
    const q = createEvCommitQueue((ev) => {
      calls.push(ev);
      const g = gate();
      gates.push(g);
      return g.promise;
    });

    q.request(1);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS); // commit(1) in flight
    q.request(2); // trailing delay re-armed — drag is still live
    gates[0].resolve();
    await flushMicrotasks();
    expect(calls).toEqual([1]); // completion defers to the armed timer
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    expect(calls).toEqual([1, 2]); // the pause commits it
  });
});

// ------------------------------------------------------------------------------------
// Resilience + cancel + pending.
// ------------------------------------------------------------------------------------
describe("createEvCommitQueue — resilience and cancel", () => {
  it("a rejected commit neither wedges the queue nor leaks (sink owns error surfacing)", async () => {
    const calls: number[] = [];
    let first = true;
    const q = createEvCommitQueue((ev) => {
      calls.push(ev);
      if (first) {
        first = false;
        return Promise.reject(new Error("redevelop failed"));
      }
      return undefined;
    });
    q.request(1);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    q.request(2);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    expect(calls).toEqual([1, 2]); // the failure did not block the next commit
  });

  it("a rejected in-flight commit still hands off to the newest queued ask", async () => {
    const gates: Array<ReturnType<typeof gate>> = [];
    const calls: number[] = [];
    const q = createEvCommitQueue((ev) => {
      calls.push(ev);
      const g = gate();
      gates.push(g);
      return g.promise;
    });
    q.request(1);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS); // in flight
    q.request(2);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS); // superseding ask, delay elapsed
    gates[0].reject(new Error("boom"));
    await flushMicrotasks();
    expect(calls).toEqual([1, 2]); // newest ask dispatched despite the rejection
    gates[1].resolve();
    await flushMicrotasks();
  });

  it("cancel() drops a queued ask, and stops an in-flight completion from re-dispatching", async () => {
    const gates: Array<ReturnType<typeof gate>> = [];
    const calls: number[] = [];
    const q = createEvCommitQueue((ev) => {
      calls.push(ev);
      const g = gate();
      gates.push(g);
      return g.promise;
    });

    // Queued-only: cancelled before the delay elapses — nothing commits.
    q.request(1);
    q.cancel();
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS * 2);
    expect(calls).toEqual([]);

    // In-flight: the running commit finishes, but the cancelled newer ask never sends…
    q.request(1);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    expect(calls).toEqual([1]);
    q.request(2);
    q.cancel();
    gates[0].resolve();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS * 2);
    expect(calls).toEqual([1]);

    // …and the queue stays usable afterwards.
    q.request(3);
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    gates[1].resolve();
    await flushMicrotasks();
    expect(calls).toEqual([1, 3]);
  });

  it("pending() tracks both the armed timer and the in-flight commit", async () => {
    const gates: Array<ReturnType<typeof gate>> = [];
    const q = createEvCommitQueue(() => {
      const g = gate();
      gates.push(g);
      return g.promise;
    });
    expect(q.pending()).toBe(false);
    q.request(1);
    expect(q.pending()).toBe(true); // timer armed
    await vi.advanceTimersByTimeAsync(EV_COMMIT_DELAY_MS);
    expect(q.pending()).toBe(true); // timer done, commit in flight
    gates[0].resolve();
    await flushMicrotasks();
    expect(q.pending()).toBe(false); // settled and idle
  });

  it("the default trailing delay sits in the 150–250ms band the C5 fix specifies", () => {
    expect(EV_COMMIT_DELAY_MS).toBeGreaterThanOrEqual(150);
    expect(EV_COMMIT_DELAY_MS).toBeLessThanOrEqual(250);
  });
});
