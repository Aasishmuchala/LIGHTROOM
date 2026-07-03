# LightMatch — DESIGN.md

The visual system. Redesign evolves this toward an impeccable product-register bar; it does not throw the identity away.

## Identity anchor (preserve)
- **Dark, calm, instrument-grade.** A second-monitor tool beside a render and a 3ds Max/Vantage viewport, under dim studio light. Dark is the physical answer, not a fashion choice — a bright panel next to a dark viewport fatigues.
- **One accent: tungsten amber** — the color of light itself. It is the brand note and the ONLY saturated color. Used for the primary action, the current selection (target/chips), focus, and live state — never decoration.
- **Numbers are the jewels.** Recipe values and the 0–100 look-distance scores are mono, tabular, precise. The renderer UI-path breadcrumbs recede so the control name and value lead.
- **System fonts only** (`file://`, no assets). Hierarchy comes from weight/size/tracking/case, one family in multiple weights.

## Color (restrained — product floor)
- Neutral ramp, near-black page → stepped panel surfaces. **Two neutral layers**: a cooler/darker chrome layer for the topbar + input rail, a content layer for the recipe. Elevation carried by hairlines, not shadows (shadows only on true floats — toasts, any popover).
- Semantic valence (success/warn/error/handoff) as restrained tints, not loud fills. Contrast: body ≥ 4.5:1, large ≥ 3:1 — verify, don't eyeball; muted-gray-on-dark is the trap.

## Type
- Fixed rem scale (NOT fluid clamp — product UI viewed at consistent DPI). Tight ratio ~1.125–1.2. One sans family in weights; mono (`ui-monospace`) + `tabular-nums` for every value/score.

## Components (every one needs the full set)
default / hover / focus-visible / active / disabled / loading / error — standardized and consistent across the surface. Same button shape, same form-control vocabulary, same icon language everywhere. Empty state teaches the flow ("Drop a reference and a base render, then Analyze"), not "nothing here."

## Motion
150–250 ms, conveys state only (focus, hover, busy/analyzing, a value landing, score change). No page-load choreography — the tool loads into a task. Every transition has a `prefers-reduced-motion` fallback.

## Evolve toward impeccable (specific upgrades this pass makes)
1. **Remove side-stripe banner borders** (the `border-left` valence edge = an absolute ban). Rewrite banners as full-border + subtle valence-tinted background + a leading state icon. Same recognizable-not-loud goal, correct construction.
2. **Full component state coverage** — audit every button/slot/chip/toggle/select for the 7 states above; fill the gaps (esp. focus-visible rings, disabled, the Analyze "loading/analyzing" state).
3. **Two-layer neutral chrome** — differentiate the input rail / topbar from the content surface so the recipe reads as the focal plane.
4. **Recipe card as the focal instrument** — the strongest hierarchy on the page; step groups as calm bands; values unmistakably the jewels; copy affordances quiet until row-hover.
5. **Consistent, restrained affordances** — no reinvented controls, no decorative motion, accent never on inactive states.

## Frozen (do not touch)
Behavior, the 2403-assert selftest, all JS-read hooks (`chip-active`, `slot-focused`, `active`, `key-dot-ok`, `banner-*`, `slot-filled`, `data-recipe-applied`, `data-applied-param`, `data-attempt-index`, `data-slot`, ids, `STEP_HEADERS`), and spec-verbatim strings. Single file, no external assets.
