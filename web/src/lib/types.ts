// LightMatch shared types.
// Ported faithfully from the vanilla single-file app (lightmatch.html). These
// interfaces describe the data shapes that packs.ts / metrics.ts / schemas.ts
// operate on. Pure TS — no React, no DOM.

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

/** The two shipped target renderers. */
export type TargetId = "vray7max" | "vantage33";

/** Kind of UI control a pack entry maps to. */
export type PackKind =
  | "checkbox"
  | "spinner"
  | "dropdown"
  | "color"
  | "slot"
  | "placement"
  | "text";

/** A pack entry `default` is either a numeric value or a string token
 *  (dropdown option, "on"/"off", a color name, a placement instruction). */
export type PackDefault = number | string;

/** Inclusive `[min, max]` numeric range. `[0, 0]` (min === max) means the
 *  entry has no meaningful numeric range (checkbox/dropdown/color/slot). */
export type Range = [number, number];

/** One control in a target pack. Every entry carries all ten fields. */
export interface PackEntry {
  id: string;
  ui_path: string;
  group: string;
  kind: PackKind | string;
  unit: string;
  range: Range;
  default: PackDefault;
  /** true when the vision model may set this control to match lighting;
   *  false = display-only completeness control the model must NOT emit. */
  lighting: boolean;
  verified: string;
  notes: string;
}

/** A single target pack: a label plus its ordered entries. `_index` is a lazy
 *  id->entry cache built by PACKS.lookup (mirrors the vanilla source). */
export interface TargetPack {
  label: string;
  entries: PackEntry[];
  _index?: Record<string, PackEntry>;
}

/** Result of PACKS.clamp: the (possibly clamped) value and whether clamping
 *  actually changed it. */
export interface ClampResult {
  value: PackDefault;
  clamped: boolean;
}

/** One group of the panel-ordered settings sheet (PACKS.sheet). */
export interface SheetGroup {
  group: string;
  entries: PackEntry[];
}

/** The PACKS object: the two packs keyed by TargetId plus the helper methods. */
export interface Packs {
  vray7max: TargetPack;
  vantage33: TargetPack;
  targets(): TargetId[];
  lookup(target: TargetId | string, id: string): PackEntry | null;
  clamp(target: TargetId | string, id: string, value: unknown): ClampResult;
  promptFragment(target: TargetId | string): string;
  sheet(target: TargetId | string): SheetGroup[];
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Mean linear r,g,b over a tonal region (shadow or highlight quartile set). */
export interface RgbMean {
  r: number;
  g: number;
  b: number;
}

/** Luminance percentiles (bin-center values, 0..1) plus the mean. */
export interface LumStats {
  p1: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  mean: number;
}

/** Fraction of pixels clipped high / low (0..1). */
export interface ClipStats {
  hi: number;
  lo: number;
}

/** Contrast descriptors derived from the luminance percentiles. */
export interface ContrastStats {
  spread: number;
  midSlope: number;
}

/** White-balance descriptors: per-region mean linear channels plus warmth /
 *  tint scalars. */
export interface WbStats {
  shadow: RgbMean;
  highlight: RgbMean;
  warmthShadow: number;
  warmthHighlight: number;
  tint: number;
}

/** Saturation descriptors. */
export interface SatStats {
  mean: number;
  p95: number;
}

/** The full deterministic photometry vector for one image. */
export interface MetricVector {
  lum: LumStats;
  clip: ClipStats;
  contrast: ContrastStats;
  wb: WbStats;
  sat: SatStats;
  /** 4x4 grid of mean linear luminance per cell, row-major (16 values). */
  grid: number[];
}

/** Flat diff between two metric vectors (b - a per scalar), keyed by
 *  dotted-path strings such as "lum.p50", "wb.tint", "grid.7". */
export type MetricDiff = Record<string, number>;

/** Result of METRICS.downscaleForSend / measure helpers that produce a data URL. */
export interface DownscaleResult {
  dataUrl: string;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Schemas / recipe
// ---------------------------------------------------------------------------

export type ModeName = "recipe" | "correction";

export type Confidence = "high" | "medium" | "low";

export type RecipeStatus = "continue" | "handoff_to_grade";

export type RecipeBaseline = "factory_defaults" | "settings_screenshot";

/** One value in an emit_recipe response (uses `set`). */
export interface RecipeValue {
  param: string;
  set: number | string;
  from: number | string;
  step: number;
  confidence: Confidence | string;
  why: string;
  /** Added by validateRecipe when a numeric value was clamped into range. */
  clamped?: boolean;
}

/** One move in an emit_correction response (uses `to`). */
export interface RecipeMove {
  param: string;
  to: number | string;
  from: number | string;
  step: number;
  confidence: Confidence | string;
  why: string;
  /** Added by validateRecipe when a numeric value was clamped into range. */
  clamped?: boolean;
}

/** An emit_recipe tool result (full analysis). */
export interface Recipe {
  baseline: RecipeBaseline | string;
  hdri_mood: string;
  values: RecipeValue[];
  rationale: string;
  gi_notes: string;
  status: RecipeStatus | string;
  status_reason?: string;
}

/** An emit_correction tool result (refine round). */
export interface Correction {
  moves: RecipeMove[];
  rationale: string;
  status: RecipeStatus | string;
  status_reason: string;
  applied_assumed: boolean;
}

/** JSON-schema tool definition shape (emit_recipe / emit_correction). Kept
 *  loose (the exact object is data, byte-fixed by the vanilla plan). */
export interface ToolSchema {
  name: string;
  strict: boolean;
  input_schema: {
    type: "object";
    additionalProperties: false;
    required: string[];
    properties: Record<string, unknown>;
  };
}

/** Result of validateRecipe. `cleaned` mirrors the input's top-level shape
 *  (values[] or moves[]) with invalid items dropped and `clamped` flags added. */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  cleaned: Record<string, unknown>;
}
