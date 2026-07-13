// ERROR-BANNER COPY — pins for errorBannerCopy, the pure copy chooser behind
// ErrorBanner (extracted from the component for exactly these pins). The load-bearing
// contract is the auth split (stress finding UX-1, 2026-07-13): the "auth" kind
// covers BOTH "the gateway rejected your key" and "you never sent a key" — the
// /api/analyze route returns kind:"auth" with a "No API key: …" message when no key
// was pasted, and the banner used to hardcode "Key rejected" over it, falsely telling
// a key-less user their key was refused.

import { describe, it, expect } from "vitest";
import { errorBannerCopy, REJECT_MESSAGE } from "@/components/lib";
import type { LastError } from "@/store/useEngine";

// -- helper: a LastError as annotateError records it (at is required, rest optional).
function lastError(kind: LastError["kind"], message?: string, raw?: string): LastError {
  return { kind, message, raw, at: new Date().toISOString() };
}

// The two messages the analyze route actually emits for kind:"auth" — pinned verbatim
// so a route rewording that breaks the split shows up here.
const NO_KEY_MSG =
  "No API key: send it in the x-omega-key header or set OMEGA_API_KEY on the server.";
const REJECTED_401_MSG = "Gateway returned 401 — the API key is missing or invalid.";

// ------------------------------------------------------------------------------------
// The auth split: no-key is told the truth, a real 401 keeps the rejected wording.
// ------------------------------------------------------------------------------------
describe("errorBannerCopy — auth split (UX-1)", () => {
  it("the route's no-key auth error reads 'No key yet' and carries the route's own message", () => {
    const copy = errorBannerCopy(lastError("auth", NO_KEY_MSG));
    expect(copy.title).toBe("No key yet");
    expect(copy.title).not.toMatch(/rejected/i); // the old lie, pinned out
    expect(copy.detail).toBe(NO_KEY_MSG);
  });

  it("the chat/how no-key variant is recognized too", () => {
    const copy = errorBannerCopy(
      lastError("auth", "No API key yet — paste your omega key in the header, then ask again.")
    );
    expect(copy.title).toBe("No key yet");
  });

  it("a REAL 401 (key present but refused) keeps the 'Key rejected' wording", () => {
    // NB: this message contains "the API key is missing" — the detector must key on
    // the route's "No API key" phrasing, not on any mention of a missing key.
    const copy = errorBannerCopy(lastError("auth", REJECTED_401_MSG));
    expect(copy.title).toBe("Key rejected");
    expect(copy.detail).toBe("The gateway returned 401. Check your oc_ key and try again.");
  });

  it("an auth error with no message at all stays on the rejected wording", () => {
    expect(errorBannerCopy(lastError("auth")).title).toBe("Key rejected");
  });
});

// ------------------------------------------------------------------------------------
// The other kinds ride through unchanged (spot pins so the extraction can't drift).
// ------------------------------------------------------------------------------------
describe("errorBannerCopy — other kinds unchanged", () => {
  it("network surfaces the route's actual message and the raw payload", () => {
    const copy = errorBannerCopy(
      lastError("network", "Gateway request failed: HTTP 529 — overloaded.", "{...}")
    );
    expect(copy.title).toBe("Gateway error");
    expect(copy.detail).toBe("Gateway request failed: HTTP 529 — overloaded.");
    expect(copy.raw).toBe("{...}");
  });

  it("decode falls back to the canonical reject message when the error has none", () => {
    const copy = errorBannerCopy(lastError("decode"));
    expect(copy.title).toBe("Couldn't read that image");
    expect(copy.detail).toBe(REJECT_MESSAGE);
  });

  it("busy and the default kind keep their calm one-liners", () => {
    expect(errorBannerCopy(lastError("busy")).title).toBe("Already working");
    const other = errorBannerCopy(lastError("other", "boom"));
    expect(other.title).toBe("Something went wrong");
    expect(other.detail).toBe("boom");
  });
});
