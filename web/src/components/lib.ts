// UI-side pure helpers + constants for the LightMatch React components. These mirror
// the vanilla UI module's pure pieces (MODELS, acceptsFile, safeSrc, buildSheet,
// buildSheetText, routePaste, isRecipeApplied) — kept as one testable module the
// components import. No engine logic is reimplemented here; buildSheet reads through
// the pack scaffold exactly as the vanilla source did.

import { STORE } from "@/lib/store";
import { PACKS } from "@/lib/packs";
import type { Recipe, Correction, TargetId, SheetGroup } from "@/lib/types";
import type { EngineState } from "@/store/useEngine";

// -- The two gateway model options (verbatim from the vanilla UI.MODELS). ----------
export const MODELS = [
  { value: "claude-opus-4-8", label: "Opus 4.8" },
  { value: "gpt-5.5", label: "GPT-5.5" },
] as const;

// -- Target renderer labels for the header toggle. --------------------------------
export const TARGETS = [
  { value: "vray7max", label: "V-Ray 7" },
  { value: "vantage33", label: "Vantage 3.3" },
] as const;

// -- Named input slots (Reference, Base render, Settings screenshot). --------------
export const SLOT_DEFS = [
  { key: "ref", label: "Reference", hint: "the look you want" },
  { key: "base", label: "Base render", hint: "your render now" },
  { key: "settings", label: "Settings screenshot", hint: "optional anchor" },
] as const;

// -- Context chips. The FULL time-of-day set the user asked for (single-select). ---
export const CHIP_GROUPS = [
  { key: "scene", label: "Scene", options: ["interior", "exterior", "product"] },
  {
    key: "time",
    label: "Time",
    options: [
      "dawn",
      "sunrise",
      "morning",
      "midday",
      "afternoon",
      "golden hour",
      "sunset",
      "dusk",
      "blue hour",
      "night",
    ],
  },
  { key: "rig", label: "Rig", options: ["HDRI dome", "sun", "both"] },
] as const;

// -- Step vocabulary (the model's fixed order; canonical human names). -------------
export const STEP_HEADERS: Record<number, string> = {
  1: "Lock exposure & white balance",
  2: "Sun / key",
  3: "Environment / dome",
  4: "Fills & rim",
  5: "Color mapping",
  6: "Atmosphere / weather",
};

// -- File accept: the three canvas-decodable types PLUS EXR (decoded + developed
// client-side). EXR carries an empty MIME in every browser, so it is matched by the
// .exr filename extension here (the store additionally verifies the EXR magic bytes
// before decoding). The reject message now names only the genuinely-unsupported
// formats and notes EXR is developed automatically. -------------------------------
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
// EXR MIME is inconsistent/empty across browsers; accept these if a file ever reports one.
export const EXR_TYPES = ["image/x-exr", "image/aces", "image/exr"];
export const REJECT_MESSAGE =
  "LightMatch reads PNG, JPG, or WebP from the VFB/Vantage — or a linear EXR, which is developed to a viewable exposure automatically. Formats like HEIC, TIFF, or PSD aren't supported; export one of those instead.";

/** True if a filename ends in .exr (case-insensitive). Mirrors lib/exr hasExrExtension,
 *  kept local so this pure UI helper has no client-only import. */
export function isExrName(name: string | null | undefined): boolean {
  return typeof name === "string" && /\.exr$/i.test(name.trim());
}

export function acceptsFile(
  file: { type?: string; name?: string } | null | undefined
): { ok: boolean; reason: string } {
  const type = (file && file.type) || "";
  const name = (file && file.name) || "";
  if (ACCEPTED_TYPES.includes(type)) return { ok: true, reason: "" };
  if (EXR_TYPES.includes(type) || isExrName(name)) return { ok: true, reason: "" };
  return { ok: false, reason: REJECT_MESSAGE };
}

// -- safeSrc: only a clean base64 image data URL reaches an <img src>. Reuses the
// STORE regex so the sink and the import boundary can never diverge. --------------
export function safeSrc(u: unknown): string {
  return typeof u === "string" && STORE.DATAURL_RE.test(u) ? u : "";
}

// -- isRecipeApplied: checked unless the chain explicitly records false. -----------
export function isRecipeApplied(
  chain: { recipeApplied?: Record<string, boolean> | null } | null,
  param: string
): boolean {
  return !(chain && chain.recipeApplied && chain.recipeApplied[param] === false);
}

// -- routePaste: pure paste/drop routing (verbatim logic from the vanilla source). -
export function routePaste(
  state: EngineState,
  focusedSlot: string | null,
  filled: { ref: boolean; base: boolean; settings: boolean }
): "ref" | "base" | "settings" | "attempt" | null {
  const midSession =
    (state === "analyzed" || state === "refining") && !!filled.ref && !!filled.base;
  if (focusedSlot === "attempt") return "attempt";
  if (focusedSlot) {
    const focusedIsEmptyNamed = filled[focusedSlot as "ref" | "base" | "settings"] === false;
    if (focusedIsEmptyNamed) return focusedSlot as "ref" | "base" | "settings";
    if (!midSession) return focusedSlot as "ref" | "base" | "settings";
  }
  if (!filled.ref) return "ref";
  if (!filled.base) return "base";
  if (!filled.settings) return "settings";
  if (state === "analyzed" || state === "refining") return "attempt";
  return null;
}

// -- cached pack scaffold per target. PACKS.sheet(target) is pure/deterministic but
// builds a fresh array each call; caching it gives a STABLE reference so it can be
// used directly in a zustand selector without looping useSyncExternalStore. --------
const _scaffoldCache = new Map<string, SheetGroup[]>();
export function sheetForTarget(target: TargetId | string): SheetGroup[] {
  const key = String(target);
  let s = _scaffoldCache.get(key);
  if (!s) {
    s = PACKS.sheet(target);
    _scaffoldCache.set(key, s);
  }
  return s;
}

// -- A single sheet row: the completeness unit (shape stable whether changed or held).
export interface SheetRow {
  group: string;
  param: string;
  ui_path: string;
  kind: string;
  unit: string;
  lighting: boolean;
  value: number | string;
  isChanged: boolean;
  from?: number | string;
  confidence?: string;
  why?: string;
  clamped: boolean;
  applied: boolean | null;
}

// -- buildSheet(target, recipe, chain): the COMPLETE settings sheet as flat ordered
// rows. Walks PACKS.sheet(target) (via a passed scaffold) and emits one row per
// control — changed rows carry the move, held rows carry the pack default. Pure. ---
export function buildSheet(
  scaffold: SheetGroup[],
  recipe: Recipe | Correction | null | undefined,
  chain: { recipeApplied?: Record<string, boolean> | null } | null
): SheetRow[] {
  const r = (recipe || {}) as Partial<Recipe & Correction>;
  const isCorrection = Array.isArray(r.moves);
  const moves = (isCorrection ? r.moves! : Array.isArray(r.values) ? r.values : []) as unknown as Record<
    string,
    unknown
  >[];
  const valKey = isCorrection ? "to" : "set";
  const byParam = new Map<string, Record<string, unknown>>();
  for (const m of moves) {
    if (m && typeof m.param === "string" && !byParam.has(m.param)) byParam.set(m.param, m);
  }
  const rows: SheetRow[] = [];
  for (const band of scaffold) {
    for (const e of band.entries) {
      const move = byParam.get(e.id) || null;
      if (move) {
        rows.push({
          group: band.group,
          param: e.id,
          ui_path: e.ui_path,
          kind: e.kind,
          unit: e.unit || "",
          lighting: e.lighting === true,
          value: move[valKey] as number | string,
          isChanged: true,
          from: move.from as number | string,
          confidence: move.confidence as string,
          why: move.why as string,
          clamped: !!move.clamped,
          applied: isCorrection ? true : isRecipeApplied(chain, e.id),
        });
      } else {
        rows.push({
          group: band.group,
          param: e.id,
          ui_path: e.ui_path,
          kind: e.kind,
          unit: e.unit || "",
          lighting: e.lighting === true,
          value: e.default,
          isChanged: false,
          clamped: false,
          applied: null,
        });
      }
    }
  }
  return rows;
}

// -- buildSheetText(target, recipe, chain): human-readable copy of the full sheet. --
export function buildSheetText(
  target: TargetId | string,
  scaffold: SheetGroup[],
  recipe: Recipe | null | undefined,
  chain: { recipeApplied?: Record<string, boolean> | null } | null
): string {
  const pack = (PACKS as unknown as Record<string, { label: string } | undefined>)[target];
  const label = pack ? pack.label : String(target);
  const r = (recipe || {}) as Partial<Recipe>;
  const lines = [`${label} — LightMatch settings sheet`];
  const baselineText =
    r.baseline === "settings_screenshot" ? "settings screenshot" : "factory defaults";
  lines.push(`baseline: ${baselineText}`);
  const rows = buildSheet(scaffold, recipe, chain);
  const order: string[] = [];
  const byGroup = new Map<string, SheetRow[]>();
  for (const row of rows) {
    if (!byGroup.has(row.group)) {
      byGroup.set(row.group, []);
      order.push(row.group);
    }
    byGroup.get(row.group)!.push(row);
  }
  for (const group of order) {
    const groupRows = byGroup.get(group)!;
    const changed = groupRows.filter((row) => row.isChanged).length;
    lines.push("");
    lines.push(`${group}  (${changed} changed · ${groupRows.length} total)`);
    for (const row of groupRows) {
      const unit = row.unit && typeof row.value === "number" ? row.unit : "";
      const isPlacement = row.kind === "placement";
      if (!row.isChanged) {
        lines.push(`· ${row.ui_path}: ${row.value}${unit}`);
      } else if (isPlacement) {
        const why = row.why ? ` — ${row.why}` : "";
        lines.push(`→ ${row.ui_path}: ${row.value}${why}`);
      } else {
        const why = row.why ? ` — ${row.why}` : "";
        lines.push(`→ ${row.ui_path}: ${row.value}${unit} (from ${row.from})${why}`);
      }
    }
  }
  return lines.join("\n");
}

// -- clipboard copy with a file:// fallback (navigator.clipboard is often blocked
// off-https). Never throws past the caller. ---------------------------------------
export async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    /* clipboard failure is a minor annoyance, not a crash */
  }
}

// -- split a verbatim ui_path into breadcrumb segments (last = leaf). --------------
export function splitPath(uiPath: string): { segs: string[]; leaf: string } {
  const parts = String(uiPath).split(" ▸ ");
  const leaf = parts.pop() || uiPath;
  return { segs: parts, leaf };
}
