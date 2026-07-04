// LightMatch tool schemas, system prompts, and local (pre-network) validation for the
// model's structured output. Ported faithfully from the vanilla app (lightmatch.html).
// Depends only on PACKS (prompt fragment + clamp/lookup inside validateRecipe) — never
// on any adapter, engine, or the DOM.

import { PACKS } from "./packs";
import type { ToolSchema, ValidationResult, ModeName, TargetId } from "./types";

// -- emit_recipe: the full-analysis tool. Byte-fixed by the plan (Step 4.1) — do
// not restructure into the spec's grouped shape (environment/sun/fills[]/exposure/
// color_mapping/step_order[]); flat values[] with a per-value `step: 1..6` is the
// locked contract because it is far easier to validate parametrically and is
// information-equivalent (fill placement + key:fill ratio already live as
// kind:"placement" pack entries; step_order is redundant given the fixed order in
// the system prompt). Extended 2026-07-03: step max 5 -> 6 (atmosphere/weather) and
// values maxItems 24 -> 32 for the atmosphere packs — SELFTEST byte-match updated
// in lockstep. ---------------------------------------------------------------------
export const EMIT_RECIPE: ToolSchema = {
  name: "emit_recipe",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["baseline", "values", "rationale", "hdri_mood", "gi_notes", "status"],
    properties: {
      baseline: { type: "string", enum: ["factory_defaults", "settings_screenshot"] },
      hdri_mood: { type: "string", description: "One line: what HDRI to reach for" },
      values: {
        type: "array",
        minItems: 4,
        maxItems: 32,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["param", "set", "from", "step", "confidence", "why"],
          properties: {
            param: { type: "string", description: "MUST be an id from the provided pack" },
            set: { type: ["number", "string"] },
            from: { type: ["number", "string"] },
            step: { type: "integer", minimum: 1, maximum: 6 },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            why: { type: "string" },
          },
        },
      },
      rationale: { type: "string" },
      gi_notes: { type: "string" },
      status: { type: "string", enum: ["continue", "handoff_to_grade"] },
      status_reason: { type: "string" },
    },
  },
};

// -- emit_correction: the refine-round tool. Same value-object shape as
// emit_recipe.values[] (locked identically: param/step/confidence/why, integer
// step 1..6), but the array is `moves` (minItems 1, maxItems 5 — "small trims beat
// re-matching") and the value key is `to` (not `set`, since a correction targets an
// already-applied baseline rather than a fresh factory/screenshot one). Adds
// `applied_assumed: boolean` — true when the model had to assume every prior-round
// move was applied as recommended (the UI's per-row "applied" toggle can turn
// individual moves off; when that toggle state isn't available to the model, it
// must declare the assumption explicitly rather than silently guessing). ---------
export const EMIT_CORRECTION: ToolSchema = {
  name: "emit_correction",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["moves", "rationale", "status", "status_reason", "applied_assumed"],
    properties: {
      moves: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["param", "to", "from", "step", "confidence", "why"],
          properties: {
            param: { type: "string", description: "MUST be an id from the provided pack" },
            to: { type: ["number", "string"] },
            from: { type: ["number", "string"] },
            step: { type: "integer", minimum: 1, maximum: 6 },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            why: { type: "string" },
          },
        },
      },
      rationale: { type: "string" },
      status: { type: "string", enum: ["continue", "handoff_to_grade"] },
      status_reason: { type: "string" },
      applied_assumed: { type: "boolean" },
    },
  },
};

// -- systemPrompt(target, mode): full persona + contract text for one gateway call.
// mode: "recipe" (full analysis, emit_recipe) | "correction" (refine round,
// emit_correction). Deliberately target-agnostic in its own prose — every
// parameter specific, unit, range, or host quirk (e.g. "this sun has no kelvin
// spinner") comes from PACKS.promptFragment(target) appended at the end, never
// hardcoded here. That keeps this function identical in shape for every future
// pack (adding a host is a data task, per the spec's non-goals). -----------------
export function systemPrompt(target: TargetId | string, mode: ModeName | string): string {
  const isCorrection = mode === "correction";
  const lines: string[] = [];

  // BREVITY GUARD — the FIRST thing the model reads. Verified live 2026-07-04: on the real
  // rich metrics bundle (three 16-cell grids + percentiles) Opus over-reasons (25k-32k chars
  // of thinking) and blows BOTH the token budget (the JSON truncates) AND omega's ~100s
  // wall-clock ceiling (HTTP 500). A strong "reason briefly, the complete JSON matters more
  // than thorough analysis" directive halves the thinking (~6-15k chars / 26-62s) and turned
  // an intermittent failure into 5/5 complete recipes in testing.
  lines.push(
    "CRITICAL OUTPUT CONSTRAINT — READ FIRST: You have a STRICT, limited output budget and MUST emit " +
      "the COMPLETE JSON object described below. Reason VERY briefly — at most a few short sentences. Do NOT " +
      "narrate each metric one-by-one; identify the biggest gaps and move on — however you MUST check the " +
      "SPATIAL ASYMMETRY scalars / grid for a left-right or top-bottom imbalance and act on it (sun " +
      "azimuth/elevation or HDRI rotation) if present; spatial light placement is the most important match cue " +
      "and the easiest to miss. Emitting the full, valid JSON is far more important than thorough reasoning — if " +
      "you deliberate too long you WILL run out of space and the whole response will be discarded as a failure. " +
      "Keep all reasoning brief, then output the JSON object."
  );
  lines.push("");

  lines.push(
    "You are a lighting technical director (TD) — the same disciplined, surgical role you would play " +
      "grading a shot against a reference plate, now applied to matching a 3D render's LIGHTING to a reference " +
      "image before any color grade happens."
  );
  lines.push("");
  lines.push(
    "You do not measure. Measurements are provided to you as computed evidence — deterministic canvas " +
      "photometry run on both images before this prompt was assembled. Your job is to translate that evidence into " +
      "exact parameter moves in the target application's native vocabulary. Trust your eyes for direction, the " +
      "numbers for magnitude: the images tell you WHICH way something is wrong (warmer, brighter, softer shadows), " +
      "the measurements tell you HOW FAR to push it and confirm you are not chasing a false read."
  );
  lines.push("");
  lines.push(
    "Parameter discipline: choose ONLY parameter ids that appear in the pack listing below — never invent " +
      "a setting, never rename one, never describe a control the pack does not list. Every numeric value you set " +
      "must stay inside that parameter's stated range; the app will clamp and flag anything outside it, so get it " +
      "right the first time."
  );
  lines.push(
    "For V-Ray placement-kind controls (sun azimuth/elevation/kelvin — kind:\"placement\" because V-Ray has " +
      "no spinner for them), STATE AN EXPLICIT NUMERIC TARGET inside the instruction (e.g. 'azimuth ~110°, " +
      "elevation ~15°', '~5200 K') so each refine round has a number to nudge rather than vague prose."
  );
  lines.push("");
  lines.push(
    "Baseline convention: unless a settings screenshot is supplied, assume the target is at its FACTORY " +
      'DEFAULTS and declare baseline:"factory_defaults" — every `from` value is then that parameter\'s pack ' +
      "default. If a settings screenshot IS supplied, read the actual on-screen values from it and use those as " +
      '`from`, declaring baseline:"settings_screenshot" instead of assuming defaults.'
  );
  lines.push("");
  lines.push("Fixed step order — always move in this sequence, and tag every value's `step` field accordingly:");
  lines.push("  1. exposure/WB lock — camera or VFB exposure and white balance, decided and held first.");
  lines.push("  2. sun/key — the primary light's direction, intensity, and color.");
  lines.push("  3. dome/environment — HDRI or skylight fill, mood, and rotation.");
  lines.push("  4. fills/rim — secondary/artificial lights and their key:fill ratio.");
  lines.push("  5. color mapping — highlight burn, contrast, saturation, and any display-side correction.");
  lines.push(
    "  6. atmosphere/weather — fog, mist, haze, clouds, and any host-specific weather effects listed in " +
      "the pack: a mood layer matched to the reference's atmospheric depth."
  );
  lines.push(
    "Why this order is fixed, not a suggestion: doubling the sun's intensity and opening the camera by " +
      "+1 EV produce nearly the same pixels — it is a genuine degeneracy, not a matter of taste. Locking exposure " +
      "and WB FIRST removes that ambiguity before you touch the light itself; without a fixed order the refine " +
      'loop oscillates between "brighten the sun" and "open the camera" forever.'
  );
  lines.push(
    "If the target is Chaos Vantage 3.3, your step-1 exposure lock MUST include cam.auto_exposure = off — " +
      "with auto-exposure ON, Vantage ignores the camera Exposure Value and every EV move is silently discarded."
  );
  lines.push(
    "Warmth split — wb.warmthShadow and wb.warmthHighlight are INDEPENDENT: shadow warmth is driven by the " +
      "FILL / sky / dome / ambient color, highlight warmth by the KEY / sun color. When the reference has warm " +
      "highlights + cool shadows (or vice-versa) — common at golden hour — SPLIT the fix: set the sun/key color in " +
      "step 2 and the dome/ambient color in step 3/4. Do NOT try to satisfy both with a single global " +
      "white-balance move."
  );
  lines.push(
    "Atmosphere (step 6) is set only after the base is dialed — and because heavy fog or haze lifts " +
      "shadows and lowers contrast, re-confirm the exposure lock (step 1) after a large atmospheric change rather " +
      "than re-chasing the light."
  );
  lines.push("");
  lines.push(
    "Exactness goal: the user requires a ~99% match to the reference's lighting, not a pleasing " +
      "approximation. Be surgical, not tasteful — small, evidence-backed moves that close the measured gap beat " +
      "confident-sounding creative reinterpretation."
  );
  lines.push("");
  lines.push(
    "Full control set, surgical output: the pack listing below is the target's COMPLETE lighting " +
      "control set — every knob you are allowed to touch. It is deliberately exhaustive so you can find the exact " +
      "right control, not a licence to fill it in. Emit ONLY the moves that measurably close the gap; do not set a " +
      "control you are not deliberately changing, and never restate a control at its own default just to look " +
      "complete. The app renders the full panel for the user and shows every control you did not move at its held " +
      "default — so your job is the surgical delta, and a short, decisive recipe is the correct one."
  );
  lines.push(
    "Recipe completeness vs. surgical trims: the INITIAL recipe (from factory defaults) should be " +
      "COMPLETE — cover every dimension that shows a measured gap (typically 8-14 moves: exposure/WB, sun " +
      "direction+intensity+color, dome/HDRI+rotation, fills, highlight-burn/contrast/saturation, atmosphere). " +
      "Only CORRECTIONS in the refine loop are surgical 3-5-move trims. Reason briefly either way — 'reason " +
      "briefly' caps your NARRATION, not the number of moves the initial recipe needs to close every gap."
  );

  if (isCorrection) {
    lines.push("");
    lines.push(
      "CORRECTION ROUND (refine mode): you are looking at an attempt that was rendered from a prior " +
        "recipe or correction, not a blank slate. The full move history from every previous round is provided to " +
        "you, along with which of those moves the user actually applied. Return a correction card, not a new " +
        "recipe: 3-5 moves max, each prioritized by how much of the remaining measured gap it closes. Small trims " +
        "beat re-matching from scratch."
    );
    lines.push(
      "Oscillation guard: never reverse a prior move by more than half its distance from its own " +
        "`from` value — if round 2 pushed sun.kelvin from 6500 to 5000 (a move of 1500), round 3 may pull it back " +
        "toward 6500 by at most 750. If you see a metric ping-pong across rounds (it improves, then reverses, then " +
        "improves again), do not keep chasing it — name the exposure/light degeneracy to the user directly in " +
        "`status_reason` instead, so they understand why the number is not settling."
    );
    lines.push(
      'Know when to stop — NARROW handoff: declare status:"handoff_to_grade" ONLY when the residual is a ' +
        "PURELY GLOBAL chromatic offset (a uniform tint / saturation shift) AND the spatial grid + luminance " +
        "structure ALREADY match. Contrast (contrast.spread / contrast.midSlope) and a warm-highlight/cool-shadow " +
        "SPLIT are NOT grade problems — they have physical lighting levers (contrast = key:fill ratio + sun " +
        "size/softness; warmth split = key color vs fill/dome color), so fix them here, do not hand them off. " +
        "Only when what remains is a single global color cast over an already-matched light layout does further " +
        "re-rendering stop helping — that last bit is a color grade and belongs to a grading tool, not this loop."
    );
  }

  // Output-format directive (both modes). The omega gateway's tool path is BROKEN — a
  // forced tool_choice returns HTTP 500 (empty body) and even `tools` with no tool_choice
  // 500s (verified 2026-07-04 against the live gateway; plain text calls succeed at both
  // 4096 and 8192 tokens on every model). So the route sends NO tools at all, and the
  // model's ONLY way to convey structured output is raw JSON in its text. This directive
  // makes that the sole, explicit contract and embeds the exact JSON Schema (the same one
  // the tool used to enforce) so the model has the precise shape. The route parses the
  // object out with parseJsonFromText and validates it with validateRecipe.
  lines.push("");
  const schema = isCorrection ? EMIT_CORRECTION : EMIT_RECIPE;
  const jsonWord = isCorrection ? "correction" : "recipe";
  lines.push(
    `OUTPUT FORMAT — READ THIS LAST AND OBEY IT EXACTLY. Your entire reply MUST be a single raw JSON ` +
      `object that is a valid instance of this JSON Schema (the ${jsonWord}):`
  );
  lines.push(JSON.stringify(schema.input_schema));
  lines.push(
    "Output ONLY that JSON object: NO analysis, NO explanation, NO prose, NO commentary, NO markdown, " +
      "NO ``` code fences, and nothing whatsoever before or after it. Your entire reply must begin with the " +
      "character `{` and end with the character `}` — the very first character you output is `{`. Do not " +
      "narrate your reasoning; put any justification inside the JSON's own `rationale`/`why` fields, never " +
      "outside the object. Any text outside the JSON object will be discarded and will cause the response to " +
      "be rejected."
  );

  lines.push("");
  lines.push(PACKS.promptFragment(target));

  return lines.join("\n");
}

// -- validateRecipe(obj, target, mode): local (pre-network) validation of a
// model-returned tool call, before it ever reaches the UI. Handles BOTH shapes with
// one function rather than two near-duplicate validators — recipe (`values[]`,
// `set`) is the default when `mode` is omitted, `mode:"correction"` switches to
// `moves[]`/`to`. Returns {ok, errors[], cleaned}:
//   - unknown `param` (not in the target pack)      -> ERROR (value/move dropped from cleaned, ok:false)
//   - non-finite numeric `set`/`to` (NaN/Infinity)   -> ERROR (never let it into cleaned; PACKS.clamp alone does
//                                                        NOT catch this — it passes non-finite numbers through
//                                                        unflagged by design, so this check is done HERE, first)
//   - numeric `set`/`to` outside the pack's range    -> WARNING only: PACKS.clamp clamps it into range and the
//                                                        cleaned value/move carries `clamped:true`; ok stays true
//   - `step` outside the integer range 1..6          -> ERROR
//   - string `set`/`to` (dropdown/slot/placement)    -> passed through untouched, never flagged clamped
// `cleaned` always has the same top-level shape as `obj` (values[] or moves[]), with
// per-item `clamped` added where applicable; items that hit an ERROR are dropped
// from cleaned so nothing invalid can flow downstream even if a caller ignores `ok`.
export function validateRecipe(
  obj: unknown,
  target: TargetId | string,
  mode?: ModeName | string
): ValidationResult {
  const isCorrection = mode === "correction";
  const arrKey = isCorrection ? "moves" : "values";
  const valKey = isCorrection ? "to" : "set";
  const errors: string[] = [];

  const source = (obj || {}) as Record<string, unknown>;
  const cleaned: Record<string, unknown> = Object.assign({}, source);
  const rawArr = source[arrKey];
  const items = Array.isArray(rawArr) ? (rawArr as Record<string, unknown>[]) : [];
  const cleanedItems: Record<string, unknown>[] = [];

  // Blank/partial-recipe rejection (#4a): a `{}` / `{values:[]}` / a response
  // truncated so its move array never arrived must NOT read as a successful empty
  // recipe. Reject when the value/move array is absent or empty, and when any
  // top-level field the tool schema marks `required` is missing. Because validate
  // now returns ok:false here, ADAPTER.call's one-shot re-ask handles the empty
  // case the same way it handles any other invalid emit.
  if (!Array.isArray(rawArr) || (rawArr as unknown[]).length === 0) {
    errors.push(
      `"${arrKey}" is absent or empty — an emit must carry at least one ${isCorrection ? "move" : "value"}`
    );
  }
  const schema = isCorrection ? EMIT_CORRECTION : EMIT_RECIPE;
  const required = (schema && schema.input_schema && schema.input_schema.required) || [];
  for (const field of required) {
    if (field === arrKey) continue; // the array is checked (presence + non-empty) just above
    if (!obj || !(field in source)) errors.push(`missing required field "${field}"`);
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const where = `${arrKey}[${i}]`;
    if (!item || typeof item.param !== "string") {
      errors.push(`${where}: missing or non-string "param"`);
      continue;
    }
    const entry = PACKS.lookup(target, item.param as string);
    if (!entry) {
      errors.push(`${where}: unknown param "${item.param}" — not in pack "${target}"`);
      continue;
    }
    const step = item.step;
    if (typeof step !== "number" || !Number.isInteger(step) || step < 1 || step > 6) {
      errors.push(`${where} (${item.param}): "step" must be an integer 1..6, got ${JSON.stringify(step)}`);
      continue;
    }

    const rawVal = item[valKey];
    const outItem: Record<string, unknown> = Object.assign({}, item);
    if (typeof rawVal === "number") {
      // Carry-forward fix (mandatory, Task 2 review): PACKS.clamp passes non-finite
      // numbers through UNFLAGGED — a NaN/Infinity `set`/`to` must be rejected here,
      // before clamp ever sees it, or it silently reaches `cleaned`.
      if (!Number.isFinite(rawVal)) {
        errors.push(`${where} (${item.param}): non-finite numeric "${valKey}" (${String(rawVal)}) — rejected`);
        continue;
      }
      const clampResult = PACKS.clamp(target, item.param as string, rawVal);
      outItem[valKey] = clampResult.value;
      outItem.clamped = clampResult.clamped;
    } else {
      // string (dropdown/slot/placement kinds): pass through untouched, unflagged.
      outItem.clamped = false;
    }
    cleanedItems.push(outItem);
  }

  cleaned[arrKey] = cleanedItems;
  return { ok: errors.length === 0, errors, cleaned };
}

// The SCHEMAS object mirrors the vanilla source's single namespace, so callers can use
// either the named exports above or SCHEMAS.emit_recipe / SCHEMAS.systemPrompt(...).
export const SCHEMAS = {
  emit_recipe: EMIT_RECIPE,
  emit_correction: EMIT_CORRECTION,
  systemPrompt,
  validateRecipe,
};

export default SCHEMAS;
