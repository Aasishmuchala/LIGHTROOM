import { describe, it, expect } from "vitest";
import {
  EMIT_RECIPE,
  EMIT_CORRECTION,
  systemPrompt,
  validateRecipe,
  SCHEMAS,
} from "../schemas";
import { PACKS } from "../packs";

// A well-formed recipe value builder (recipe mode uses `set`).
function value(param: string, set: number | string, step = 1): Record<string, unknown> {
  return { param, set, from: 0, step, confidence: "high", why: "test" };
}
// A well-formed correction move builder (correction mode uses `to`).
function move(param: string, to: number | string, step = 1): Record<string, unknown> {
  return { param, to, from: 0, step, confidence: "high", why: "test" };
}
// A complete recipe envelope with the given values[].
function recipe(values: Record<string, unknown>[]): Record<string, unknown> {
  return {
    baseline: "factory_defaults",
    hdri_mood: "clear noon",
    values,
    rationale: "r",
    gi_notes: "g",
    status: "continue",
  };
}

describe("emit_recipe / emit_correction schema shape", () => {
  it("emit_recipe: flat values[] with set/from/step, step 1..6, maxItems 32", () => {
    expect(EMIT_RECIPE.name).toBe("emit_recipe");
    expect(EMIT_RECIPE.strict).toBe(true);
    const vals = EMIT_RECIPE.input_schema.properties.values as {
      minItems: number;
      maxItems: number;
      items: { required: string[]; properties: Record<string, { minimum?: number; maximum?: number }> };
    };
    expect(vals.minItems).toBe(4);
    expect(vals.maxItems).toBe(32);
    expect(vals.items.required).toContain("set");
    expect(vals.items.required).not.toContain("to");
    expect(vals.items.properties.step.minimum).toBe(1);
    expect(vals.items.properties.step.maximum).toBe(6);
  });

  it("emit_correction: moves[] with to/from/step, 1..5 moves, applied_assumed boolean", () => {
    expect(EMIT_CORRECTION.name).toBe("emit_correction");
    const moves = EMIT_CORRECTION.input_schema.properties.moves as {
      minItems: number;
      maxItems: number;
      items: { required: string[] };
    };
    expect(moves.minItems).toBe(1);
    expect(moves.maxItems).toBe(5);
    expect(moves.items.required).toContain("to");
    expect(moves.items.required).not.toContain("set");
    expect(EMIT_CORRECTION.input_schema.required).toContain("applied_assumed");
    expect(
      (EMIT_CORRECTION.input_schema.properties.applied_assumed as { type: string }).type
    ).toBe("boolean");
  });

  it("SCHEMAS namespace re-exports the same objects", () => {
    expect(SCHEMAS.emit_recipe).toBe(EMIT_RECIPE);
    expect(SCHEMAS.emit_correction).toBe(EMIT_CORRECTION);
    expect(SCHEMAS.validateRecipe).toBe(validateRecipe);
  });
});

describe("validateRecipe — blank / partial rejection", () => {
  it("{} is not ok", () => {
    expect(validateRecipe({}, "vray7max").ok).toBe(false);
  });
  it("{values:[]} is not ok", () => {
    const r = validateRecipe({ values: [] }, "vray7max");
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("absent or empty");
  });
  it("missing required top-level fields fail even with a value present", () => {
    const r = validateRecipe({ values: [value("sun.turbidity", 8)] }, "vray7max");
    // baseline / rationale / hdri_mood / gi_notes / status are all missing
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('missing required field "baseline"'))).toBe(true);
    expect(r.errors.some((e) => e.includes('missing required field "status"'))).toBe(true);
  });
});

describe("validateRecipe — a fully valid recipe passes", () => {
  it("ok:true, no errors, values carried into cleaned", () => {
    const r = validateRecipe(recipe([value("sun.turbidity", 8), value("light.multiplier", 30, 4)]), "vray7max");
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect((r.cleaned.values as unknown[]).length).toBe(2);
  });
});

describe("validateRecipe — unknown param fails and is dropped", () => {
  it("unknown param -> ok:false and item removed from cleaned", () => {
    const r = validateRecipe(recipe([value("not.a.real.param", 5)]), "vray7max");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("unknown param"))).toBe(true);
    expect((r.cleaned.values as unknown[]).length).toBe(0);
  });
});

describe("validateRecipe — display-only (lighting:false) params rejected", () => {
  it("clouds.seed (RECIPE-CRITICAL display-only) -> ok:false and item dropped, good item kept", () => {
    const r = validateRecipe(
      recipe([value("clouds.seed", 42, 6), value("sun.turbidity", 8, 2)]),
      "vray7max"
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("display-only"))).toBe(true);
    const kept = r.cleaned.values as Record<string, unknown>[];
    expect(kept.length).toBe(1);
    expect(kept[0].param).toBe("sun.turbidity");
  });

  it("viewport-only control (light.vp_wire_color) is rejected the same way", () => {
    const r = validateRecipe(recipe([value("light.vp_wire_color", "red", 4)]), "vray7max");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('"light.vp_wire_color"'))).toBe(true);
    expect((r.cleaned.values as unknown[]).length).toBe(0);
  });

  it("correction mode rejects display-only params too", () => {
    const r = validateRecipe(
      {
        moves: [move("clouds.seed", 7, 6)],
        rationale: "r",
        status: "continue",
        status_reason: "s",
        applied_assumed: true,
      },
      "vray7max",
      "correction"
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("display-only") && e.includes("correction"))).toBe(true);
    expect((r.cleaned.moves as unknown[]).length).toBe(0);
  });

  it("every lighting:true param remains accepted (spot check across kinds)", () => {
    const r = validateRecipe(
      recipe([
        value("sun.turbidity", 8, 2), // spinner
        value("sun.sky_model", "CIE Overcast", 3), // dropdown (string passes through)
        value("sun.placement_elevation", 15, 2), // placement with numeric target
        value("light.color", "warm amber", 4), // color instruction
      ]),
      "vray7max"
    );
    expect(r.ok).toBe(true);
    expect((r.cleaned.values as unknown[]).length).toBe(4);
  });
});

describe("validateRecipe — one value per PHYSICAL control (exact + pack-declared alias dupes)", () => {
  it("a literal duplicate param errors and only the FIRST occurrence is kept", () => {
    const r = validateRecipe(
      recipe([value("sun.turbidity", 8, 2), value("sun.turbidity", 3, 2)]),
      "vray7max"
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('duplicate param "sun.turbidity"'))).toBe(true);
    const kept = r.cleaned.values as Record<string, unknown>[];
    expect(kept.length).toBe(1);
    expect(kept[0].set).toBe(8);
  });

  // C17: the pack's notes declare fill.plane_intensity ≡ light.multiplier (and
  // fill.plane_kelvin ≡ light.temperature) — the SAME VRayLight spinner offered under
  // two ids. Both landing in one emit is two conflicting instructions for one knob
  // (the live apply's later setter silently overwrites the earlier), so the dedupe
  // canonicalizes through the alias exactly like a literal duplicate.
  it("light.multiplier + fill.plane_intensity (same Multiplier spinner) cannot both land", () => {
    const r = validateRecipe(
      recipe([value("light.multiplier", 120, 4), value("fill.plane_intensity", 5, 4)]),
      "vray7max"
    );
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e) =>
          e.includes('"fill.plane_intensity"') &&
          e.includes('same physical control as "light.multiplier"')
      )
    ).toBe(true);
    const kept = r.cleaned.values as Record<string, unknown>[];
    expect(kept.length).toBe(1);
    expect(kept[0].param).toBe("light.multiplier"); // first occurrence wins
    expect(kept[0].set).toBe(120);
  });

  it("alias order reversed: the fill lever came first, so IT wins and light.multiplier is the repeat", () => {
    const r = validateRecipe(
      recipe([value("fill.plane_intensity", 5, 4), value("light.multiplier", 120, 4)]),
      "vray7max"
    );
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e) => e.includes('"light.multiplier"') && e.includes('"fill.plane_intensity"')
      )
    ).toBe(true);
    const kept = r.cleaned.values as Record<string, unknown>[];
    expect(kept.length).toBe(1);
    expect(kept[0].param).toBe("fill.plane_intensity");
  });

  it("fill.plane_kelvin ≡ light.temperature dedupes the same way", () => {
    const r = validateRecipe(
      recipe([value("light.temperature", 4500, 4), value("fill.plane_kelvin", 6500, 4)]),
      "vray7max"
    );
    expect(r.ok).toBe(false);
    const kept = r.cleaned.values as Record<string, unknown>[];
    expect(kept.length).toBe(1);
    expect(kept[0].param).toBe("light.temperature");
  });

  it("either alias id ALONE stays fully valid (the fill levers themselves are not rejected)", () => {
    expect(validateRecipe(recipe([value("fill.plane_intensity", 5, 4)]), "vray7max").ok).toBe(true);
    expect(validateRecipe(recipe([value("light.multiplier", 120, 4)]), "vray7max").ok).toBe(true);
  });

  it("correction mode dedupes through the alias too", () => {
    const r = validateRecipe(
      {
        moves: [move("light.multiplier", 120, 4), move("fill.plane_intensity", 5, 4)],
        rationale: "r",
        status: "continue",
        status_reason: "s",
        applied_assumed: true,
      },
      "vray7max",
      "correction"
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("correction may set each control once"))).toBe(true);
    expect((r.cleaned.moves as unknown[]).length).toBe(1);
  });
});

describe("validateRecipe — non-finite numeric rejected", () => {
  it("NaN set fails", () => {
    const r = validateRecipe(recipe([value("sun.turbidity", NaN)]), "vray7max");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("non-finite"))).toBe(true);
    expect((r.cleaned.values as unknown[]).length).toBe(0);
  });
  it("Infinity set fails", () => {
    const r = validateRecipe(recipe([value("sun.turbidity", Infinity)]), "vray7max");
    expect(r.ok).toBe(false);
    expect((r.cleaned.values as unknown[]).length).toBe(0);
  });
});

describe("validateRecipe — out-of-range numeric is clamped (kept, ok stays true)", () => {
  it("40000 on sun.kelvin [1000,20000] -> clamped:true, value 20000, ok:true", () => {
    const r = validateRecipe(recipe([value("sun.kelvin", 40000)]), "vray7max");
    expect(r.ok).toBe(true);
    const cleaned = (r.cleaned.values as Record<string, unknown>[])[0];
    expect(cleaned.set).toBe(20000);
    expect(cleaned.clamped).toBe(true);
  });

  it("an in-range numeric is kept with clamped:false", () => {
    const r = validateRecipe(recipe([value("sun.kelvin", 6500)]), "vray7max");
    const cleaned = (r.cleaned.values as Record<string, unknown>[])[0];
    expect(cleaned.set).toBe(6500);
    expect(cleaned.clamped).toBe(false);
  });
});

describe("validateRecipe — step bounds", () => {
  it("step 6 is accepted", () => {
    const r = validateRecipe(recipe([value("sun.turbidity", 8, 6)]), "vray7max");
    expect(r.ok).toBe(true);
  });
  it("step 7 is rejected", () => {
    const r = validateRecipe(recipe([value("sun.turbidity", 8, 7)]), "vray7max");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('"step" must be an integer 1..6'))).toBe(true);
  });
  it("step 0 is rejected", () => {
    const r = validateRecipe(recipe([value("sun.turbidity", 8, 0)]), "vray7max");
    expect(r.ok).toBe(false);
  });
});

describe("validateRecipe — correction mode (moves[]/to)", () => {
  function correction(moves: Record<string, unknown>[]): Record<string, unknown> {
    return { moves, rationale: "r", status: "continue", status_reason: "s", applied_assumed: true };
  }

  it("a valid correction passes", () => {
    const r = validateRecipe(correction([move("sun.turbidity", 8)]), "vray7max", "correction");
    expect(r.ok).toBe(true);
    expect((r.cleaned.moves as unknown[]).length).toBe(1);
  });

  it("empty moves[] fails", () => {
    const r = validateRecipe(correction([]), "vray7max", "correction");
    expect(r.ok).toBe(false);
  });

  it("clamps `to` and flags it", () => {
    const r = validateRecipe(correction([move("sun.kelvin", 40000)]), "vray7max", "correction");
    const cleaned = (r.cleaned.moves as Record<string, unknown>[])[0];
    expect(cleaned.to).toBe(20000);
    expect(cleaned.clamped).toBe(true);
  });
});

describe("systemPrompt", () => {
  it('recipe mode contains the fixed step order + surgical guidance and ends with the pack fragment', () => {
    const p = systemPrompt("vray7max", "recipe");
    expect(p).toContain("Fixed step order");
    expect(p).toContain("1. exposure/WB lock");
    expect(p).toContain("6. atmosphere/weather");
    expect(p).toContain("surgical");
    // does NOT carry the correction-only guidance
    expect(p).not.toContain("CORRECTION ROUND");
    // carries the JSON-only output directive with the recipe schema EMBEDDED (no tool is
    // sent — omega's tool path 500s — so the exact schema travels inside the prompt)
    expect(p).toContain("OUTPUT FORMAT");
    expect(p).toContain('"hdri_mood"');
    expect(p).toContain('"values"');
    expect(p).toMatch(/single raw JSON object/);
    expect(p).toMatch(/NO markdown/);
    // the brevity guard now carves out the spatial check instead of steering AWAY from the grid
    expect(p).toContain("SPATIAL ASYMMETRY");
    expect(p).toContain("spatial light placement is the most important match cue");
    // warmth split is treated as a lighting fix (key vs fill/dome color), not one global WB move
    expect(p).toContain("warmthShadow and wb.warmthHighlight are INDEPENDENT");
    // the initial recipe must be COMPLETE (not capped at a low surgical move count)
    expect(p).toContain("INITIAL recipe");
    expect(p).toMatch(/8-14 moves/);
    // V-Ray placement-kind controls must carry an explicit numeric target
    expect(p).toContain("STATE AN EXPLICIT NUMERIC TARGET");
    // Vantage auto-exposure hard gate is in the exposure lock
    expect(p).toContain("cam.auto_exposure = off");
    // ends with the pack fragment
    expect(p.endsWith(PACKS.promptFragment("vray7max"))).toBe(true);
  });

  it("correction mode adds the refine-round / oscillation-guard / handoff guidance", () => {
    const p = systemPrompt("vray7max", "correction");
    expect(p).toContain("CORRECTION ROUND");
    expect(p).toContain("Oscillation guard");
    expect(p).toContain("handoff_to_grade");
    // handoff is now NARROW: contrast + warmth split are NOT grade problems, and handoff
    // requires an already-matched spatial + luminance layout under a purely global cast
    expect(p).toContain("NARROW handoff");
    expect(p).toContain("PURELY GLOBAL chromatic offset");
    expect(p).toMatch(/are NOT grade problems/);
    // JSON-only directive present with the correction schema EMBEDDED (no tool named)
    expect(p).toContain("OUTPUT FORMAT");
    expect(p).toContain('"moves"');
    expect(p).toContain('"applied_assumed"');
    expect(p).toMatch(/single raw JSON object/);
    expect(p.endsWith(PACKS.promptFragment("vray7max"))).toBe(true);
  });

  it("works for the vantage target too", () => {
    const p = systemPrompt("vantage33", "recipe");
    expect(p).toContain("TARGET: Chaos Vantage 3.3");
  });
});
