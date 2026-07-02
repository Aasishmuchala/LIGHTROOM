# LightMatch full reverification — findings (2026-07-03)

Four independent adversarial agents over commit `22baa53` (build-v1).

## Clean results
- **V-Ray 7 pack**: 50 OK / 0 WRONG / 1 UNCERTAIN (cm.saturation ±100 range — pending user in-product check). Both packs verified twice, from scratch, vs live Chaos docs.
- **Vantage 3.3 pack**: 47 OK / 0 WRONG. Sun-path relocation fix confirmed correct 3 ways.
- **Runtime**: all 12 end-to-end flows PASS; selftest 2336 green ×4, no flake; asserts judged behavioral/sound.
- **Core verified sound**: metrics numerics + diff direction, XSS/security boundary, adapter wire shape (re-ask is valid tool_result), store degrade-never-throw.

## Fix list (this pass)

### Confirmed Important (state/lifecycle)
1. **Stale error banner never clears** (runtime-confirmed) — `lastError` only nulled in `reset()`; a successful action leaves the old banner + auth banner steals focus every render. → clear `lastError` at the entry of every user action.
2. **reanalyzeOtherTarget desyncs prefs.target** (runtime-confirmed) — flips `session.activeTarget` but topbar/button read `prefs.target`; wrong target shown, can burn a second paid call. → update prefs on reanalyze.
3. **Fetch timeout only covers headers** — `clearTimeout` fires on headers; a stalled body wedges `_inFlight`/`_busy` forever. → keep abort active through the body read.
4. **validateRecipe accepts empty/blank recipe** — `{}`/`{values:[]}`/max_tokens-truncated → ok:true blank recipe as "success". → reject empty values/moves + missing top-level required; ADAPTER checks `stop_reason` truncation.
5. **Import restores latest-not-imported; prune can delete it** — the IDB-rescue path no-ops or destroys the import. → stamp imported session current so it loads and survives prune; validate session shape on import (#13).
6. **`?selftest` in the daily browser deletes real sessions** — retention suite runs real prune. → isolate all selftest IDB on a separate DB name.
7. **Sticky slot focus can route a mid-session paste to overwrite a filled slot** (code-flagged; runtime saw it become an attempt — reconcile). → clear `_focusedSlot` after ingest; routePaste prefers attempt once session active + ref/base filled.

### Correctness minors
8. Attempt-number drift after FIFO eviction in card titles/captions → use monotonic `_attemptCount`.
9. `toggleApplied` bypasses ENGINE boundary + busy guard → route through ENGINE like `setRecipeApplied`.
10. Evidence legend never states diff direction → one line (`diff = reference − current`).
11. Initial-recipe `handoff_to_grade` not surfaced → strip checks recipe.status too.
12. No document-level drop guard (drop-off-target navigates away) → preventDefault on document dragover/drop.
13. Imported ref/base media_type hardcoded jpeg → derive from dataUrl prefix.

### Pack + UX
14. V-Ray `sun.placement_elevation` [0,90] → [−12,90] (docs support twilight; Vantage twin allows negatives; user does dusk).
15. Export/Import session buttons only render inside the IDB-warning banner → add an always-available affordance.

## Deferred to live smoke (NOT fixed speculatively — needs the gateway key)
- `strict:true` on tools + `gpt-5.5` id + vision-via-Anthropic-wire: unprobed against omega. Changing the wire shape blind could break the working mocked path. **Top live-smoke risk.**
- cm.saturation ±100 vs −1..1: pending user's VFB slider check.
