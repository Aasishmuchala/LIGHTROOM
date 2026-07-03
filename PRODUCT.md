# LightMatch — PRODUCT.md

**register:** product

## What it is
A single-file, serverless local web app (opens from `file://`, no build, no server) that helps a 3D lighting artist match a render's lighting to a reference image. Drop a **reference** (the look you want) and your **base render**, pick a target renderer (**V-Ray 7 for 3ds Max** or **Chaos Vantage 3.3**), and it returns an exact, copy-able lighting **recipe** in that renderer's real UI vocabulary — then a **refine loop**: re-render with the recipe, drop the attempt back in, and it scores the gap ("look distance") and issues correction moves until the lighting matches.

## Who uses it
One solo archviz professional. Lives in 3ds Max, Chaos Vantage, and DaVinci Resolve all day. High visual literacy, low tolerance for toy UI. This tool sits on a **second monitor** next to a render and a viewport — glanced at, copied from, returned to. It must read as a precision instrument that belongs beside pro creative software, not a web app.

## The job the UI does
1. **Ingest** three images (reference, base, optional settings screenshot) — drag/drop, paste, or file pick.
2. **Configure** — target renderer, model, scene context (interior/exterior/product, day/dusk/night, HDRI/sun rig).
3. **Read a recipe** — the hero. Grouped by a fixed 6-step order (exposure → sun → environment → fills → color mapping → atmosphere), each row a verbatim renderer UI path + a value + why. Copy per-row, as a sheet, or as JSON.
4. **Refine** — attempts render as correction cards with a 0–100 "look distance" score and trend; when the residual is just grading, a handoff milestone points to REFGRADE.

## What "good" means here (product slop test)
Would an artist fluent in Linear / Figma / Resolve trust this at a glance, or pause at every subtly-off control? The recipe values and scores are the jewels — they must read as precise and scannable. The tool should disappear into the task. Earned familiarity over novelty; density where the artist needs it; delight reserved for moments (the match-found handoff), never sprayed across the page.

## Non-negotiable constraints (engineering)
Redesign touches presentation only. Behavior, the test suite (2403 asserts), the JS-read class/id/data-attr hooks, and spec-verbatim strings are frozen. Single file, system fonts only, no external assets (CSP/offline/`file://`).
