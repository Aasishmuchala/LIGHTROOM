# LightMatch Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `lightmatch.html` — a single-file, serverless web app that turns a reference image + base V-Ray render into an exact V-Ray 7 / Chaos Vantage 3.3 lighting recipe and iterates via a measured refine loop until ~99% match (or structured handoff to grading).

**Architecture:** Split-brain: deterministic canvas photometry (`METRICS`) measures images; the model (via the user's omega gateway, Anthropic wire, non-streaming, strict tool schema) translates evidence into parameter moves; display names render only from pack data (`PACKS`), never model prose. Session state (per-target attempt chains) persists to IndexedDB. Spec: `docs/superpowers/specs/2026-07-02-lightmatch-design.md` — read it before starting any task.

**Tech Stack:** Vanilla HTML/CSS/JS in one file. No libraries, no build. Tests = in-page `?selftest` harness run in real Chrome via the title-poll runner `probes/run-selftest.ps1` (never `--headless --dump-dom` — see canonical-command block). Git for every step.

**File layout inside the single file** (section markers, in this order):

```html
<!-- lightmatch.html -->
<!DOCTYPE html><html><head><meta charset="utf-8"><title>LightMatch</title>
<style> /* SECTION: STYLE */ </style></head><body>
<div id="app"></div>
<script>
/* ===== SECTION: PACKS ===== */      // data + lookups + prompt fragment
/* ===== SECTION: SCHEMAS ===== */    // emit_recipe / emit_correction / system prompts
/* ===== SECTION: METRICS ===== */    // pure functions, no DOM
/* ===== SECTION: STORE ===== */      // IndexedDB session persistence
/* ===== SECTION: ADAPTER ===== */    // gateway fetch, retries, schema re-ask
/* ===== SECTION: ENGINE ===== */     // orchestration + session state machine
/* ===== SECTION: UI ===== */         // DOM rendering + events
/* ===== SECTION: SELFTEST ===== */   // ?selftest harness (asserts over all modules)
</script></body></html>
```

Every module is an object literal (`const METRICS = {...}`) with only its declared dependencies: `UI→ENGINE`; `ENGINE→{METRICS, PACKS, SCHEMAS, STORE, ADAPTER}`; `SCHEMAS→PACKS` (prompt fragment + clamp inside validation); `ADAPTER→STORE` (key read only); `METRICS`, `PACKS`, `STORE` → nothing. `UI` gets pack display strings through `ENGINE.lookup(paramId)`.

**Canonical test command (used by many steps):**

```powershell
powershell -File C:\Users\aasis\lightmatch\probes\run-selftest.ps1
```
This launches real Chrome (own profile) on `lightmatch.html?selftest`, polls the window title for the verdict (SELFTEST must set `document.title`), prints it, kills only that profile's processes, and exits 0/1. Expected when green: `SELFTEST: PASS (N asserts)`. On failure the page body lists one line per failed assert — re-open non-headless to read them, or extend the runner to dump them.

**Why not `--headless --dump-dom`:** probe 0.5 proved `--virtual-time-budget` starves real async I/O (IndexedDB callbacks never fire before virtual timeouts) — see `probes/results.md`. `--dump-dom` is acceptable only for fully synchronous suites.

---

## Chunk 1: Preconditions, scaffold, packs, metrics

### Task 0: Precondition probes (spec "hour one")

**Files:** Create: `probes/results.md`, `probes/idb-probe.html`

- [x] **Step 0.1: CORS preflight against the gateway** (no key needed) — ✅ PASS, see `probes/results.md`

```powershell
try { $r = Invoke-WebRequest -Method Options -Uri "https://omega.kesarcloud.in/v1/messages" -Headers @{ "Origin"="null"; "Access-Control-Request-Method"="POST"; "Access-Control-Request-Headers"="authorization, content-type" } -UseBasicParsing; $r.Headers.GetEnumerator() | Where-Object { $_.Key -like "Access-Control*" } } catch { $_.Exception.Response.Headers["Access-Control-Allow-Origin"]; $_.Exception.Message }
```
Expected: `Access-Control-Allow-Origin: *` (or `null`) AND `Access-Control-Allow-Headers` containing `authorization`. Record verbatim output in `probes/results.md`. **If absent: STOP and report — the user owns the gateway and must enable CORS before the app can work. Do not silently build a relay.** Note: a page opened from disk sends `Origin: null`, so `*` or `null` is required; a specific-domain allowlist won't work.

- [x] **Step 0.2: Locate the `oc_` key** — done: not on disk; paste-at-runtime (0.3/0.4 deferred to Task 8)

Check in order: `Get-ChildItem env: | Where-Object Name -match "OMEGA|OC_|KESAR"`; then `Grep` for `oc_` in `C:\Users\aasis\DavinciPlugin` (REFGRADE is wired to the same gateway — look for its config file, not source). If found, note WHERE it lives (do not copy it into the repo). If not found, continue building — the app takes a pasted key at runtime; mark Steps 0.3–0.4 as deferred-to-first-run.

- [ ] **Step 0.3: Model IDs** (needs key)

```powershell
$k = "<oc_ key>"; (Invoke-RestMethod -Uri "https://omega.kesarcloud.in/v1/models" -Headers @{ Authorization = "Bearer $k" }).data | Select-Object id
```
Expected: list containing an Opus 4.8 id (memory says `claude-opus-4-8`) and a GPT-5.5 id. Record both exact strings in `probes/results.md`; they become the two hardcoded picker options.

- [ ] **Step 0.4: Vision + forced-tool probe, both models** (needs key)

POST `/v1/messages` per model: one 64×64 red PNG (base64), one tool `{"name":"echo_color","strict":true,"input_schema":{"type":"object","properties":{"color":{"type":"string"}},"required":["color"],"additionalProperties":false}}`, `tool_choice:{"type":"tool","name":"echo_color"}`, `"stream":false`, `max_tokens:200`. Expected per model: `stop_reason:"tool_use"` and input `{"color":"red"}`-ish. If GPT-5.5 fails tool-forcing through the gateway: record it; the picker ships Opus-only and the ADAPTER's re-ask path is the GPT fallback (spec risk table).

- [x] **Step 0.5: IndexedDB on `file://`** — ✅ DONE 2026-07-02, see `probes/results.md`

`probes/idb-probe.html` writes/reads DB `lm-probe` and sets the verdict in `document.title`. Executed in real Chrome (own profile, title-poll method — headless `--virtual-time-budget` starves IDB callbacks and must not be used). Result: `IDB OK prev=none` then `IDB OK prev=<run-1 timestamp>` → **persistence across launches confirmed**; no export/import fallback needed on this machine.

- [ ] **Step 0.6: Commit** `git add probes; git commit -m "probe: gateway CORS, model ids, vision/tool support, file:// IndexedDB"`

### Task 1: Skeleton + repo hygiene

**Files:** Create: `lightmatch.html`, `README.md`, `.gitignore` (`probes/results.md` stays tracked; ignore `*.local.*`)

- [ ] **Step 1.1:** Write `lightmatch.html` with the exact section-marker layout above, dark base shell (`<div id="app">`), an empty object per section (`const PACKS={}` … `const SELFTEST={run(){}}`), and this boot line:

```js
addEventListener("DOMContentLoaded", () => {
  if (location.search.includes("selftest")) SELFTEST.run(); else UI.boot();
});
```

- [ ] **Step 1.2:** In SELFTEST, implement the assert core now (it is the test vehicle for everything after):

```js
const SELFTEST = { fails: [], n: 0,
  ok(cond, msg) { this.n++; if (!cond) this.fails.push(msg); },
  close(a, b, tol, msg) { this.ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b}±${tol})`); },
  async run() {
    for (const [name, fn] of Object.entries(SELFTEST.suites)) { try { await fn(); } catch (e) { this.fails.push(name + " threw: " + e.message); } }
    const line = this.fails.length ? `SELFTEST: FAIL\n` + this.fails.join("\n") : `SELFTEST: PASS (${this.n} asserts)`;
    document.body.textContent = line; document.title = line.split("\n")[0];
  }, suites: {} };
```

- [ ] **Step 1.3:** Run the canonical runner. Expected: `SELFTEST: PASS (0 asserts)`.
- [ ] **Step 1.4:** `README.md`: what it is, how to open, `?selftest`, key handling one-liner, pointer to spec. Commit: `feat: skeleton with selftest harness`.

### Task 2: Target packs (the exactness asset)

**Files:** Modify: `lightmatch.html` SECTION: PACKS. Create: `docs/pack-verification.md`

Pack entry shape (spec-fixed):
```js
{ id: "sun.kelvin", ui_path: "VRaySun ▸ Modify panel ▸ Sun parameters ▸ Color temperature",
  kind: "spinner", unit: "K", range: [1000, 20000], default: 5777,
  notes: "Active only when color mode = Temperature" }
```

- [ ] **Step 2.1: Draft `PACKS.vray7max`** (~30 entries) covering, per spec groups: environment/dome (`env.gi_skylight_mult`, `dome.texture_slot`, `dome.intensity`, `dome.rotation_h`, `dome.invisible`, tint), sun (`sun.placement_azimuth` kind:"placement", `sun.placement_elevation` kind:"placement", `sun.intensity_mult`, `sun.size_mult`, `sun.kelvin`, `sun.turbidity`), fills (`fill.plane_intensity`, `fill.plane_kelvin`, `fill.sphere_intensity`, key:fill guidance entry kind:"placement"), camera/exposure (`cam.iso`, `cam.fnumber`, `cam.shutter`, `cam.wb_kelvin`, `cam.ev_readout` notes:"derived"), color mapping/VFB (`cm.type`, `cm.highlight_burn`, `cm.contrast`, `cm.saturation`, `vfb.exposure`), GI (`gi.primary`, `gi.secondary`, notes-only entries kind:"dropdown").
- [ ] **Step 2.2: Draft `PACKS.vantage33`** (~25 entries) with explicit ids mirroring Step 2.1's rigor: environment (`env.hdri_slot`, `env.intensity`, `env.rotation`, `env.background_mode`, `env.tint`), sun & sky (`sun.enabled`, `sun.intensity`, `sun.azimuth`, `sun.elevation`, `sun.size`, `sun.kelvin_or_skymodel`), camera (`cam.exposure_value`, `cam.wb`, `cam.dof_note`), post (`post.tonemap_type`, `post.contrast`, `post.saturation`, plus whatever Vantage 3.3 actually exposes — final ids follow the doc-grounding in 2.3).
- [ ] **Step 2.3: DOC-GROUND every entry.** WebFetch Chaos docs (`docs.chaos.com` — "V-Ray 7 for 3ds Max" help + "Chaos Vantage" help/changelog for 3.3) and verify each `ui_path`, range, default. Fix drafts; set `verified:"2026-07-02"` per entry ONLY after checking. Log each verification (entry → doc URL) in `docs/pack-verification.md`. Entries that cannot be confirmed get `verified:false` + a conservative range and MUST be listed in the commit message.
- [ ] **Step 2.4:** Implement `PACKS.lookup(target,id)`, `PACKS.clamp(target,id,value)` → `{value,clamped}`, `PACKS.promptFragment(target)` (compact one-line-per-param listing: id, ui_path, unit, range, default, kind, notes).
- [ ] **Step 2.5: Selftest suite `packs`:** unique ids per pack; every entry has all fields; every `range[0]<range[1]`; every `default` inside range; `clamp` clamps 1e9 to max and flags; `promptFragment("vray7max")` contains `"sun.kelvin"` and its verbatim ui_path.
- [ ] **Step 2.6:** Runner → PASS. Commit: `feat: doc-grounded V-Ray 7 + Vantage 3.3 packs with lookup/clamp/prompt-fragment`.

### Task 3: Metrics engine (pure functions, TDD)

**Files:** Modify: `lightmatch.html` SECTION: METRICS + SELFTEST suites.

Contract:
```js
METRICS.measure(imageBitmapOrCanvas) -> {
  lum: {p1,p5,p25,p50,p75,p95,p99,mean},        // linearized 0..1
  clip: {hi,lo},                                  // fraction of pixels ≥250/255, ≤5/255 (sRGB domain)
  contrast: {spread,midSlope},                    // p95-p5; (p75-p25)/0.5
  wb: {shadow:{r,g,b}, highlight:{r,g,b}, warmthShadow, warmthHighlight, tint}, // warmth=(R-B)/(R+B) on linear means; tint=G-(R+B)/2
  sat: {mean,p95},                                // max(r,g,b)-min over max (sRGB)
  grid: [16 numbers]                              // 4x4 mean linear luminance, row-major
}
METRICS.diff(a,b) -> flat object of (b-a) per scalar + grid deltas
METRICS.score(refM, attemptM) -> 0..100          // deterministic: score = min(100, 100 * sqrt(Σ w_i·d_i² / Σ w_i) / 0.35)
                                                  // d_i = per-scalar diffs (all metric scalars are already 0..1-ish); weights:
                                                  // lum p5/p50/p95=3, spread/midSlope=2, warmthShadow/warmthHighlight/tint=2,
                                                  // clip.hi/lo=1.5, sat.mean=1, grid cells=0.5 each (16 cells aggregate to 8 —
                                                  // deliberately below the lum trio's 9; sanity: grid must not swamp lum terms).
                                                  // 0.35 is the documented full-scale "look distance" divisor; identical images → 0.
                                                  // Threshold calibration (tight-match ≤5) happens at acceptance, divisor stays fixed.
METRICS.thumb(source, 256) -> canvas             // metrics always run on ≤256px thumb
```
Linearize: `c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4`; lum = `0.2126R+0.7152G+0.0722B` (linear). Percentiles via 1024-bin histogram. Shadow quartile = pixels with lum≤p25; highlight = ≥p75.

- [ ] **Step 3.1: Write failing selftest suite `metrics` first** (synthetic canvases built in-test):
  - solid gray 128: `close(m.lum.p50, 0.2159, 0.01)`; `clip.hi===0 && clip.lo===0`; `sat.mean≈0`; all 16 grid cells equal ±0.001.
  - solid 255 / solid 0: `clip.hi===1` / `clip.lo===1`.
  - horizontal black→white gradient: `grid[0]<grid[3]`; `lum.p5<0.02`; `lum.p95>0.9`; `contrast.spread>0.9`.
  - red image vs blue image: `wb.warmthShadow` positive for red, negative for blue.
  - green image: `wb.tint>0`.
  - `diff(m,m)` all-zero; `score(m,m)===0`; `score(gray128, gradient) > 10`.
  - `METRICS.thumb(canvas4000x2000, 256)` returns a canvas with `width===256 && height===128`.
- [ ] **Step 3.2:** Runner → expect `SELFTEST: FAIL` listing metrics asserts (functions missing).
- [ ] **Step 3.3:** Implement METRICS to the contract. No DOM reads; input canvas/bitmap only.
- [ ] **Step 3.4:** Runner → PASS. Commit: `feat: canvas photometry engine (measure/diff/score)`.
- [ ] **Step 3.5:** Add `METRICS.downscaleForSend(fileOrBlob, maxEdge=1568, type="image/jpeg", q=0.85) -> {dataUrl, w, h}` and lossless variant `(maxEdge=2048, "image/png")` for the settings screenshot. Selftest: a 4000×2000 synthetic canvas downsizes to 1568×784 and dataUrl prefix matches type. Runner PASS → commit.

**Chunk 1 exit criteria:** probes recorded; selftest green (~35+ asserts); packs doc-grounded; 3 commits minimum.

---

## Chunk 2: Schemas, adapter, engine, UI, acceptance

### Task 4: Schemas + system prompts (SECTION: SCHEMAS)

**Files:** Modify: `lightmatch.html`.

- [ ] **Step 4.1:** Define `SCHEMAS.emit_recipe` exactly:

```js
{ name: "emit_recipe", strict: true, input_schema: { type: "object", additionalProperties: false,
  required: ["baseline","values","rationale","hdri_mood","gi_notes","status"],
  properties: {
    baseline: { type: "string", enum: ["factory_defaults","settings_screenshot"] },
    hdri_mood: { type: "string", description: "One line: what HDRI to reach for" },
    values: { type: "array", minItems: 4, maxItems: 24, items: { type: "object", additionalProperties: false,
      required: ["param","set","from","step","confidence","why"],
      properties: {
        param: { type: "string", description: "MUST be an id from the provided pack" },
        set: { type: ["number","string"] }, from: { type: ["number","string"] },
        step: { type: "integer", minimum: 1, maximum: 5 },
        confidence: { type: "string", enum: ["high","medium","low"] },
        why: { type: "string" } } } },
    rationale: { type: "string" }, gi_notes: { type: "string" },
    status: { type: "string", enum: ["continue","handoff_to_grade"] },
    status_reason: { type: "string" } } } }
```
`emit_correction`: top-level `required: ["moves","rationale","status","status_reason","applied_assumed"]` — `moves` is the value-object shape (minItems 1, maxItems 5, `to` instead of `set`), `applied_assumed: {type:"boolean"}` (true when the model had to assume all steps were applied).

**Deliberate deviation from the spec's grouped schema** (`environment`/`sun`/`fills[]`/`exposure`/`color_mapping`/`step_order[]`): the flat `values[]` with per-value `step: 1..5` plus `hdri_mood` is information-equivalent (fills placement and key:fill ratio live as placement-kind pack entries; `step_order` is redundant given the fixed order) and far easier to validate parametrically. Do not "fix" this back to the grouped shape.

- [ ] **Step 4.2:** `SCHEMAS.systemPrompt(target, mode)` — full text, verbatim requirements: lighting-TD persona; "you do not measure — measurements are provided; trust your eyes for direction, the numbers for magnitude"; "choose ONLY param ids from the pack below; values inside ranges"; baseline convention; fixed step order 1 exposure/WB → 2 sun → 3 dome/environment → 4 fills/rim → 5 color mapping with the degeneracy rationale in one line; exactness goal "the user requires a ~99% match — be surgical, not tasteful"; correction mode adds: full move history provided, never reverse a prior move by more than half, 3–5 moves max, **if a metric ping-pongs across rounds, name the exposure/light degeneracy to the user in `status_reason` instead of chasing it**, declare `handoff_to_grade` when residual diff is chromatic/tonal rather than light-transport. Ends with `PACKS.promptFragment(target)`.
- [ ] **Step 4.3:** Local validator `SCHEMAS.validateRecipe(obj, target)` → `{ok, errors[], cleaned}`: every `param` exists in pack (unknown → error), every numeric `set` clamped via `PACKS.clamp` (clamped → warning flag on the value, kept), steps within 1..5. Selftest suite `schemas`: valid object passes; unknown param fails; out-of-range 40000K comes back clamped to 20000 with `clamped:true`. Runner PASS → commit `feat: recipe/correction schemas, system prompts, local validation`.

### Task 5: Gateway adapter (SECTION: ADAPTER)

**Files:** Modify: `lightmatch.html`.

- [ ] **Step 5.1:** `ADAPTER.call({model, system, userContent, tool}) -> Promise<toolInput>`:
  - POST `https://omega.kesarcloud.in/v1/messages`, headers `{ "content-type":"application/json", "authorization": "Bearer "+STORE.key(), "anthropic-version":"2023-06-01" }`, body `{model, max_tokens: 4096, stream:false, system, messages:[{role:"user",content:userContent}], tools:[tool], tool_choice:{type:"tool",name:tool.name}}`.
  - Retries: on 429/5xx/network — 3 attempts, backoff 2s/6s/15s. On HTTP 401 throw `AuthError`. Extract the `tool_use` block's `input`; if response has none, throw `ShapeError` with raw text.
  - Schema re-ask: caller passes `validate`; on `{ok:false}` ADAPTER re-sends ONCE appending a user turn: `"Your emit was invalid: <errors>. Re-emit the full corrected tool call."` Second failure → surface error.
- [ ] **Step 5.2:** `ADAPTER.buildUserContent({mode, images, metricsBundle, context, history})` — assembles image blocks (`{type:"image",source:{type:"base64",media_type,data}}`) labeled by preceding text blocks ("REFERENCE:", "BASE RENDER:", "SETTINGS SCREENSHOT (baseline):", "ATTEMPT N:"), then a text block with `JSON.stringify` of measurements + diff ("COMPUTED EVIDENCE — deterministic, trust for magnitude") **prefixed by a one-line units legend** (luminance values are linearized 0–1; `warmth*` is `(R−B)/(R+B)` on linear means, positive = warmer, ±0.05 ≈ a few hundred kelvin; `tint` positive = green), context chips, and in refine mode the move history + applied set.
- [ ] **Step 5.3:** Selftest suite `adapter` (no network): `buildUserContent` produces alternating text/image blocks in the documented order; retry classifier maps {429:"retry", 500:"retry", 401:"auth", 400:"fatal"}. Runner PASS → commit `feat: omega gateway adapter with retries and schema re-ask`.

### Task 6: Session engine + persistence (SECTIONS: STORE, ENGINE)

**Files:** Modify: `lightmatch.html`.

- [ ] **Step 6.1:** STORE: `key()/setKey()`, `prefs` (model, target) in localStorage; IndexedDB db `lightmatch` v1, store `sessions` keyPath `id`; API `saveSession(s)`, `loadLatest()`, `exportJSON()/importJSON()` (the file:// fallback). Session shape:

```js
{ id, created, context: {scene, time, rig}, ref: {dataUrl, metrics}, base: {dataUrl, metrics},
  settingsShot: {dataUrl}|null, activeTarget: "vray7max"|"vantage33",
  chains: { vray7max: {recipe, attempts: [{dataUrl, metrics, score, correction, appliedParams}]},
            vantage33: { ... } } }
```
Cap: keep last 8 attempts per chain (drop oldest dataUrls, keep their scores).

- [ ] **Step 6.2:** ENGINE: state machine `empty → ready (ref+base present) → analyzed(target) → refining(target)`; actions `analyze()`, `addAttempt(file)`, `reanalyzeOtherTarget()`, `lookup(paramId)`; wires METRICS → ADAPTER → validated recipe → STORE.saveSession after every mutation; `boot()` restores latest session.
- [ ] **Step 6.3:** Selftest suite `engine` with a stubbed ADAPTER (`ENGINE._adapter` injectable): analyze() on two synthetic canvases stores a recipe under the active chain; addAttempt computes a score; reanalyzeOtherTarget creates the second chain without touching the first; **adding a 9th attempt keeps only the last 8 (oldest dataUrl dropped, its score retained)**; session round-trips through STORE (probe 0.5 proved IDB on `file://`). Runner PASS → commit `feat: session engine with per-target chains and IndexedDB persistence`.

### Task 7: UI (SECTION: UI + STYLE)

**Files:** Modify: `lightmatch.html`.

Layout per approved mockup (spec "UI" section is the contract): left rail (three slots, context chips, target toggle, model picker, key field+status, Analyze button, privacy line), right recipe card (5 step groups, rows = verbatim `ui_path` label + value "(from X)" + confidence dot + applied toggle default-on + per-row copy; **`kind:"placement"` entries render as instruction rows — the string `set` shown as placement text, no unit/`(from)` pair**), header actions (Copy sheet, Copy JSON, Re-analyze other target), rationale foldout, session strip (thumbs + trend arrow + score **labeled "look distance (0–100)" with the verbatim caveat rendered beside it: "trust your eyes first, the numbers second"** — the UI must never imply the score is perceptual truth), handoff banner rendered ONLY from `status==="handoff_to_grade"`, error banners (CORS-explain, auth, retry-exhausted), VFB-consistency hint near attempt behavior, clamped-value flag on rows.

- [ ] **Step 7.1:** Render static structure + drag/drop + paste routing (focused slot → first-empty in Reference→Base→Settings order → new attempt when session active). Dropping a render mid-session = new attempt (correction call), per spec. **Ingestion validation:** accept only types the canvas decoder handles (`image/png`, `image/jpeg`, `image/webp`); anything else (`.exr`, `.hdr`, `.tif`, HEIC…) is rejected with the spec's explanatory message ("LightMatch reads display-referred sRGB screenshots/saves — PNG or JPG from the VFB/Vantage, not linear EXR"). Selftest assert: a fake `File` with `name:"x.exr"`/`type:""` routes to the rejection path.
- [ ] **Step 7.2:** Wire ENGINE: analyze spinner state, recipe render from validated object via `ENGINE.lookup` labels, correction cards as move list, score strip, copy actions (sheet format: `V-Ray 7 — LightMatch recipe\n1. VRayPhysicalCamera ▸ … ▸ Film speed (ISO): 400 (from 100) — why…`), JSON copy = raw validated object.
- [ ] **Step 7.3:** Manual smoke via headless screenshot: `--headless=new --screenshot="probes/ui-smoke.png" --window-size=1400,900 "file:///C:/Users/aasis/lightmatch/lightmatch.html"` → inspect: three slots, disabled Analyze until ref+base, picker showing the two probed model ids. Commit `feat: full UI wired to engine`.
- [ ] **Step 7.4: Design-taste pass — MANDATORY per user's standing rule.** Invoke the `taste-skill` (or `impeccable`) skill and restyle SECTION: STYLE to a dark pro-tool aesthetic worthy of the user's other tools. No structural changes. Re-run selftest (must stay green — taste pass touches STYLE only) + fresh screenshot. Commit `style: design-taste pass`.

### Task 8: Fixtures + live E2E smoke

**Files:** Create: `fixtures/README.md` (+ user-supplied images)

- [ ] **Step 8.1:** `fixtures/README.md`: needs 3 pairs (`refN.jpg` + `baseN.png`) from the user's real archviz scenes; directional expectations table filled per pair when added (e.g. "pair1: must warm sun, lift shadows, reduce highlight burn").
- [ ] **Step 8.2:** Live smoke (needs key + any one pair, or two of the user's renders as stand-ins): open app, run analyze for V-Ray 7 → recipe renders, every label is a pack ui_path, no clamp flags unexpected; run Re-analyze for Vantage 3.3 → second chain appears; drop a different render as attempt → correction card + score. **Then: (a) devtools Network tab shows zero requests except `omega.kesarcloud.in` (acceptance criterion 3); (b) press F5 — session auto-restores from IndexedDB, then Re-analyze still works (criterion 4's stored-session path, in the real browser).** Record results + screenshots into `probes/results.md`. Commit.

### Task 9: Acceptance protocol (user-in-loop — final)

Per scene: full refine loop to score ≤5 or structured handoff; user judges ≥99% with REFGRADE closing declared residuals. Record rounds + scores per scene in `docs/acceptance-log.md`.

- [ ] **Scene 1** loop complete + user verdict recorded
- [ ] **Scene 2** loop complete + user verdict recorded
- [ ] **Scene 3** loop complete + user verdict recorded
- [ ] Cross-scene check: score improved monotonically in ≥2 of 3 (spec acceptance list). Fix what fails; only then tag `v1`.

**Chunk 2 exit criteria:** selftest green end-to-end; UI screenshot approved against mockup; live smoke recorded; acceptance log started.
