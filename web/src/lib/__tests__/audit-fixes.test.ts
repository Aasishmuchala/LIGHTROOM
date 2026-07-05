// Audit now-action fixes (2026-07-05) — pins the code/data fixes the blocker audit
// surfaced that are addressable WITHOUT 3ds Max or a live gateway key:
//   B5  status_reason double-rejection: a correction omitting the soft status_reason
//       field must NOT lose the whole refine round (default-filled, not rejected);
//   B4  camera exposure toggle: apply must enable .exposure or ISO/f/shutter no-op;
//   packs: post.hue is DEGREES (-180..180), not the -1..1 the family was over-generalized
//       to; the confirmed Vantage Saturation stays -1..1; cm.saturation (V-Ray VFB,
//       Player-family) stays ±100 (docs support it — NOT the Vantage 100x twin).

import { describe, it, expect } from "vitest";
import { validateRecipe, systemPrompt } from "../schemas";
import { PACKS } from "../packs";
import { buildApplyScript } from "../max-bridge";

describe("B5 — a correction missing only status_reason survives (soft field, default-filled)", () => {
  const base = {
    moves: [{ param: "sun.intensity_mult", to: 1.1, from: 1.0, step: 2, confidence: "high", why: "trim" }],
    rationale: "r",
    status: "continue",
    applied_assumed: false,
    // status_reason DELIBERATELY OMITTED — a routine continue trim
  };
  it("validates ok and cleaned carries an empty status_reason (round not lost)", () => {
    const r = validateRecipe(base, "vray7max", "correction");
    expect(r.ok).toBe(true);
    expect((r.cleaned as { status_reason?: unknown }).status_reason).toBe("");
    expect((r.cleaned.moves as unknown[]).length).toBe(1);
  });
  it("a non-string status_reason is normalized to empty, not rejected", () => {
    const r = validateRecipe({ ...base, status_reason: 42 }, "vray7max", "correction");
    expect(r.ok).toBe(true);
    expect((r.cleaned as { status_reason?: unknown }).status_reason).toBe("");
  });
  it("a real status_reason still passes through untouched", () => {
    const r = validateRecipe({ ...base, status_reason: "warmed the key" }, "vray7max", "correction");
    expect(r.ok).toBe(true);
    expect((r.cleaned as { status_reason?: unknown }).status_reason).toBe("warmed the key");
  });
  it("the correction prompt now explicitly mandates status_reason", () => {
    const p = systemPrompt("vray7max", "correction");
    expect(p).toMatch(/ALWAYS include `status_reason`/);
    expect(p).toMatch(/REQUIRED on every correction/);
  });
  it("recipe mode is unaffected — its required fields still hard-reject when missing", () => {
    const r = validateRecipe({ values: [{ param: "sun.turbidity", set: 8, from: 2.5, step: 2, confidence: "high", why: "w" }] }, "vray7max");
    expect(r.ok).toBe(false); // baseline/status/etc still required
  });
});

describe("B4 — apply enables camera exposure before ISO/f/shutter (or they no-op)", () => {
  it("a camera setter emits lmCam.exposure = true in setup, before the setters", () => {
    const script = buildApplyScript([{ param: "cam.iso", set: 200 }]);
    expect(script).toContain("lmCam.exposure = true");
    // ordering: the exposure enable is in the setup block, ahead of the ISO setter
    expect(script.indexOf("lmCam.exposure = true")).toBeLessThan(script.indexOf("lmCam.ISO = 200"));
  });
  it("no camera in the recipe -> no exposure toggle emitted", () => {
    const script = buildApplyScript([{ param: "sun.turbidity", set: 6 }]);
    expect(script).not.toContain("lmCam.exposure");
  });
});

describe("packs — Color-corrections scale corrections (family is NOT uniform)", () => {
  it("post.hue is DEGREES -180..180 (doc-confirmed), not the sibling -1..1", () => {
    const e = PACKS.lookup("vantage33", "post.hue")!;
    expect(e.range).toEqual([-180, 180]);
    expect(e.unit).toBe("°");
    expect(e.verified).toBe("2026-07-05");
  });
  it("post.saturation stays -1..1 (user-confirmed in the live Vantage product)", () => {
    const e = PACKS.lookup("vantage33", "post.saturation")!;
    expect(e.range).toEqual([-1, 1]);
    expect(e.verified).toBe("2026-07-05");
  });
  it("the inferred (not individually confirmed) family members are downgraded to verified:false", () => {
    for (const id of ["post.lightness", "post.balance_cyan_red", "post.balance_magenta_green", "post.balance_yellow_blue", "post.wb_tint"]) {
      const e = PACKS.lookup("vantage33", id)!;
      expect(e.verified, id).toBe(false);
      expect(e.notes, id).toMatch(/INFERRED|not.*confirmed/i);
    }
  });
  it("cm.saturation (V-Ray VFB, Player-family) keeps ±100 — NOT the Vantage 100x twin", () => {
    const e = PACKS.lookup("vray7max", "cm.saturation")!;
    expect(e.range).toEqual([-100, 100]);
    // and a model emitting a Player-scale value stays in range (no catastrophic clamp)
    const clamped = PACKS.clamp("vray7max", "cm.saturation", -30);
    expect(clamped.value).toBe(-30);
    expect(clamped.clamped).toBe(false);
  });
  it("entry counts unchanged (159 / 144) after the data edits", () => {
    expect(PACKS.vray7max.entries.length).toBe(159);
    expect(PACKS.vantage33.entries.length).toBe(144);
  });
});
