// Option-coverage contract — "the model goes through ALL the options it has."
//
// The product's promise is that a recipe is chosen from the target's COMPLETE
// lighting control set (nothing invented, nothing missing) and that every value the
// model may set is bounded by the pack's verified range. These tests pin that
// contract end-to-end at the prompt boundary:
//
//   1. every lighting:true pack entry reaches the model, verbatim, in BOTH modes
//      (recipe + correction) for BOTH targets — with its kind, range, and default;
//   2. the option-line count equals the lighting:true entry count exactly (no
//      silent truncation of the listing);
//   3. display-only (lighting:false) completeness controls are withheld from the
//      prompt AND rejected by validateRecipe if the model names one anyway — so
//      the full pipeline (offer -> emit -> validate) is closed over the same set;
//   4. the settings sheet still covers EVERY control (lighting:true and :false),
//      so what the model did not move is displayed at its held default.

import { describe, it, expect } from "vitest";
import { PACKS } from "../packs";
import { systemPrompt, validateRecipe } from "../schemas";
import type { TargetId } from "../types";

const TARGETS: TargetId[] = ["vray7max", "vantage33"];
const MODES = ["recipe", "correction"] as const;

describe.each(TARGETS)("option coverage — %s", (target) => {
  const entries = PACKS[target].entries;
  const lighting = entries.filter((e) => e.lighting === true);
  const displayOnly = entries.filter((e) => e.lighting !== true);
  const fragment = PACKS.promptFragment(target);

  it("has a non-trivial option set (sanity)", () => {
    expect(entries.length).toBeGreaterThan(100);
    expect(lighting.length).toBeGreaterThan(80);
    expect(displayOnly.length).toBeGreaterThan(0);
  });

  it.each(MODES)("%s prompt carries EVERY lighting option verbatim", (mode) => {
    const prompt = systemPrompt(target, mode);
    for (const e of lighting) {
      // The exact one-line-per-param format promptFragment emits.
      expect(prompt).toContain(`${e.id} — ${e.ui_path} — kind:${e.kind}`);
    }
  });

  it("option-line count equals the lighting:true entry count (no truncation)", () => {
    const lines = fragment.split("\n");
    // line 0 is the "TARGET: … choose ONLY from these" header; the rest are options.
    expect(lines[0]).toContain("choose ONLY from these");
    expect(lines.length - 1).toBe(lighting.length);
  });

  it("every ranged option states its legal range in the prompt", () => {
    const byLine = new Map<string, string>();
    for (const line of fragment.split("\n").slice(1)) {
      byLine.set(line.slice(0, line.indexOf(" — ")), line);
    }
    for (const e of lighting) {
      const line = byLine.get(e.id);
      expect(line, `option line for ${e.id}`).toBeTruthy();
      if (e.range[0] < e.range[1]) {
        expect(line).toContain(`range:[${e.range[0]},${e.range[1]}]`);
      }
      expect(line).toContain(`default:${JSON.stringify(e.default)}`);
    }
  });

  it("display-only controls are withheld from the prompt", () => {
    const optionLines = fragment.split("\n").slice(1);
    for (const e of displayOnly) {
      expect(
        optionLines.some((l) => l.startsWith(`${e.id} — `)),
        `${e.id} must NOT be offered to the model`
      ).toBe(false);
    }
  });

  it("validateRecipe rejects EVERY display-only control if the model emits one anyway", () => {
    for (const e of displayOnly) {
      const r = validateRecipe(
        {
          baseline: "factory_defaults",
          hdri_mood: "x",
          rationale: "r",
          gi_notes: "g",
          status: "continue",
          values: [{ param: e.id, set: 1, from: 0, step: 1, confidence: "low", why: "w" }],
        },
        target
      );
      expect(r.ok, `${e.id} must be rejected`).toBe(false);
      expect((r.cleaned.values as unknown[]).length).toBe(0);
    }
  });

  it("validateRecipe accepts EVERY lighting option (offer set === accept set)", () => {
    for (const e of lighting) {
      // A numeric probe for ranged spinners, a string for everything else — mirrors
      // what the model actually emits per kind.
      const probe = e.range[0] < e.range[1] ? e.range[0] : "as in reference";
      const r = validateRecipe(
        {
          baseline: "factory_defaults",
          hdri_mood: "x",
          rationale: "r",
          gi_notes: "g",
          status: "continue",
          values: [{ param: e.id, set: probe, from: 0, step: 1, confidence: "high", why: "w" }],
        },
        target
      );
      expect(r.ok, `${e.id} must be accepted`).toBe(true);
    }
  });

  it("the settings sheet covers every control — moved or held at default", () => {
    const sheetIds = PACKS.sheet(target).flatMap((g) => g.entries.map((e) => e.id));
    expect(sheetIds.length).toBe(entries.length);
    for (const e of entries) expect(sheetIds).toContain(e.id);
  });
});
