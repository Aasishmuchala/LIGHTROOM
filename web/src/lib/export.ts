// LightMatch recipe EXPORT — two PURE formatters (no DOM, no Date, no store):
//
//   toMaxScript(recipe, target)  → a runnable .ms script for V-Ray 7 for 3ds Max
//   toChecklist(recipe, target)  → a plain-text checklist for ANY target (Vantage's
//                                  export path — Vantage has no scripting surface)
//
// HONESTY CONTRACT (the whole design): a wrong MAXScript property name that errors —
// or worse, silently sets the wrong thing — inside 3ds Max is strictly worse than a
// manual line. So only the properties in KNOWN_PROPS below (verified against the
// Chaos MAXScript docs) become real setters; EVERYTHING else — VFB layer values (no
// scriptable path at all), placement instructions, color-instruction strings, dropdowns
// whose int enums we haven't verified, and any param we simply aren't sure about —
// falls back to an explicit comment:
//
//   -- SET MANUALLY: <ui_path> = <value>   (<why>)
//
// Both functions NEVER throw: a recipe with clamped / string / placement / unknown
// values still exports (unknowns keep their param id as the path). Determinism keeps
// them unit-testable — the "date" slot in the header is the fixed placeholder line
// "-- LightMatch recipe", not a wall-clock read.

import { PACKS } from "./packs";
import type { PackEntry, Recipe, RecipeValue, TargetId } from "./types";

// ---------------------------------------------------------------------------------
// Step vocabulary — the model's fixed 1-6 order. Mirrors STEP_HEADERS in
// components/lib.ts (kept local: lib/ must not import from components/).
// ---------------------------------------------------------------------------------
const STEP_NAMES: Record<number, string> = {
  1: "Lock exposure & white balance",
  2: "Sun / key",
  3: "Environment / dome",
  4: "Fills & rim",
  5: "Color mapping",
  6: "Atmosphere / weather",
};

// ---------------------------------------------------------------------------------
// KNOWN_PROPS — the ONLY param ids that become real MAXScript setters. Each maps to
// a node kind (how the script acquires the object) + a verified property name.
//   bool  : checkbox/dropdown "on"/"off" → true/false (anything else falls back)
//   float : finite numbers only (a string in a spinner falls back)
//   enum  : dropdown option string → verified integer index (unknown option falls back)
// Node kinds:
//   sun   → first VRaySun, else create        light → first VRayLight (any type), else create
//   plane → first VRayLight type 0, else create   dome → first VRayLight type 1, else create
//   cam   → first VRayPhysicalCamera, else create renderer → renderers.current (guarded)
// DELIBERATELY ABSENT (fallback by design — the honesty rule):
//   cam.wb_kelvin      — white-balance preset/temperature property naming unverified
//   cm.highlight_burn  — Reinhard "Burn value" ↔ colorMapping_* field mapping unverified
//   vfb.* / cm.contrast / cm.saturation — VFB LAYER values, no scriptable path at all
//   light.temperature / fill.plane_kelvin — needs a paired Mode=Temperature switch
//   colors, placements, slots — instructions for a human, not values for a property
// ---------------------------------------------------------------------------------
export type MsNode = "sun" | "light" | "plane" | "dome" | "cam" | "renderer";
export type MsMapping =
  | { node: MsNode; prop: string; type: "bool" }
  | { node: MsNode; prop: string; type: "float" }
  | { node: MsNode; prop: string; type: "enum"; options: Record<string, number> };

// Exported for the live 3ds Max bridge (lib/max-bridge.ts): pull/apply speak the SAME
// verified property set — the bridge must never touch a property this map doesn't vouch for.
export const KNOWN_PROPS: Record<string, MsMapping> = {
  // VRaySun — property names per the Chaos "VRaySun" MAXScript listing.
  "sun.enabled": { node: "sun", prop: "enabled", type: "bool" },
  "sun.intensity_mult": { node: "sun", prop: "intensity_multiplier", type: "float" },
  "sun.size_mult": { node: "sun", prop: "size_multiplier", type: "float" },
  "sun.turbidity": { node: "sun", prop: "turbidity", type: "float" },
  "sun.ozone": { node: "sun", prop: "ozone", type: "float" },
  "sun.invisible": { node: "sun", prop: "invisible", type: "bool" },
  // VRayLight (generic — first light of the class, whatever its type).
  "light.on": { node: "light", prop: "on", type: "bool" },
  "light.multiplier": { node: "light", prop: "multiplier", type: "float" },
  "light.invisible": { node: "light", prop: "invisible", type: "bool" },
  // Fill workflow: the PLANE-typed VRayLight (type 0). Same .multiplier property.
  "fill.plane_intensity": { node: "plane", prop: "multiplier", type: "float" },
  // Dome: the DOME-typed VRayLight (type 1); Multiplier scales the HDRI directly.
  "dome.intensity": { node: "dome", prop: "multiplier", type: "float" },
  // VRayPhysicalCamera — ISO / f_number / shutter_speed are the documented names.
  "cam.iso": { node: "cam", prop: "ISO", type: "float" },
  "cam.fnumber": { node: "cam", prop: "f_number", type: "float" },
  "cam.shutter": { node: "cam", prop: "shutter_speed", type: "float" },
  // Render Setup · Color mapping type — colorMapping_type int enum in UI dropdown
  // order (docs). The two deprecated gamma options are omitted on purpose: the model
  // shouldn't emit them, and an unmatched option string falls back to a comment.
  "cm.type": {
    node: "renderer",
    prop: "colorMapping_type",
    type: "enum",
    options: {
      "linear multiply": 0,
      "exponential": 1,
      "hsv exponential": 2,
      "intensity exponential": 3,
      "reinhard": 6,
    },
  },
};

// per-node MAXScript local + how it is acquired (emitted only for nodes actually used).
const NODE_VAR: Record<Exclude<MsNode, "renderer">, string> = {
  sun: "lmSun",
  light: "lmLight",
  plane: "lmPlane",
  dome: "lmDome",
  cam: "lmCam",
};
const NODE_SETUP: Record<Exclude<MsNode, "renderer">, string> = {
  sun: "local lmSun = lmFirstOrCreate VRaySun -- first VRaySun in the scene, else a new one",
  light: "local lmLight = lmFirstOrCreate VRayLight -- first VRayLight (any type), else a new one",
  plane: "local lmPlane = lmVRayLightOfType 0 -- first PLANE VRayLight (type 0), else a new one",
  dome: "local lmDome = lmVRayLightOfType 1 -- first DOME VRayLight (type 1), else a new one",
  cam: "local lmCam = lmFirstOrCreate VRayPhysicalCamera -- first physical camera, else a new one",
};

// ---------------------------------------------------------------------------------
// small pure helpers
// ---------------------------------------------------------------------------------

/** MAXScript string literal: double-quoted with backslash + quote escaped. */
function msQuote(s: string): string {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** collapse a possibly-multiline model string into one comment-safe line. */
function oneLine(s: unknown): string {
  return typeof s === "string" ? s.replace(/\s*[\r\n]+\s*/g, " ").trim() : "";
}

/** checkbox/dropdown value → boolean, or null when it is not clearly on/off. */
function toBool(v: unknown): boolean | null {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "on" || t === "true") return true;
    if (t === "off" || t === "false") return false;
  }
  return null;
}

/** pack label for a target ("V-Ray 7 for 3ds Max"), falling back to the raw id. */
function targetLabel(target: TargetId | string): string {
  const pack = (PACKS as unknown as Record<string, { label?: string } | undefined>)[
    String(target)
  ];
  return pack && pack.label ? pack.label : String(target);
}

/** "factory defaults" | "settings screenshot" — same wording the UI uses. */
function baselineText(recipe: Partial<Recipe> | null | undefined): string {
  return recipe && recipe.baseline === "settings_screenshot"
    ? "settings screenshot"
    : "factory defaults";
}

/** the recipe's values[] defensively: always an array of plausible move objects. */
function safeValues(recipe: unknown): RecipeValue[] {
  const r = (recipe || {}) as Partial<Recipe>;
  if (!Array.isArray(r.values)) return [];
  return r.values.filter((v): v is RecipeValue => !!v && typeof v === "object");
}

/** display text for a value in a COMMENT/checklist: numbers get the pack unit glued
 *  on (matching buildSheetText's `${value}${unit}` convention); strings pass through
 *  (the .ms path quotes them separately). */
function plainValueText(v: unknown, entry: PackEntry | null): string {
  if (typeof v === "number" && Number.isFinite(v)) {
    const unit = entry && entry.unit ? entry.unit : "";
    return `${v}${unit}`;
  }
  // Strings are newline-collapsed: comment and checklist lines are one-per-value by
  // contract, and a multi-line placement instruction must not break that.
  return typeof v === "string" ? oneLine(v) : String(v);
}

/** the fallback comment — the ONE honest shape everything unscriptable collapses to.
 *  String values are newline-collapsed BEFORE quoting: a multi-line model string (a
 *  placement instruction with a line break is legal per the schema) would otherwise
 *  spill out of the `--` comment and land as live MAXScript that fails to parse. */
function fallbackLine(uiPath: string, value: unknown, entry: PackEntry | null, why: string): string {
  const val = typeof value === "string" ? msQuote(oneLine(value)) : plainValueText(value, entry);
  return `-- SET MANUALLY: ${uiPath} = ${val}   (${why || "no rationale given"})`;
}

// one analyzed recipe value → either a real setter (scripted) or a fallback comment.
interface MsLineResult {
  lines: string[];
  scripted: boolean;
  node: MsNode | null;
}

function msLinesFor(v: RecipeValue, target: TargetId | string): MsLineResult {
  const entry = PACKS.lookup(target, String(v.param));
  const uiPath = entry ? entry.ui_path : String(v.param);
  const why = oneLine(v.why) || (entry ? "" : "unknown parameter — not in this target's pack");
  const fallback: MsLineResult = {
    lines: [fallbackLine(uiPath, v.set, entry, why)],
    scripted: false,
    node: null,
  };

  const m = KNOWN_PROPS[String(v.param)];
  if (!m) return fallback; // unmapped (or unknown) — the honesty rule
  const tail = `-- ${uiPath}${why ? ` — ${why}` : ""}`;
  const pq = msQuote(String(v.param)); // ASCII param id for the ok/fail tally

  // RESILIENCE (2026-07-05, real-Max bug): every setter is wrapped in try/catch and
  // tallied into lmOk/lmFail. A property a KNOWN_PROPS entry vouches for can STILL be
  // absent on a given renderer/scene — e.g. `colorMapping_type` does NOT exist on the
  // V-Ray GPU renderer (V_Ray_GPU_*). Without try/catch that one "Unknown property"
  // aborts the ENTIRE FileIn and nothing applies. Wrapping each setter (exactly as the
  // live bridge's buildApplyScript already does) isolates the miss: everything settable
  // still lands, and the failures are printed at the end as "set them by hand".
  if (m.type === "bool") {
    const b = toBool(v.set);
    if (b === null) return fallback; // not clearly on/off — don't guess a boolean
    const nv = NODE_VAR[m.node as Exclude<MsNode, "renderer">];
    return {
      lines: [tail, `try ( ${nv}.${m.prop} = ${b}; append lmOk ${pq} ) catch ( append lmFail ${pq} )`],
      scripted: true,
      node: m.node,
    };
  }

  if (m.type === "float") {
    if (typeof v.set !== "number" || !Number.isFinite(v.set)) return fallback;
    const nv = NODE_VAR[m.node as Exclude<MsNode, "renderer">];
    return {
      lines: [tail, `try ( ${nv}.${m.prop} = ${v.set}; append lmOk ${pq} ) catch ( append lmFail ${pq} )`],
      scripted: true,
      node: m.node,
    };
  }

  // enum (renderer dropdown): only an EXACTLY known option string maps to its int. The
  // matchPattern guard records a miss (not an error) on a non-V-Ray renderer, and the
  // assignment is try/catch'd so an unsupported property (V-Ray GPU has no
  // colorMapping_type) is a reported miss, never a fatal FileIn exception.
  const key = typeof v.set === "string" ? v.set.trim().toLowerCase() : "";
  const idx = Object.prototype.hasOwnProperty.call(m.options, key) ? m.options[key] : undefined;
  if (idx === undefined) return fallback;
  // CPU/GPU-aware (2026-07-05): color mapping is a RENDERER property whose name/availability
  // differs by engine — `colorMapping_type` exists on the V-Ray CPU renderer (V_Ray_Adv_*)
  // but is absent on V-Ray GPU (V_Ray_GPU_* / RTEngine). Rather than hard-code a name (or
  // use isProperty, which *accesses* the property), the script ENUMERATES the ACTUAL
  // renderer's exposed property list with getPropNames and sets whatever color-mapping-type
  // property it finds — so it works on V-Ray CPU, on V-Ray GPU IF that engine exposes one
  // under any name, and honestly reports a manual step when the engine has none. (Scene-NODE
  // setters above — sun/light/cam — are identical on CPU and GPU; only this branch varies.)
  const pat = m.prop.replace(/_/g, "*"); // colorMapping_type -> "colorMapping*type" (match by shape, any engine's name)
  return {
    lines: [
      tail,
      `if (matchPattern ((classof renderers.current) as string) pattern:"V_Ray*") then (`,
      `  local lmCm = undefined`,
      `  try ( for p in (getPropNames renderers.current) while lmCm == undefined do ( if (matchPattern (p as string) pattern:"${pat}" ignoreCase:true) do lmCm = p ) ) catch ()`,
      `  if lmCm != undefined then (`,
      `    try ( setProperty renderers.current lmCm ${idx}; append lmOk ${pq} ) catch ( append lmFail ${pq} )`,
      `  ) else ( append lmFail ${pq}; format "  ! color mapping type is not scriptable on this renderer (e.g. V-Ray GPU) - set it manually in Render Setup\\n" )`,
      `) else ( append lmFail ${pq} )`,
    ],
    scripted: true,
    node: "renderer",
  };
}

// ---------------------------------------------------------------------------------
// toMaxScript(recipe, target) — runnable MAXScript for "vray7max" ONLY. Any other
// target degrades to a fully-commented script (nothing to execute, everything listed
// as SET MANUALLY) rather than throwing — the UI only offers the button for V-Ray,
// this is the pure-function belt under that suspender.
// ---------------------------------------------------------------------------------
export function toMaxScript(recipe: Recipe, target: TargetId | string): string {
  const values = safeValues(recipe);
  const r = (recipe || {}) as Partial<Recipe>;
  const scriptable = String(target) === "vray7max";

  // analyze every value first so the header can carry honest counts.
  const results = values.map((v) =>
    scriptable
      ? msLinesFor(v, target)
      : ({
          // non-V-Ray target: EVERY value is a manual line (no MAXScript surface).
          lines: [
            fallbackLine(
              PACKS.lookup(target, String(v.param))?.ui_path || String(v.param),
              v.set,
              PACKS.lookup(target, String(v.param)),
              oneLine(v.why)
            ),
          ],
          scripted: false,
          node: null,
        } as MsLineResult)
  );
  const scriptedCount = results.filter((x) => x.scripted).length;
  const manualCount = results.length - scriptedCount;

  const out: string[] = [];
  out.push("-- LightMatch recipe"); // fixed placeholder header line (deterministic — no wall clock)
  out.push("-- ============================================================================");
  out.push(`-- target   : ${targetLabel(target)}`);
  out.push(`-- baseline : ${baselineText(r)}`);
  if (oneLine(r.hdri_mood)) out.push(`-- hdri_mood: ${oneLine(r.hdri_mood)}`);
  out.push(
    `-- ${results.length} value(s) — ${scriptedCount} scripted below, ${manualCount} listed as SET MANUALLY.`
  );
  if (!scriptable) {
    out.push(`-- ${targetLabel(target)} has no MAXScript surface — nothing is executed here;`);
    out.push("-- every value is listed for manual setup (use the checklist export instead).");
  } else {
    out.push("-- Create-or-find: the FIRST existing node of each class is modified; a node is");
    out.push("-- created only when the scene has none. Each setter is wrapped in try/catch —");
    out.push("-- a property this renderer/scene lacks is skipped and reported at the end, never");
    out.push("-- halting the run (e.g. V-Ray GPU has no colorMapping_type). Review before running.");
  }
  out.push("-- ============================================================================");

  if (results.length === 0) {
    out.push("-- (recipe has no values)");
    return out.join("\n");
  }

  if (scriptedCount === 0) {
    // comments only — no `( )` block (an all-comment block would be an EMPTY block,
    // which MAXScript rejects; a flat comment listing always parses).
    for (const x of results) out.push(...x.lines);
    return out.join("\n");
  }

  // which acquisition helpers / node locals does the scripted set actually need?
  const nodes = new Set<MsNode>();
  for (const x of results) if (x.scripted && x.node) nodes.add(x.node);
  const needFirstOrCreate = nodes.has("sun") || nodes.has("light") || nodes.has("cam");
  const needLightOfType = nodes.has("plane") || nodes.has("dome");

  out.push("(");
  if (needFirstOrCreate) {
    out.push("  fn lmFirstOrCreate cls = (");
    out.push("    local found = undefined");
    out.push("    for o in objects where (classof o == cls) do ( found = o; exit )");
    out.push("    if found == undefined then found = cls()");
    out.push("    found");
    out.push("  )");
  }
  if (needLightOfType) {
    out.push("  fn lmVRayLightOfType t = (");
    out.push("    local found = undefined");
    out.push(
      "    for o in objects where ((classof o == VRayLight) and (o.type == t)) do ( found = o; exit )"
    );
    out.push("    if found == undefined then ( found = VRayLight(); found.type = t )");
    out.push("    found");
    out.push("  )");
  }
  // node locals, in a stable order (only the ones the setters below reference).
  for (const n of ["sun", "light", "plane", "dome", "cam"] as const) {
    if (nodes.has(n)) out.push(`  ${NODE_SETUP[n]}`);
  }
  // running tallies: every try/catch setter appends its param id to one of these.
  out.push("  local lmOk = #()   -- setters that landed");
  out.push("  local lmFail = #() -- setters this renderer/scene rejected (set by hand)");
  out.push("");
  // per value, in recipe order: real setter or fallback comment.
  for (const x of results) for (const line of x.lines) out.push(`  ${line}`);
  out.push("");
  out.push(
    `  if lmFail.count > 0 then ( format "LightMatch: applied %/% scripted value(s); these errored on THIS renderer/scene — set them by hand: %\\n" lmOk.count (lmOk.count + lmFail.count) (lmFail as string) ) else ( format "LightMatch: applied all % scripted value(s).\\n" lmOk.count )`
  );
  out.push(")");
  return out.join("\n");
}

// ---------------------------------------------------------------------------------
// toChecklist(recipe, target) — plain-text checklist for ANY target (the Vantage
// export path). One line per value:
//     [ ] <ui_path>  ->  <value><unit>   (<why>)
// ordered by the model's step (1-6, stable within a step; step-less values last),
// under the canonical step headers, with a baseline/hdri_mood header block.
// ---------------------------------------------------------------------------------
export function toChecklist(recipe: Recipe, target: TargetId | string): string {
  const values = safeValues(recipe);
  const r = (recipe || {}) as Partial<Recipe>;

  const out: string[] = [];
  out.push(`LightMatch checklist — ${targetLabel(target)}`);
  out.push(`baseline: ${baselineText(r)}`);
  if (oneLine(r.hdri_mood)) out.push(`hdri_mood: ${oneLine(r.hdri_mood)}`);

  if (values.length === 0) {
    out.push("");
    out.push("(recipe has no values)");
    return out.join("\n");
  }

  // stable step sort: finite steps ascending, anything unparseable sinks to the end
  // (explicit index tiebreak — don't lean on engine sort stability).
  const keyed = values.map((v, i) => ({
    v,
    i,
    step: typeof v.step === "number" && Number.isFinite(v.step) ? v.step : Infinity,
  }));
  keyed.sort((a, b) => (a.step === b.step ? a.i - b.i : a.step - b.step));

  let lastStep: number | null = null;
  for (const { v, step } of keyed) {
    if (step !== lastStep) {
      lastStep = step;
      out.push("");
      out.push(
        Number.isFinite(step)
          ? `Step ${step} — ${STEP_NAMES[step] || "(unnamed step)"}`
          : "Unstepped"
      );
    }
    const entry = PACKS.lookup(target, String(v.param));
    const uiPath = entry ? entry.ui_path : String(v.param);
    const why = oneLine(v.why);
    out.push(`[ ] ${uiPath}  ->  ${plainValueText(v.set, entry)}${why ? `   (${why})` : ""}`);
  }
  return out.join("\n");
}
