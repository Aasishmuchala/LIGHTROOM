# LightMatch — design spec

- **Date:** 2026-07-02
- **Status:** Approved by user in brainstorm (4 sections + 2 amendments), pre-implementation
- **Repo:** `C:\Users\aasis\lightmatch`

## What it is

A single-file local web app (`lightmatch.html`) that matches a V-Ray render's lighting to a reference image. The user drops in a **reference** (the look they want) and their **base render**, picks a target — **V-Ray 7 for 3ds Max** or **Chaos Vantage 3.3** — and gets back a lighting recipe expressed in that target's *exact native settings vocabulary*, every value anchored to a declared baseline. They re-render, drop the attempt back in, and get a small prioritized correction card plus an objective convergence score — repeating until the lighting is close enough that the remaining gap is a color grade (at which point the app says so explicitly and hands off to REFGRADE).

Design pattern: **split-brain** (proven in the user's REFGRADE plugin). The browser *measures* both images with deterministic canvas code; the model *translates* that evidence into parameter moves. The model is never asked to be a light meter.

## User-stated requirements

1. **Exact settings.** Recipes must use the exact settings of V-Ray 7 and Chaos Vantage 3.3 — verbatim UI names, panel paths, units, and legal ranges. No paraphrase, no generic advice.
2. **Analyze for either, per run.** The user chooses the target per analysis; the same session can be re-analyzed for the other target with one click (images and measurements are reused).
3. **Model wiring:** hardcoded omega gateway (`https://omega.kesarcloud.in/v1`) with a model picker offering **Opus 4.8** and **GPT-5.5** (exact model IDs read from the gateway at build time).
4. **Baked-in knowledge.** The app itself carries the full relevant settings universe for both targets ("target packs"). No mandatory per-run settings input. An optional settings screenshot can serve as a baseline anchor.
5. **Personal tool first.** Built for the user's own archviz workflow. No server, no build step, no telemetry. Images never leave the browser except inside the model call.
6. **The refine loop is first-class** — it is the product's real value, not an afterthought.

## Non-goals (v1)

- No material, texture, or composition advice. Scope is lighting, camera exposure, and color mapping only.
- No other hosts (Maya, SketchUp, Corona, UE). The pack architecture must make adding one a data task, not a code task.
- No streaming responses, no multi-user features, no key management beyond one pasted key.
- The convergence score is a measurement-distribution distance, not a perceptual-taste metric, and the UI must not imply otherwise.

## Architecture

One self-contained file, `lightmatch.html` (same pattern as the user's `camera-planner.html`): all CSS, JS, and both target packs inline. Opens from disk.

Four internal modules with hard boundaries:

| Module | One job | Depends on |
|---|---|---|
| `ui` | Drop zones, context pickers, recipe/correction card rendering, session strip | `engine` only (pack display strings — `ui_path`, units — arrive through `engine`'s lookup API) |
| `metrics` | Canvas photometry: image → measurement vector; vector diffs. Pure functions, no DOM, no network | nothing |
| `packs` | Data: V-Ray 7 (Max) and Vantage 3.3 parameter universes + prompt-fragment builder | nothing |
| `engine` | Orchestration: image downscale, prompt assembly, gateway call, schema validation, session state | `metrics`, `packs` |

**Call path:** images downscaled client-side to ≤1568 px long edge (JPEG ~85%) → `metrics` measures reference, base, and attempts → `engine` assembles one Anthropic-Messages request: system prompt (lighting-TD persona + chosen target pack + baseline convention + step-order rule), user content (images + computed evidence + scene context) → POST to the omega gateway, `oc_` key as Bearer, **non-streaming** → response forced through a single `emit_recipe` (or `emit_correction`) tool with a strict JSON schema → `ui` renders the card.

**Persistence:** API key + model choice + target preference in `localStorage`. The working session (images, metric vectors, recipes, corrections) persists to **IndexedDB** and auto-restores on load — refine loops span 20-minute re-renders, and an accidental F5 must not destroy the session. `localStorage`'s ~5 MB cap cannot hold the images.

## Target packs

The packs are the app's core content asset and the mechanism that guarantees requirement 1.

**Exactness by construction:** the model may only return *parameter IDs and values*. Display names, panel paths, and units are rendered from pack data keyed by those IDs — never from model prose. The app is structurally incapable of showing a setting name that does not exist in V-Ray 7 or Vantage 3.3. Values are range-checked against the pack before display; out-of-range values are clamped and flagged.

Each pack is a JSON constant of ~25–35 entries (only what a lighting recipe touches), one per parameter:

```json
{ "id": "sun.kelvin",
  "ui_path": "VRaySun ▸ Modify panel ▸ Sun parameters ▸ Color temperature",
  "kind": "spinner",
  "unit": "K", "range": [1000, 20000], "default": 5777,
  "notes": "Active only when color mode = Temperature" }
```

- `kind` distinguishes `spinner | dropdown | slot | placement`. Some "parameters" are placements, not spinners (e.g. sun direction in Max is set by moving the sun/compass or via Daylight-system azimuth/elevation fields); pack entries carry the honest mechanism and the recipe renders placement instructions accordingly.
- Groups per pack: environment/dome (HDRI slot, intensity multiplier, rotation, tint), sun, artificial fills (VRayLight plane/sphere basics), camera & exposure (VRayPhysicalCamera ISO/shutter/f-number/WB for Max; Vantage's exposure and WB controls), color mapping / VFB (highlight burn, contrast, saturation), GI character notes.
- Every entry carries a `verified` date. **At build time each pack is grounded against current Chaos documentation** (V-Ray 7.x for 3ds Max help, Vantage 3.3 release docs), not model memory. Pack verification is a named implementation task with its own checklist.

## Measurement engine (`metrics`)

Computed per image (plain canvas, no libraries):

- Linearized luminance percentiles p1, p5, p25, p50, p75, p95, p99 and mean (sRGB → linear approximation).
- Clipped highlights (% pixels ≥ 250/255) and crushed shadows (% ≤ 5/255).
- Contrast: p95−p5 spread and midtone slope.
- White-balance split: mean R,G,B of the shadow quartile vs the highlight quartile → warm/cool delta (expressed as an approximate Kelvin direction) and green–magenta tint direction. This is the strongest lighting "tell".
- Saturation mean and p95.
- A 4×4 luminance grid (coarse evidence for where light enters the frame).

For any two images the engine computes a **diff vector** — e.g. "reference shadows are +14% lifted and ~400 K warmer than base" arrives in the prompt as computed fact, not something the model eyeballed.

**Known limitation (accepted):** metrics are content-blind. A white-marble reference against a wood-interior base skews the warmth read. The prompt therefore presents metrics as *evidence* and instructs the model to arbitrate with its eyes ("trust your eyes for direction, the numbers for magnitude").

## Analysis contract

- **System prompt:** lighting-TD persona in the REFGRADE mold. Core instruction: *you do not measure — measurements are provided; you translate evidence into moves in exact target vocabulary, choosing only parameter IDs from the provided pack, with values inside their legal ranges.*
- **Inputs:** reference + base images, both metric vectors + diff, target pack, scene context (interior/exterior/product; time of day; available rig: HDRI dome / sun / both), optional settings screenshot (if present, model reads it and it becomes the declared baseline instead of factory defaults).
- **Output — `emit_recipe` strict schema:** `environment`, `sun`, `fills[]` (role fill/rim, placement description, key:fill ratio), `exposure`, `color_mapping`, `gi_notes`, `rationale`, `step_order[]`. Every value is an object: `{ param: "<pack id>", set: <value>, from: <baseline value>, confidence: "high"|"medium"|"low", why: "<one line>" }`.
- **Baseline convention:** recipe declares `baseline: "factory_defaults" | "settings_screenshot"`; the UI renders every value as "set X *(from Y)*".
- **Fixed step order (degeneracy rule):** ① lock exposure & WB → ② sun/key → ③ dome/environment → ④ fills & rim → ⑤ color mapping. Rationale: doubling sun intensity and opening the camera +1 EV produce nearly identical pixels; without a fixed order the refine loop oscillates between "brighten sun" and "darken camera".

## Refine loop

- **Session model:** one session = reference + base + context + **per-target attempt chains**. Each attempt stores its image, metric vector, and the recipe/corrections that produced it. Switching target (or one-click re-analyze) produces a fresh recipe for the new target and starts that target's own chain; the session strip always shows the active target's chain. Session strip renders the chain with a score under each thumbnail.
- **Convergence score:** weighted, normalized distance between attempt and reference metric vectors (luminance/contrast weighted heaviest, saturation lightest), shown as 0–100 "look distance" with a trend arrow. Honest caveat inherited from REFGRADE verbatim: *trust your eyes first, the numbers second.* Its one job: answer "did that round move me closer?"
- **Correction rounds:** on attempt N the model receives reference + attempt images, the computed diff, full move history, and which steps the user applied. It returns a **correction card, not a new recipe**: 3–5 prioritized moves max, each `{param, from, to, why}` referencing pack IDs. Small trims beat re-matching.
- **Oscillation guard:** prompt includes the last two rounds of moves plus the rule: never reverse a prior move by more than half; if a metric ping-pongs, name the exposure/light degeneracy to the user instead of chasing it.
- **Handoff criterion:** when the score plateaus and the residual diff is dominated by chromatic/tonal terms rather than luminance-structure terms, the model must declare it. The `emit_correction` schema carries `status: "continue" | "handoff_to_grade"` plus a one-line reason; the UI renders the handoff state ("lighting is within noise of the reference — the rest is a grade; take it to REFGRADE") from this **structured field, never by parsing prose**. Knowing when to stop re-rendering is a feature.

## UI

Two-column layout inside one window (mockup approved in brainstorm):

- **Left (inputs):** three slots — Reference, Base render, Settings screenshot (optional, labeled as anchor) — all accepting drag-drop **and Ctrl+V paste** (paste is the primary path; it routes to the focused slot — click a slot to focus — else to the first empty slot in Reference → Base → Settings order, and to a **new attempt** once the session is active); context chips; target toggle (V-Ray 7 | Vantage 3.3); model picker (Opus 4.8 / GPT-5.5); key status; Analyze button; the line "Images stay in your browser. One call goes to your gateway."
- **Right (recipe card):** grouped by the five fixed steps. Each row: verbatim `ui_path` from the pack as the primary label, value with "(from baseline)", confidence dot, per-row copy (copies "VRaySun ▸ … ▸ Color temperature → 4300 K"), and an **applied** toggle (default on) — untoggle anything you skipped; correction calls receive the applied set. Header: copy-sheet (human text) and copy-JSON buttons, plus a one-click **"Re-analyze for Vantage 3.3 / V-Ray 7"** action reusing the session. Rationale foldout below the rows.
- **Bottom (session strip):** reference thumb + attempt thumbs with scores and trend; plateau state renders the REFGRADE handoff message.
- Dropping a new render into an active session automatically enters refine mode (correction card instead of full recipe).
- A fixed hint near the attempt slot: **"same VFB display settings every attempt"** — changed display correction between attempts makes metrics compare apples to oranges.
- Expected inputs are display-referred sRGB (VFB/Vantage screenshots or saves as PNG/JPG), not linear EXR.
- Visual design: dark pro-tool aesthetic; final styling applies the user's standing design-taste requirement (taste-skill / impeccable) at build time.

## Model adapter

- Endpoint hardcoded: `https://omega.kesarcloud.in/v1/messages`, Anthropic Messages wire format, `oc_` key sent as Bearer (`Authorization: Bearer`, not `x-api-key`).
- Non-streaming always (recipes are 1–2 k tokens; the user's Anthropic-wire proxies have streaming quirks; nothing to gain).
- Model picker: Opus 4.8 and GPT-5.5. Exact model ID strings are read from the gateway's model list during implementation and hardcoded as the two options.
- Images: client-side downscale to ≤1568 px long edge, JPEG ~0.85, before base64 — bounds token cost and upload size. **Exception:** the settings screenshot is sent lossless (PNG, long edge up to 2048 px) — it is the one image the model must read small spinner text from.
- Structured output: one tool (`emit_recipe` / `emit_correction`) with `strict` JSON schema; `tool_choice` forced.
- Retries: up to 3 with exponential backoff on 429/5xx/network errors. A schema-violating response is re-asked once with the validation error appended; second failure surfaces to the user.

## Failure handling

- **CORS on the gateway is a hard precondition.** Detected via fetch failure on a preflight probe; the error state explains the exact fix (the user owns kesarcloud and can enable `Access-Control-Allow-Origin`). Verified in the first build hour, before any other work.
- 401 → inline key prompt. 429/5xx → backoff + retry, then a plain-language error.
- Oversized/wrong-format images: auto-downscale; unsupported formats (EXR/HEIC) rejected with the reason and the expected format named.
- Out-of-range model values: clamped to pack range, visibly flagged on the row.

## Testing & acceptance

- `metrics` is the only real algorithmic code and gets a real harness: `lightmatch.html?selftest` runs pure-function asserts against synthetic canvases (known gradients/grays → expected percentiles, clipping counts, WB split, grid). Pass/fail renders in-page.
- Three golden fixture pairs (reference + base) live in `fixtures/` with *directional* expected properties ("must warm the sun", "must lift shadows", "must reduce highlight burn") — a manual smoke checklist, since model output is not deterministic.
- **Acceptance (v1 done means):**
  1. On three of the user's real scenes, a recipe plus ≤3 refine rounds reaches "matched enough to hand to grading", with the convergence score improving monotonically in at least two of the three.
  2. Every emitted value is a legal pack parameter within range; every displayed name is a verbatim pack `ui_path`.
  3. The app opens from disk with zero network traffic except the model call; the key never leaves the browser except to the gateway.
  4. Both targets are selectable per run and re-analysis for the other target works from a stored session.

## Risks / must-verify during implementation

| Risk | Mitigation |
|---|---|
| Omega gateway CORS headers absent | Verify hour one; user owns the gateway and can enable them. Fallback documented (tiny local relay) only if gateway config is impossible. |
| GPT-5.5 vision via Anthropic wire on the gateway unverified | Probe with a small image call during setup; if unsupported, picker ships Opus-only until fixed. |
| Exact model ID strings unknown | Read from gateway model list during setup. |
| Pack accuracy (V-Ray 7.x UI paths, Vantage 3.3 panels) | Dedicated verification task against current Chaos docs; every entry carries `verified` date. |
| Metrics content-blindness skews evidence | Prompt frames metrics as evidence, model arbitrates; caveat rendered in UI ("look distance"). |
| Session images exceed IndexedDB comfort | Store downscaled JPEGs only (≤1568 px), cap session history at last 8 attempts. |
| IndexedDB behavior on `file://` origins varies by browser | Verify hour one in the user's daily browser, alongside CORS. If unsupported there, sessions fall back to in-memory plus a manual export/import JSON file, with a visible warning. |

## Build staging (informative — the implementation plan governs)

- **Stage 1 (usable day one):** skeleton + packs + anchored recipe card + gateway adapter + session persistence. No metrics yet; prompt runs eyes-only with baseline convention.
- **Stage 2:** measurement engine + evidence injection + convergence score + correction cards + oscillation guard + handoff.
