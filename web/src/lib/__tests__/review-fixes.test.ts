// Review-round fixes (2026-07-05) — pins for the four defects the adversarial
// verify pass caught after the 10-feature build:
//   1. CRITICAL: the SPATIAL ASYMMETRY prose read the diff as base−reference while
//      the data is reference−current — steering azimuth/elevation moves backwards;
//   2. export.ts let multi-line string values spill out of `--` comments (broken
//      .ms) and out of one-line checklist rows;
//   3. engine importJSON left stale EXR buffers -> stale linear_evidence (tested in
//      the engine suite, see review-fixes.engine.test.ts);
//   4. EXR probes developed at auto-EV cancel the measured response (code-level fix;
//      the branch needs a real canvas so it is documented, not unit-tested here).

import { describe, it, expect } from "vitest";
import { buildUserContent } from "../client-adapter";
import { toMaxScript, toChecklist } from "../export";
import type { Recipe } from "../types";

describe("SPATIAL ASYMMETRY direction (review finding #1 — was inverted)", () => {
  // A diff grid where the REFERENCE is brighter on the LEFT and on TOP:
  // left columns (0,1) positive, right columns ~0; top rows positive.
  const diff: Record<string, number> = {};
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      diff[`grid.${r * 4 + c}`] = (c < 2 ? 0.3 : 0.0) + (r < 2 ? 0.1 : 0.0);
    }
  }

  const text = () =>
    buildUserContent({ mode: "recipe", images: [], metricsBundle: { diff } })
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

  it("labels the scalars with the TRUE orientation (reference − current)", () => {
    const t = text();
    expect(t).toContain("SPATIAL ASYMMETRY (reference − current)");
    expect(t).not.toContain("(base − reference)");
  });

  it("positive leftMinusRight instructs moving the key LEFT (toward the reference's bright side)", () => {
    const t = text();
    // the numbers really are positive for this grid…
    expect(t).toMatch(/leftMinusRight=0\.\d+/);
    expect(t).toMatch(/topMinusBottom=0\.\d+/);
    // …and the prose sends the key toward the LEFT and the sun UP — not the reverse.
    expect(t).toContain("REFERENCE is brighter on the LEFT");
    expect(t).toContain("move the key toward the LEFT");
    expect(t).toContain("RAISE the sun");
    expect(t).not.toMatch(/move the key toward the right/i);
    expect(t).not.toMatch(/lower the sun elevation/i);
  });
});

describe("export survives multi-line string values (review finding #2)", () => {
  const recipe = {
    baseline: "factory_defaults",
    hdri_mood: "clear noon",
    values: [
      {
        param: "sun.placement_azimuth",
        set: "azimuth ~110°,\nelevation ~15°", // legal per schema; newline is the attack
        from: 135,
        step: 2,
        confidence: "medium",
        why: "key from\nframe left",
      },
      { param: "sun.turbidity", set: 8, from: 2.5, step: 2, confidence: "high", why: "haze" },
    ],
    rationale: "r",
    gi_notes: "g",
    status: "continue",
  } as unknown as Recipe;

  it(".ms output: every SET MANUALLY fallback stays on ONE line (comments cannot leak)", () => {
    const ms = toMaxScript(recipe, "vray7max");
    const manualLines = ms.split("\n").filter((l) => l.includes("-- SET MANUALLY:"));
    expect(manualLines.length).toBeGreaterThan(0);
    for (const l of manualLines) {
      expect(l.trimStart().startsWith("--")).toBe(true);
      expect(l).not.toContain("\n");
    }
    // the azimuth instruction's second half must live INSIDE a comment, not as code:
    const elevationLines = ms.split("\n").filter((l) => l.includes("elevation ~15°"));
    expect(elevationLines.length).toBeGreaterThan(0);
    for (const l of elevationLines) expect(l.trimStart().startsWith("--")).toBe(true);
  });

  it("checklist rows stay one line per value", () => {
    const txt = toChecklist(recipe, "vray7max");
    const rows = txt.split("\n").filter((l) => l.startsWith("[ ]"));
    expect(rows.length).toBe(2);
    const azRow = rows.find((l) => l.includes("azimuth ~110°"))!;
    expect(azRow).toContain("elevation ~15°"); // collapsed onto the same row
  });
});
