// Recipe EXPORT — toMaxScript / toChecklist (lib/export). Pins the honesty contract:
// only KNOWN_PROPS params become real MAXScript setters; EVERYTHING else (VFB layer
// values, placements, color instructions, uncertain camera/renderer property names,
// unknown params) collapses to the one explicit fallback shape
//     -- SET MANUALLY: <ui_path> = <value>   (<why>)
// and the checklist covers EVERY value in step order. Both functions are pure and
// must never throw on the messy shapes a real recipe carries (clamped flags, string
// spinner values, placement rows, params outside the pack).

import { describe, it, expect } from "vitest";
import { toMaxScript, toChecklist } from "../export";
import { PACKS } from "../packs";
import type { Recipe } from "../types";

// -- fixture: one recipe exercising every mapping class in a single export ---------
//   scripted   : cm.type (renderer enum), sun.turbidity/cam.iso/dome.intensity
//                (floats), sun.enabled/sun.invisible (checkbox on/off → true/false)
//   fallback   : cam.wb_kelvin (uncertain prop name — honesty rule), vfb.exposure
//                (VFB layer, no scriptable path), sun.filter_color (string color
//                instruction), sun.placement_elevation (placement + clamped),
//                bogus.param (unknown — not in the pack)
const RECIPE: Recipe = {
  baseline: "factory_defaults",
  hdri_mood: "warm overcast dusk",
  rationale: "test rationale",
  gi_notes: "test gi",
  status: "continue",
  values: [
    { param: "cm.type", set: "Reinhard", from: "Reinhard", step: 5, confidence: "high", why: "keep Reinhard mapping" },
    { param: "sun.turbidity", set: 6, from: 2.5, step: 2, confidence: "high", why: "hazier warm sky" },
    { param: "sun.enabled", set: "on", from: "on", step: 2, confidence: "high", why: "sun drives the key" },
    { param: "sun.invisible", set: "off", from: "off", step: 2, confidence: "low", why: "keep the disc visible" },
    { param: "cam.iso", set: 200, from: 100, step: 1, confidence: "high", why: "one stop brighter" },
    { param: "cam.wb_kelvin", set: 5200, from: 6500, step: 1, confidence: "medium", why: "warm the render toward the reference" },
    { param: "dome.intensity", set: 1.8, from: 1, step: 3, confidence: "medium", why: "lift ambient level" },
    { param: "sun.filter_color", set: "warm amber", from: "white", step: 2, confidence: "medium", why: "late-afternoon tint" },
    { param: "sun.placement_elevation", set: 12, from: 35, step: 2, confidence: "medium", why: "low sun for long shadows", clamped: true },
    { param: "vfb.exposure", set: 0.5, from: 0, step: 5, confidence: "low", why: "display-side lift" },
    { param: "bogus.param", set: 42, from: 0, step: 6, confidence: "low", why: "not a real control" },
  ],
};

const ui = (id: string) => PACKS.lookup("vray7max", id)!.ui_path;

// ---------------------------------------------------------------------------------
// toMaxScript — real setters for the KNOWN_PROPS set
// ---------------------------------------------------------------------------------
describe("toMaxScript — deterministic setters", () => {
  const ms = toMaxScript(RECIPE, "vray7max");

  it("known float params become real property setters on the create-or-find nodes", () => {
    expect(ms).toContain("lmSun.turbidity = 6");
    expect(ms).toContain("lmCam.ISO = 200");
    expect(ms).toContain("lmDome.multiplier = 1.8");
  });

  it("checkbox on/off values become MAXScript true/false booleans", () => {
    expect(ms).toContain("lmSun.enabled = true");
    expect(ms).toContain("lmSun.invisible = false");
  });

  it("cm.type maps the verified dropdown enum (Reinhard = 6), set on the discovered renderer prop", () => {
    // CPU/GPU-aware: enumerate the renderer's real props and set whatever color-mapping-type
    // property it exposes (colorMapping_type on CPU; a clean miss on V-Ray GPU).
    expect(ms).toContain("getPropNames renderers.current");
    expect(ms).toContain("setProperty renderers.current lmCm 6"); // Reinhard = 6
    expect(ms).toContain('pattern:"V_Ray*"'); // guarded, never a hard error off-V-Ray
  });

  it("emits the create-or-find scaffolding only for the node kinds actually used", () => {
    expect(ms).toContain("fn lmFirstOrCreate");
    expect(ms).toContain("fn lmVRayLightOfType");
    expect(ms).toContain("lmFirstOrCreate VRaySun");
    expect(ms).toContain("lmFirstOrCreate VRayPhysicalCamera");
    expect(ms).toContain("lmVRayLightOfType 1"); // dome-typed VRayLight
    // no plane/generic-light values in the fixture → no lmPlane/lmLight locals
    expect(ms).not.toContain("lmPlane");
    expect(ms).not.toContain("local lmLight");
  });

  it("header opens with the fixed placeholder line and carries baseline + mood", () => {
    expect(ms.split("\n")[0]).toBe("-- LightMatch recipe");
    expect(ms).toContain("baseline : factory defaults");
    expect(ms).toContain("hdri_mood: warm overcast dusk");
  });
});

// ---------------------------------------------------------------------------------
// toMaxScript — the honesty fallbacks
// ---------------------------------------------------------------------------------
describe("toMaxScript — SET MANUALLY fallbacks", () => {
  const ms = toMaxScript(RECIPE, "vray7max");
  const manualLines = ms.split("\n").filter((l) => l.includes("-- SET MANUALLY:"));

  it("uncertain camera property (cam.wb_kelvin) falls back with the VERBATIM ui_path", () => {
    const line = manualLines.find((l) => l.includes(ui("cam.wb_kelvin")))!;
    expect(line).toBeTruthy();
    expect(line).toContain("5200K"); // unit glued on, buildSheetText convention
    expect(line).toContain("(warm the render toward the reference)");
    expect(ms).not.toMatch(/lmCam\.white/i); // no invented property name anywhere
  });

  it("VFB layer values always fall back (no scriptable path)", () => {
    expect(manualLines.some((l) => l.includes(ui("vfb.exposure")))).toBe(true);
    expect(ms).not.toContain("vfbControl"); // no guessed VFB scripting
  });

  it("string values are quoted in the fallback line", () => {
    const line = manualLines.find((l) => l.includes(ui("sun.filter_color")))!;
    expect(line).toContain('= "warm amber"');
  });

  it("placement values fall back even when numeric (and clamped)", () => {
    expect(manualLines.some((l) => l.includes(ui("sun.placement_elevation")))).toBe(true);
    expect(ms).not.toContain("placement_elevation ="); // never a property setter
  });

  it("unknown params fall back with the verbatim param id as the path", () => {
    const line = manualLines.find((l) => l.includes("bogus.param"))!;
    expect(line).toBeTruthy();
    expect(line).toContain("= 42");
  });

  it("header counts are honest: 6 scripted, 5 manual — and the manual count matches the lines", () => {
    expect(ms).toContain("11 value(s) — 6 scripted below, 5 listed as SET MANUALLY.");
    expect(manualLines).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------------
// toMaxScript — non-V-Ray targets and degenerate inputs (never throws)
// ---------------------------------------------------------------------------------
describe("toMaxScript — robustness", () => {
  it("a non-vray7max target degrades to a fully-commented script (nothing executed)", () => {
    const ms = toMaxScript(RECIPE, "vantage33");
    const code = ms.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("--"));
    expect(code).toHaveLength(0); // every non-empty line is a comment
    expect(ms).toContain("Chaos Vantage 3.3");
    expect(ms.split("\n").filter((l) => l.includes("-- SET MANUALLY:"))).toHaveLength(11);
  });

  it("never throws on empty / missing / hostile values", () => {
    const empty = { ...RECIPE, values: [] };
    expect(toMaxScript(empty as Recipe, "vray7max")).toContain("(recipe has no values)");
    expect(() => toMaxScript({} as Recipe, "vray7max")).not.toThrow();
    const hostile = {
      ...RECIPE,
      values: [
        { param: "sun.turbidity", set: "six" as unknown as number, from: 2.5, step: 2, confidence: "high", why: "spinner got a STRING" },
        { param: "sun.enabled", set: "maybe", from: "on", step: 2, confidence: "low", why: "checkbox got a non-on/off token" },
        { param: "cm.type", set: "Filmic-ish", from: "Reinhard", step: 5, confidence: "low", why: "dropdown got an unknown option" },
        null as unknown as Recipe["values"][number],
        { param: "sun.ozone", set: Infinity, from: 0.35, step: 2, confidence: "low", why: "non-finite number" },
      ],
    };
    const ms = toMaxScript(hostile as Recipe, "vray7max");
    // NONE of the doubtful values may become a setter — all collapse to fallbacks.
    expect(ms).not.toMatch(/lmSun\.\w+ =/);
    expect(ms).not.toContain("colorMapping_type =");
    expect(ms.split("\n").filter((l) => l.includes("-- SET MANUALLY:"))).toHaveLength(4);
  });

  it("an all-comment script has no dangling MAXScript block (an empty () would not parse)", () => {
    const manualOnly = {
      ...RECIPE,
      values: [
        { param: "vfb.exposure", set: 0.5, from: 0, step: 5, confidence: "low", why: "display lift" },
      ],
    };
    const ms = toMaxScript(manualOnly as Recipe, "vray7max");
    expect(ms).not.toContain("(\n"); // no opened block when nothing is scripted
    expect(ms).toContain("-- SET MANUALLY:");
  });
});

// ---------------------------------------------------------------------------------
// toChecklist — full coverage, step ordering, works for any target
// ---------------------------------------------------------------------------------
describe("toChecklist", () => {
  const txt = toChecklist(RECIPE, "vray7max");
  const lines = txt.split("\n");

  it("covers EVERY recipe value with a [ ] line (known ui_path or verbatim param id)", () => {
    const boxLines = lines.filter((l) => l.startsWith("[ ] "));
    expect(boxLines).toHaveLength(RECIPE.values.length);
    for (const v of RECIPE.values) {
      const path = PACKS.lookup("vray7max", v.param)?.ui_path || v.param;
      expect(boxLines.some((l) => l.includes(path))).toBe(true);
    }
  });

  it("orders by step (1..6) with the canonical step headers, stable within a step", () => {
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at("Step 1 — Lock exposure & white balance")).toBeGreaterThan(-1);
    expect(at("Step 2 — Sun / key")).toBeGreaterThan(at("Step 1 —"));
    expect(at("Step 3 — Environment / dome")).toBeGreaterThan(at("Step 2 —"));
    expect(at("Step 5 — Color mapping")).toBeGreaterThan(at("Step 3 —"));
    expect(at("Step 6 — Atmosphere / weather")).toBeGreaterThan(at("Step 5 —"));
    // step 1 values precede step 2 values; recipe order kept INSIDE step 2
    expect(at(ui("cam.iso"))).toBeLessThan(at(ui("sun.turbidity")));
    expect(at(ui("sun.turbidity"))).toBeLessThan(at(ui("sun.enabled")));
    // cm.type was emitted FIRST in the recipe but sorts under step 5
    expect(at(ui("cm.type"))).toBeGreaterThan(at(ui("dome.intensity")));
  });

  it("formats one line per value: [ ] path  ->  value+unit   (why)", () => {
    const iso = lines.find((l) => l.includes(ui("cam.iso")))!;
    expect(iso).toBe(`[ ] ${ui("cam.iso")}  ->  200ISO   (one stop brighter)`);
    const color = lines.find((l) => l.includes(ui("sun.filter_color")))!;
    expect(color).toContain("->  warm amber"); // strings pass through plain
  });

  it("header carries the target label, baseline, and hdri_mood", () => {
    expect(lines[0]).toBe("LightMatch checklist — V-Ray 7 for 3ds Max");
    expect(txt).toContain("baseline: factory defaults");
    expect(txt).toContain("hdri_mood: warm overcast dusk");
  });

  it("works for the Vantage target (its own pack paths resolve)", () => {
    const vRecipe: Recipe = {
      ...RECIPE,
      values: [
        { param: "env.intensity", set: 1.4, from: 1, step: 3, confidence: "high", why: "brighter sky" },
        { param: "post.saturation", set: 0.2, from: 0, step: 5, confidence: "medium", why: "richer color" },
      ],
    };
    const v = toChecklist(vRecipe, "vantage33");
    expect(v).toContain("LightMatch checklist — Chaos Vantage 3.3");
    expect(v).toContain(PACKS.lookup("vantage33", "env.intensity")!.ui_path);
    expect(v).toContain(PACKS.lookup("vantage33", "post.saturation")!.ui_path);
  });

  it("never throws on empty or missing values", () => {
    expect(toChecklist({ ...RECIPE, values: [] } as Recipe, "vray7max")).toContain(
      "(recipe has no values)"
    );
    expect(() => toChecklist({} as Recipe, "vantage33")).not.toThrow();
  });
});
