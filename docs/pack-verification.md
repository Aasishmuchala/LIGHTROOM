# Pack verification log — 2026-07-02 · updated 2026-07-03

Task 2 doc-grounding for `PACKS.vray7max` and `PACKS.vantage33` in `lightmatch.html`.
2026-07-03 update (see the dated section at the end): Vantage `sun.*` path corrections,
VFB-layer/±100-scale advisory notes, and the new step-6 atmosphere/weather group
(current totals: vray7max **51** entries, vantage33 **47** entries).

**Method.** `docs.chaos.com` now fronts a Refined site backed by Confluence Cloud
(`docs-chaos.atlassian.net`); pages render via JS, so each page body was pulled through the
public Confluence REST API (`/wiki/rest/api/content?spaceKey=…&title=…&expand=body.view`)
and read in full. Space **VMAX** = "V-Ray for 3ds Max" current docs (V-Ray 7.x — the space
carries the 7.30.02 changelog; pages last modified 2026-04/05). Space **LAV** = "Chaos
Vantage" current docs; the What's New page lists **Chaos Vantage v3.3.0, official release
2026-06-11**, and the pages below document 3.3 features (e.g. the 3.3 Color mixer appears on
the Color Corrections Tab page). `docs.chaos.com/display/<SPACE>/<Page>` URLs remain the
canonical citations (they 301 to `documentation.chaos.com`).

**Verification policy (also in the PACKS section header):**
- `verified:"2026-07-02"` — control name, panel location, option lists and every doc-stated
  range/default in the entry were confirmed on the cited page. Where Chaos docs do not print
  spinner bounds (they almost never do), `range` is a **practical range** and the entry's
  `notes` say so — per the plan's practical-range rule.
- `verified:false` — the ui_path itself is doc-checked, but the entry states a **factory
  default that current Chaos docs do not print** (typically a creation value like a light
  multiplier). The shipped value is conservative and flagged "(N assumed)" in `notes`.
- Neutral values that follow from doc-stated semantics (a multiplier's 1.0, a ± slider's 0,
  "no override" dropdown states, 6500 K as a WB layer's no-correction point) are accepted as
  verified with the derivation noted; arbitrary creation values are not.

**Id decisions forced by doc-grounding** (plan said final ids follow the docs):
- `sun.kelvin` (vray7max) — **V-Ray 7's VRaySun has no Kelvin control.** Color mode options
  are `filter | direct | override` (VRaySun page); sun color is physical (elevation +
  Turbidity + Ozone). The id is kept (spec/selftest contract) as a `placement` instruction
  entry pointing at the real controls (`Color mode` + `Filter color`), with the honest
  mechanism in notes. The spec example's "Color temperature" spinner does not exist in the
  V-Ray 7 Modify panel and is not claimed.
- `sun.kelvin_or_skymodel` (vantage33 draft) — split into `sun.color_mode`
  (Filter | Direct | Override — the Vantage sun also has no Kelvin control) and
  `env.sky_model` (the sky-model dropdown).
- `env.tint` (vantage33 draft) — Vantage has no environment tint control in Texture mode;
  numeric tinting lives in post: shipped as `post.wb_kelvin` + `post.wb_tint`
  (Color Corrections tab ▸ White balance). The vray7max "tint" group member is
  `dome.temperature` (VRayLight Mode = Temperature), which only applies untextured.
- `dome.rotation_h` (vray7max) — the Max dome light has **no rotation spinner**; the real
  controls are the HDRI's `VRayBitmap ▸ Horiz. rotation` or rotating the light icon with
  `Lock texture to icon` enabled (both doc-verified).
- Vantage exposure: the task asked to confirm the exposure control names — they are
  `Camera tab ▸ Exposure (advanced) ▸ Exposure (None | Physical | Value)` + `Exposure Value`,
  plus a **Toggle auto-exposure** on the Viewport bar which *ignores* the set camera exposure
  (shipped as `cam.auto_exposure` with a recipe-critical warning note).
- Vantage post/tonemapping: lives in the **Color Corrections tab** (not the Camera tab):
  Exposure corrections (Exposure bias, Highlight burn, Contrast), Filmic tonemap
  (Type: Hable | AMPAS), Hue/Saturation, White balance (Temperature, Magenta-Green tint), LUT,
  Lens effects, Bloom, Color mixer (new in 3.3), Color balance, Chromatic aberration.

## Source pages

| Key | URL (canonical) | Last modified |
|---|---|---|
| VMAX VRaySun | https://docs.chaos.com/display/VMAX/VRaySun | 2026-04-22 |
| VMAX Dome Light | https://docs.chaos.com/display/VMAX/Dome+Light | 2026-04-22 |
| VMAX Plane-Disc-Sphere Light | https://docs.chaos.com/display/VMAX/Plane+-+Disc+-+Sphere+Light | 2026-04-22 |
| VMAX VRayBitmap | https://docs.chaos.com/display/VMAX/VRayBitmap | 2026-04-24 |
| VMAX VRayPhysicalCamera | https://docs.chaos.com/display/VMAX/VRayPhysicalCamera | 2026-05-21 |
| VMAX Environment Settings | https://docs.chaos.com/display/VMAX/Environment+Settings | 2026-05-21 |
| VMAX Color Mapping | https://docs.chaos.com/display/VMAX/Color+Mapping | 2026-05-21 |
| VMAX Global Illumination Rollout | https://docs.chaos.com/display/VMAX/Global+Illumination+Rollout | 2026-05-21 |
| VMAX Universal V-Ray Settings | https://docs.chaos.com/display/VMAX/Universal+V-Ray+Settings | 2026-05-22 |
| VMAX Layers (VFB) | https://docs.chaos.com/display/VMAX/Layers | 2026-05-21 |
| LAV Sky | https://docs.chaos.com/display/LAV/Sky | 2026-02-27 |
| LAV Environment Tab | https://docs.chaos.com/display/LAV/Environment+Tab | 2026-06-11 |
| LAV Background | https://docs.chaos.com/display/LAV/Background | 2026-03-19 |
| LAV Vantage Default Sun | https://docs.chaos.com/display/LAV/Vantage+Default+Sun | 2026-03-19 |
| LAV Sun Light | https://docs.chaos.com/display/LAV/Sun+Light | 2026-02-27 |
| LAV Lights Tab | https://docs.chaos.com/display/LAV/Lights+Tab | 2026-06-23 |
| LAV Camera Tab | https://docs.chaos.com/display/LAV/Camera+Tab | 2026-07-01 |
| LAV Viewport Bar | https://docs.chaos.com/display/LAV/Viewport+Bar | 2026-06-23 |
| LAV Color Corrections Tab | https://docs.chaos.com/display/LAV/Color+Corrections+Tab | 2026-06-15 |
| LAV What's New (v3.3.0) | https://docs.chaos.com/display/LAV/What%27s+New | 2026-06-11 |

## PACKS.vray7max (51 entries — the 30 below logged 2026-07-02; 21 atmosphere entries in the 2026-07-03 section)

- `env.gi_skylight_on` — Render Setup ▸ V-Ray tab ▸ Environment rollout ▸ GI Environment (Skylight) ▸ On — VERIFIED https://docs.chaos.com/display/VMAX/Environment+Settings (rollout path + On/Color/Multiplier/Texture group; "off" default from the page's own statement that without the override the 3ds Max Environment dialog is used).
- `env.gi_skylight_mult` — … ▸ GI Environment (Skylight) ▸ Multiplier — VERIFIED https://docs.chaos.com/display/VMAX/Environment+Settings ("multiplier does not affect the environment texture" doc-stated; range practical, default 1.0 = neutral multiplier).
- `dome.texture_slot` — VRayLight (Dome) ▸ Modify panel ▸ General rollout ▸ Map — VERIFIED https://docs.chaos.com/display/VMAX/Dome+Light (Map under General Rollout; texture overrides Color/Temperature).
- `dome.intensity` — VRayLight (Dome) ▸ Modify panel ▸ General rollout ▸ Multiplier — UNVERIFIED (factory creation value not printed in docs) — control + path VERIFIED on https://docs.chaos.com/display/VMAX/Dome+Light ; default 1.0 assumed, range practical.
- `dome.rotation_h` — Dome HDRI: VRayBitmap ▸ Mapping ▸ Horiz. rotation — VERIFIED https://docs.chaos.com/display/VMAX/VRayBitmap ("Horiz. rotation – Allows left and right rotation of the environment map"; alternative Lock texture to icon on https://docs.chaos.com/display/VMAX/Dome+Light).
- `dome.invisible` — VRayLight (Dome) ▸ Modify panel ▸ Options rollout ▸ Invisible — VERIFIED https://docs.chaos.com/display/VMAX/Dome+Light (incl. the still-affects-GI caveat).
- `dome.temperature` — VRayLight (Dome) ▸ Modify panel ▸ General rollout ▸ Temperature (Mode = Temperature) — UNVERIFIED (factory Kelvin value not printed in docs) — Mode Color|Temperature and Kelvin semantics VERIFIED on https://docs.chaos.com/display/VMAX/Dome+Light ; 6500 assumed.
- `sun.placement_azimuth` — viewport move / Daylight system — VERIFIED https://docs.chaos.com/display/VMAX/VRaySun ("You can also specify the VRaySun as the sun type inside a 3ds Max Daylight system"; creation via click-and-drag UI paths; no azimuth spinner exists on the sun — hence kind:placement, default informational).
- `sun.placement_elevation` — viewport move / Daylight system — VERIFIED https://docs.chaos.com/display/VMAX/VRaySun (same grounds; sun/sky appearance follows direction per the page's direction example).
- `sun.intensity_mult` — VRaySun ▸ Modify panel ▸ Sun Parameters ▸ Intensity multiplier — VERIFIED https://docs.chaos.com/display/VMAX/VRaySun (control + "reduce its effect" semantics; 1.0 = physical neutral per the page's Notes on real-world irradiance; range practical).
- `sun.size_mult` — VRaySun ▸ Modify panel ▸ Sun Parameters ▸ Size multiplier — VERIFIED https://docs.chaos.com/display/VMAX/VRaySun (disc size + shadow blurriness, illumination unchanged; examples 4–40; 1.0 neutral; range practical).
- `sun.kelvin` — VRaySun ▸ Modify panel ▸ Sun Parameters ▸ Color mode + Filter color — VERIFIED https://docs.chaos.com/display/VMAX/VRaySun (Color mode options filter|direct|override confirmed; the entry's claim is the *absence* of a Kelvin spinner + the real mechanism; 5777 K physical constant, informational).
- `sun.turbidity` — VRaySun ▸ Modify panel ▸ Sky Parameters ▸ Turbidity — UNVERIFIED (factory default not printed in docs) — control, Sky Parameters location and 2–8 example values VERIFIED on https://docs.chaos.com/display/VMAX/VRaySun ; 3.0 assumed, range practical.
- `fill.plane_intensity` — VRayLight (Plane) ▸ Modify panel ▸ General rollout ▸ Multiplier — UNVERIFIED (factory creation value not printed in docs) — control/path/units-size interaction VERIFIED on https://docs.chaos.com/display/VMAX/Plane+-+Disc+-+Sphere+Light ; 30 assumed, range practical.
- `fill.plane_kelvin` — … ▸ Temperature (Mode = Temperature) — UNVERIFIED (factory Kelvin value not printed in docs) — Mode/Temperature control VERIFIED on https://docs.chaos.com/display/VMAX/Plane+-+Disc+-+Sphere+Light ; 6500 assumed.
- `fill.sphere_intensity` — VRayLight (Sphere) ▸ Modify panel ▸ General rollout ▸ Multiplier — UNVERIFIED (factory creation value not printed in docs) — control + size/units interaction VERIFIED on https://docs.chaos.com/display/VMAX/Plane+-+Disc+-+Sphere+Light ; 30 assumed, range practical.
- `fill.key_fill_guidance` — Create menu ▸ Lights ▸ V-Ray ▸ V-Ray Plane/Sphere Light — VERIFIED https://docs.chaos.com/display/VMAX/Plane+-+Disc+-+Sphere+Light (creation UI paths verbatim; ratio bounds are guidance, not a UI control — kind:placement).
- `cam.iso` — VRayPhysicalCamera ▸ Modify panel ▸ Aperture ▸ Film speed (ISO) — UNVERIFIED (factory default not printed in docs) — control name/rollout + "around 100 ISO for day scenes" VERIFIED on https://docs.chaos.com/display/VMAX/VRayPhysicalCamera ; 100 assumed, range practical.
- `cam.fnumber` — … ▸ Aperture ▸ F-Number — UNVERIFIED (factory default not printed in docs) — control + brightness/DOF semantics VERIFIED on https://docs.chaos.com/display/VMAX/VRayPhysicalCamera ; 8.0 assumed, range practical.
- `cam.shutter` — … ▸ Aperture ▸ Shutter speed (s^-1) — UNVERIFIED (factory default not printed in docs) — control + inverse-seconds semantics VERIFIED on https://docs.chaos.com/display/VMAX/VRayPhysicalCamera ; 200 assumed, range practical.
- `cam.wb_kelvin` — … ▸ Color & Exposure ▸ Temperature (K) (White balance = Temperature) — UNVERIFIED (factory value not printed in docs) — control name + activation condition + presets (e.g. Daylight) VERIFIED on https://docs.chaos.com/display/VMAX/VRayPhysicalCamera ; 6500 assumed.
- `cam.ev_readout` — … ▸ Color & Exposure ▸ Exposure value — VERIFIED https://docs.chaos.com/display/VMAX/VRayPhysicalCamera (derived/greyed-out behavior doc-stated verbatim; default explicitly labeled approximate in notes).
- `cm.type` — Render Setup ▸ V-Ray tab ▸ Color mapping rollout ▸ Type — VERIFIED https://docs.chaos.com/display/VMAX/Color+Mapping (all 7 options; default Reinhard + Burn 1.0 = linear doc-stated).
- `cm.highlight_burn` — … ▸ Burn value (Type = Reinhard) — VERIFIED https://docs.chaos.com/display/VMAX/Color+Mapping (range [0,1] and default 1.0 doc-stated).
- `cm.contrast` — V-Ray Frame Buffer ▸ Layers panel ▸ Exposure layer ▸ Contrast — VERIFIED https://docs.chaos.com/display/VMAX/Layers (control + ± semantics; 0 neutral derived; range practical).
- `cm.saturation` — V-Ray Frame Buffer ▸ Layers panel ▸ Hue/Saturation layer ▸ Saturation — VERIFIED https://docs.chaos.com/display/VMAX/Layers (layer + lower/higher semantics; 0 neutral derived; range practical).
- `vfb.exposure` — V-Ray Frame Buffer ▸ Layers panel ▸ Exposure layer ▸ Exposure — VERIFIED https://docs.chaos.com/display/VMAX/Layers (default 0.0 and ±1 = double/half doc-stated; range practical).
- `vfb.wb_kelvin` — V-Ray Frame Buffer ▸ Layers panel ▸ White Balance layer ▸ Temperature — VERIFIED https://docs.chaos.com/display/VMAX/Layers (Kelvin control + bluer/amber semantics; 6500 neutral derived, noted as such; range practical).
- `gi.primary` — Render Setup ▸ GI tab ▸ Global illumination rollout ▸ Primary engine — VERIFIED https://docs.chaos.com/display/VMAX/Global+Illumination+Rollout (options incl. Irradiance map deprecation) + default Brute force VERIFIED https://docs.chaos.com/display/VMAX/Universal+V-Ray+Settings ("GI enabled, using Brute Force as Primary GI engine and Light Cache as Secondary GI engine" as the default settings).
- `gi.secondary` — … ▸ Secondary engine — VERIFIED https://docs.chaos.com/display/VMAX/Global+Illumination+Rollout + https://docs.chaos.com/display/VMAX/Universal+V-Ray+Settings (default Light cache; bounce defaults 3/100 doc-stated).

## PACKS.vantage33 (47 entries — the 27 below logged 2026-07-02; 20 atmosphere entries in the 2026-07-03 section; `sun.*` ui_paths below superseded by the 2026-07-03 corrections)

- `env.mode` — Environment tab ▸ Sky rollout ▸ Settings ▸ Environment mode — VERIFIED https://docs.chaos.com/display/LAV/Sky (Texture | Solid Color | Physical Sky; Physical Sky needs VRaySky in the .vrscene doc-stated; startup scene-dependent, noted).
- `env.hdri_slot` — … ▸ Load environment (Texture mode) — VERIFIED https://docs.chaos.com/display/LAV/Sky (control + RGB color space options).
- `env.intensity` — … ▸ Intensity — VERIFIED https://docs.chaos.com/display/LAV/Sky (present in all three modes; 1.0 neutral derived; range practical).
- `env.rotation` — … ▸ Rotation (Texture mode) — VERIFIED https://docs.chaos.com/display/LAV/Sky ("rotation angle in degrees for the Environment texture").
- `env.background_mode` — Environment tab ▸ Background rollout ▸ Mode — VERIFIED https://docs.chaos.com/display/LAV/Background (Same as environment | Solid color | Image; not-used-for-lighting caveat doc-stated; "Same as environment" = neutral no-override).
- `env.sky_model` — … ▸ Sky model (Physical Sky mode) — VERIFIED https://docs.chaos.com/display/LAV/Sky (all 6 options incl. PRG Clear Sky (old) vs updated PRG with turbidity 1.81–4.89 and twilight to −12°; default scene-dependent, noted).
- `sun.enabled` — Lights tab ▸ Sun ▸ Basic settings ▸ Enabled — VERIFIED https://docs.chaos.com/display/LAV/Vantage+Default+Sun + https://docs.chaos.com/display/LAV/Sun+Light + https://docs.chaos.com/display/LAV/Lights+Tab (tab name; identical parameter sets for default/imported sun).
- `sun.intensity` — … ▸ Intensity — VERIFIED https://docs.chaos.com/display/LAV/Sun+Light ("reduce the default brightness" semantics; 1.0 physical neutral; range practical).
- `sun.size` — … ▸ Sun size mult. — VERIFIED https://docs.chaos.com/display/LAV/Sun+Light (disc size + shadow softness; 1.0 neutral; range practical).
- `sun.position_mode` — … ▸ Sun position mode — VERIFIED https://docs.chaos.com/display/LAV/Vantage+Default+Sun (Manual | Altitude/Azimuth | Geolocation | Animated Geolocation; recipe recommendation noted, scene default follows import).
- `sun.azimuth` — … ▸ Azimuth (Altitude/Azimuth mode) — VERIFIED https://docs.chaos.com/display/LAV/Sun+Light (control + mode gating; compass convention from the page's azimuth description; default informational).
- `sun.elevation` — … ▸ Altitude (Altitude/Azimuth mode) — VERIFIED https://docs.chaos.com/display/LAV/Sun+Light (Vantage's name is **Altitude**, noted; negative-elevation twilight bound from the PRG sky on https://docs.chaos.com/display/LAV/Sky ; range practical).
- `sun.color_mode` — … ▸ Color mode — VERIFIED https://docs.chaos.com/display/LAV/Sun+Light (Filter | Direct | Override; no Kelvin control on the Vantage sun — replaces draft id `sun.kelvin_or_skymodel`).
- `cam.exposure_mode` — Camera tab ▸ Exposure (advanced) ▸ Exposure — UNVERIFIED (startup default not printed in docs) — options None | Physical | Value + grey-out behavior VERIFIED on https://docs.chaos.com/display/LAV/Camera+Tab ; "Value" assumed.
- `cam.exposure_value` — … ▸ Exposure Value (Exposure = Value) — UNVERIFIED (factory default not printed in docs) — control + mode gating VERIFIED on https://docs.chaos.com/display/LAV/Camera+Tab , twilight example EV 10 on https://docs.chaos.com/display/LAV/Sky ; 14 assumed, range practical.
- `cam.auto_exposure` — Viewport bar ▸ Exposure ▸ Toggle auto-exposure — UNVERIFIED (startup state not printed in docs) — control + "ignores set camera exposure" VERIFIED on https://docs.chaos.com/display/LAV/Viewport+Bar ; "off" is the recipe-safe recommendation, noted.
- `cam.wb` — Camera tab ▸ White balance (color swatch) — VERIFIED https://docs.chaos.com/display/LAV/Camera+Tab (color-swatch semantics + "only works when Exposure is Physical or Value" doc-stated; no Kelvin field on the camera — kind:placement instruction).
- `cam.dof_note` — Camera tab ▸ Depth of field (advanced) — VERIFIED https://docs.chaos.com/display/LAV/Camera+Tab (toggle + advanced Focus distance/Aperture size/Optical vignetting; docs' Optical-vignetting-over-Vignetting recommendation quoted in notes; off = neutral effect state).
- `post.exposure_corrections` — Color Corrections tab ▸ Exposure corrections (toggle) — VERIFIED https://docs.chaos.com/display/LAV/Color+Corrections+Tab (+ Viewport bar Toggle Color Corrections on https://docs.chaos.com/display/LAV/Viewport+Bar ; off = neutral).
- `post.exposure_bias` — … ▸ Exposure bias — VERIFIED https://docs.chaos.com/display/LAV/Color+Corrections+Tab (also on the Viewport bar; 0 neutral derived; range practical).
- `post.highlight_burn` — … ▸ Highlight burn — UNVERIFIED (range/neutral value not printed in Vantage docs) — control + hidden-when-Filmic-tonemap behavior VERIFIED on https://docs.chaos.com/display/LAV/Color+Corrections+Tab ; [0,1]/1.0 follow the V-Ray burn convention, flagged in notes.
- `post.contrast` — … ▸ Contrast — VERIFIED https://docs.chaos.com/display/LAV/Color+Corrections+Tab (± around mid-grey semantics doc-stated; 0 neutral; range practical).
- `post.tonemap_type` — Color Corrections tab ▸ Filmic tonemap ▸ Type — UNVERIFIED (default selection not printed in docs) — options Hable | AMPAS + gating/Highlight-burn interaction VERIFIED on https://docs.chaos.com/display/LAV/Color+Corrections+Tab ; "Hable" assumed.
- `post.saturation` — Color Corrections tab ▸ Hue / Saturation ▸ Saturation — VERIFIED https://docs.chaos.com/display/LAV/Color+Corrections+Tab (positive vibrant / negative desaturate doc-stated; 0 neutral; range practical).
- `post.wb_kelvin` — Color Corrections tab ▸ White balance ▸ Temperature — VERIFIED https://docs.chaos.com/display/LAV/Color+Corrections+Tab (Kelvin + bluer/amber semantics; 6500 neutral derived, noted; range practical).
- `post.wb_tint` — … ▸ Magenta-Green tint — VERIFIED https://docs.chaos.com/display/LAV/Color+Corrections+Tab (greener/purple semantics; 0 neutral; range practical).
- `render.quality_preset` — Viewport bar ▸ Render ▸ quality preset — UNVERIFIED (startup preset not printed in docs) — options Low | Medium | High | Ultra | Custom + per-preset GI values VERIFIED on https://docs.chaos.com/display/LAV/Viewport+Bar ; "High" assumed.

## Summary (2026-07-02 state — superseded totals; see the 2026-07-03 section below)

- vray7max: 30 entries — 20 verified, **10 UNVERIFIED** (`dome.intensity`, `dome.temperature`,
  `sun.turbidity`, `fill.plane_intensity`, `fill.plane_kelvin`, `fill.sphere_intensity`,
  `cam.iso`, `cam.fnumber`, `cam.shutter`, `cam.wb_kelvin`).
- vantage33: 27 entries — 21 verified, **6 UNVERIFIED** (`cam.exposure_mode`,
  `cam.exposure_value`, `cam.auto_exposure`, `post.highlight_burn`, `post.tonemap_type`,
  `render.quality_preset`).
- Every UNVERIFIED entry has a **doc-checked ui_path**; only a factory default (and where
  noted, a practical range) could not be confirmed, because current Chaos docs do not print
  factory values for those controls. Also probed without success: V-Ray AppSDK plugin
  reference (no defaults listed), VMAX MAXScript page (no per-plugin defaults), VNS/APPSDK
  Confluence spaces (no plugin pages). Follow-up that would close them: read the values from
  a fresh 3ds Max + V-Ray 7 / Vantage 3.3 install and stamp them here.

---

# 2026-07-03 — Vantage sun-path corrections + step-6 atmosphere/weather group

Applied from two read-only research passes: `docs/settings-audit-existing.md` (audit of every
existing entry vs current Chaos docs) and `docs/settings-research-atmospherics.md` (new
atmospherics specs). Same method as above (full page bodies via the public Confluence Cloud
REST API at `docs-chaos.atlassian.net`; `docs.chaos.com/display/…` remain the canonical URLs).

## A. Corrections to existing entries

### The 7 Vantage `sun.*` ui_paths (stale location → doc-correct location)

Audit root cause: Vantage's own (default) sun is driven from **Environment tab ▸ Sun and
Moon rollout ▸ Sun tab** — only an *imported* V-Ray sun appears in the Lights tab (as "Sun
Light"), and "Basic settings" is a legacy-page grouping that no longer names the current UI.
Values/options/defaults were re-verified unchanged; only paths (and two label divergences,
now in notes) were wrong. All seven re-stamped `verified:"2026-07-03"`.
Docs: https://docs.chaos.com/display/LAV/Sun+and+Moon ·
https://docs.chaos.com/display/LAV/Environment+Tab · https://docs.chaos.com/display/LAV/Sun+Light ·
https://docs.chaos.com/display/LAV/Lights+Tab · https://docs.chaos.com/display/LAV/Vantage+Default+Sun

| id | old ui_path (2026-07-02) | corrected ui_path (2026-07-03) |
|---|---|---|
| `sun.enabled` | Lights tab ▸ Sun (Vantage Default Sun / Sun Light) ▸ Basic settings ▸ Enabled | Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Enabled |
| `sun.intensity` | Lights tab ▸ Sun ▸ Basic settings ▸ Intensity | Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Intensity |
| `sun.size` | Lights tab ▸ Sun ▸ Basic settings ▸ Sun size mult. | Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Sun size (imported Sun Light label: Sun size mult. — noted) |
| `sun.position_mode` | Lights tab ▸ Sun ▸ Basic settings ▸ Sun position mode | Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Sun position mode (imported Sun Light label: Sun position — noted) |
| `sun.azimuth` | Lights tab ▸ Sun ▸ Basic settings ▸ Azimuth (…) | Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Azimuth (Sun position mode = Altitude/Azimuth) |
| `sun.elevation` | Lights tab ▸ Sun ▸ Basic settings ▸ Altitude (…) | Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Altitude (Sun position mode = Altitude/Azimuth) |
| `sun.color_mode` | Lights tab ▸ Sun ▸ Basic settings ▸ Color mode | Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Color mode |

`sun.enabled` notes also rewritten: imported V-Ray suns list in the Lights tab as Sun Light;
Vantage's own sun is configured in Environment tab ▸ Sun and Moon (Sun tab) — near-identical
parameters (docs).

### Advisory notes applied (paths/values unchanged)

- **A1 — VFB layers are user-added** (`cm.contrast`, `cm.saturation`, `vfb.exposure`,
  `vfb.wb_kelvin`): notes now state the Exposure / Hue-Saturation / White Balance layer is
  not in the VFB's default stack — add it via V-Ray Frame Buffer ▸ Layers panel ▸ + (Add
  layer). https://docs.chaos.com/display/VMAX/Layers
- **A2 — ±100 saturation/tint scales unverifiable from docs** (`cm.saturation`,
  `post.saturation`, `post.wb_tint`): notes now flag "Range pending in-product confirmation —
  Chaos docs don't print slider bounds; if the slider is actually -1..1, this is a 100x scale
  mismatch (flagged to user)." Numeric ranges left as-is pending an in-product spot-check.
- V-Ray 7 pack: audit verdict 30/30 OK — no corrections needed.

## B. New step-6 atmosphere/weather entries

Curated from the 30/27 researched specs down to 21/20 (look-driving controls as rows;
ultra-granular sub-params — cloud seed/phase/offset, contrail components, fog emission /
scatter bounces / light boost, Vantage cloud Ground-shadows/Improved-shading/Density-mult —
folded into notes or the `clouds.detail` note-entry). Every ui_path/range/default/verified
flag is verbatim from `docs/settings-research-atmospherics.md` except `wet.*` (see below).

### PACKS.vray7max (21 new)

- `fog.enabled`, `fog.color`, `fog.distance` (UNVERIFIED default, 50 assumed), `fog.height`
  (UNVERIFIED, 10 assumed), `fog.phase` (doc-stated default 0.0), `fog.scatter_gi`
  (UNVERIFIED state, off assumed; Scatter bounces + Fog emission folded in notes)
  → https://docs.chaos.com/display/VMAX/VRayEnvironmentFog
- `aerial.enabled` (Affect environment rays folded in notes; sun Affect-atmospherics
  no-effect fact from https://docs.chaos.com/display/VMAX/VRaySun ),
  `aerial.visibility_range` (UNVERIFIED, 10000 assumed), `aerial.atmosphere_height`
  (UNVERIFIED, 10000 assumed), `aerial.inscatter` (doc-stated default 1.0),
  `aerial.filter_color`, `aerial.affect_background` (doc-stated default on)
  → https://docs.chaos.com/display/VMAX/VRayAerialPerspective
- `clouds.enabled` (clouds live on the SUN — no cloud params on VRaySky:
  https://docs.chaos.com/display/VMAX/VRaySky ; CIE-Overcast sky-model lever folded in
  notes), `clouds.density` (UNVERIFIED, 0.5 assumed), `clouds.density_mult` (1.0 neutral
  derived), `clouds.variety` (UNVERIFIED, 0.5 assumed), `clouds.cirrus_amount` (UNVERIFIED,
  0 assumed), `clouds.height` (UNVERIFIED, 1000 assumed), `clouds.thickness` (UNVERIFIED,
  500 assumed), `clouds.ground_shadows` (UNVERIFIED state, off assumed), `clouds.detail`
  (note-entry: Seed — keep identical across attempts — + Phase X/Y + Offset X/Y + contrail
  sub-group) → https://docs.chaos.com/display/VMAX/VRaySun

### PACKS.vantage33 (20 new)

- Simple (aerial-perspective) fog: `fog.enabled`, `fog.visibility_range` (UNVERIFIED, 50 km
  assumed), `fog.height` (UNVERIFIED, 500 assumed), `fog.start_distance` (0 neutral derived),
  `fog.max_opacity` (UNVERIFIED, 1.0 assumed), `fog.color`
  → https://docs.chaos.com/display/LAV/Fog
- Scattering fog: `fog.scatter_enabled` (unshipped sub-controls incl. Fog light boost folded
  in notes), `fog.scatter_distance` (UNVERIFIED, 20 assumed), `fog.scatter_height`
  (UNVERIFIED, 8 assumed), `fog.scatter_gi` (UNVERIFIED state, off assumed),
  `fog.scatter_texture_mode` (Off | Built-in smoke density | From V-Ray scene)
  → https://docs.chaos.com/display/LAV/Fog
- Clouds (gated on Environment mode = Physical sky, doc-stated): `clouds.enabled`
  (Ground shadows + Improved shading folded in notes), `clouds.density` (UNVERIFIED, 0.5
  assumed; Density multiplier folded in notes), `clouds.variety` (UNVERIFIED, 0.5 assumed),
  `clouds.cirrus_amount` (UNVERIFIED, 0 assumed), `clouds.start_height` (UNVERIFIED, 1000
  assumed), `clouds.thickness` (UNVERIFIED, 500 assumed), `clouds.detail` (note-entry:
  Random seed — keep identical across attempts — + positioning + contrails)
  → https://docs.chaos.com/display/LAV/Clouds
- Wetting (Beta, new in 3.3 — the research pass had scoped it out, so both entries were
  doc-grounded directly for this change from the LAV Wetting page, version 2, last modified
  2026-06-15, fetched via the same Confluence API): `wet.enabled` = "Enable wetting (Beta)"
  under the rollout's Settings; `wet.amount` = the **Wet cover** control (General tab;
  doc-stated scale 0% dry … 100% uniformly wet; factory value UNVERIFIED, 50 assumed) — Wet
  cover is the page's global wetness amount (its other "Amount" is droplet-coverage only).
  V-Ray 7 has no atmospheric-wetting equivalent (surface wetness there is material-domain;
  noted in `wet.enabled`). → https://docs.chaos.com/display/LAV/Wetting ·
  https://docs.chaos.com/display/LAV/What%27s+New (Wet effects Beta listed under v3.3.0) ·
  https://docs.chaos.com/display/LAV/Environment+Tab (Wetting rollout in the tab's rollout
  list; also the "Right-click a parameter value to reset it to its default" tip quoted in
  the pack's step-6 group comment)

## C. Wiring shipped with this update

`emit_recipe`/`emit_correction` value `step` max 5 → 6; `values` maxItems 24 → 32;
`validateRecipe` step bound 1..6; systemPrompt step list gains
"6. atmosphere/weather …" + a re-confirm-exposure-after-atmosphere sentence;
UI STEP_HEADERS gains "6 · Atmosphere / weather". SELFTEST: PASS (2336 asserts), up from
1571 — includes new asserts for step-6 schema acceptance (6 ok / 7 rejected), the step-6
system-prompt line in both modes, and fog./clouds./aerial./wet. id presence + verbatim
ui_path in promptFragment.

## Summary (current totals, 2026-07-03)

- vray7max: **51** entries — **30 verified-dated / 21 UNVERIFIED** (2026-07-02 log: 20
  dated + 10 UNVERIFIED; atmosphere adds 10 dated + 11 UNVERIFIED).
- vantage33: **47** entries — **29 verified-dated / 18 UNVERIFIED** (2026-07-02 log: 21
  dated + 6 UNVERIFIED, with the 7 `sun.*` re-stamped 2026-07-03; atmosphere + wetting add
  8 dated + 12 UNVERIFIED).
- Every UNVERIFIED entry has a doc-checked ui_path; only factory values (and where noted a
  unit or practical range) are unprinted in current Chaos docs — assumed values use doc
  example values wherever one exists.

---

# 2026-07-03 — Vantage Wetting + Wind panels completed (doc-grounded)

The two last-incomplete Vantage environment panels were finished from the docs (both
rollouts were collapsed in the user's UI captures — `docs/ui-capture-inventory.md` lists them
as GAPS — so the Chaos docs are the authoritative source). Same method as above (full page
bodies via the public Confluence Cloud REST API at `docs-chaos.atlassian.net`, space `LAV`;
`docs.chaos.com/display/…` remain the canonical URLs). The prior `wet.enabled`/`wet.amount`
2-entry stub and the `wind.note` placeholder were replaced with the complete control lists.

## Source pages (append to the table above)

| Key | URL (canonical) | Page version / last modified |
|---|---|---|
| LAV Wetting | https://docs.chaos.com/display/LAV/Wetting | v2 · 2026-06-15 |
| LAV Wind | https://docs.chaos.com/display/LAV/Wind | v4 · 2026-03-19 |

## PACKS.vantage33 — Wetting (26 entries, replaces the 2-entry stub) — https://docs.chaos.com/display/LAV/Wetting

Rollout = Environment tab ▸ Wetting rollout: a Settings toggle + three tabs (General, Drops
and Ripples, Advanced). The page names and describes every control but prints **no spinner
default/range/unit** except **Wet cover** (`0%` dry … `100%` uniformly wet → unit % + range
doc-stated) and **Diffuse multiplier** ("A value of 1 produces no darkening" → 1.0 is the
doc-stated neutral). All other spinners ship `verified:false` + a conservative default + an
honest "factory value not printed (X assumed)" note, and practical ranges (Chaos docs don't
print slider bounds). Two enable toggles that are on/off in the doc but model as the pack's
Vantage-toggle convention (`kind:"dropdown"`, `Options: on | off`): `wet.enabled` (off; gates
the rollout) and `wet.occlusion` (**on** — rain-realistic default per the doc's
"restricts wetting to areas exposed from above"; the other three drop/ripple/wobble enables
default off). Label-reuse disambiguation: the doc reuses **Size** and **Amount** across
sub-groups — shipped as distinct ids with the sub-group in the ui_path
(`wet.ripple_size`/`wet.wobble_size`, `wet.drops_amount`/`wet.ripple_amount`).

- `wet.enabled` (dropdown, verified) · `wet.size` · `wet.amount` (Wet cover, %/[0,100]
  doc-stated) · `wet.puddles` · `wet.occlusion` (dropdown, verified, default **on**) ·
  `wet.occlusion_radius` — General tab
- `wet.surface_drops` (dropdown, verified) · `wet.surface_drops_scale` · `wet.drops_tiling` ·
  `wet.drops_amount` · `wet.drops_base_bump` · `wet.puddle_ripples` (dropdown, verified) ·
  `wet.puddle_ripples_strength` · `wet.ripple_size` · `wet.ripple_amount` ·
  `wet.puddle_wobble` (dropdown, verified) · `wet.puddle_wobble_strength` · `wet.wobble_size`
  — Drops and Ripples tab
- `wet.height_effect` · `wet.transition` · `wet.diffuse_mult` (**verified** — 1.0 =
  no-darkening neutral, doc-stated) · `wet.max_puddle_slope` · `wet.noise_size` ·
  `wet.ray_offset` · `wet.ripple_lifetime` (**lighting:false** — temporal) ·
  `wet.wobble_speed` (**lighting:false** — temporal) — Advanced tab
- lighting split: **24 lighting:true**, 2 lighting:false (`wet.ripple_lifetime`,
  `wet.wobble_speed` — pure animation timing, no effect on a still). verified-dated: the 5
  on/off toggles + `wet.diffuse_mult` (6). The other 20 are `verified:false` (factory value
  not printed).

## PACKS.vantage33 — Wind (5 entries, replaces `wind.note`) — https://docs.chaos.com/display/LAV/Wind

Rollout = Environment tab ▸ Wind rollout. The two **cloud-wind** controls shift the
physical-sky cloud shapes (visible in a still sky) and are AVAILABLE ONLY when Environment
mode = Physical sky AND Enable clouds is on (doc-stated constraint, quoted in notes) →
`lighting:true`. The three vegetation/water controls are **viewport animation only** — the
doc states "Doesn't affect the final render" for each → `lighting:false` (a still lighting
match ignores them). No defaults/ranges printed; angle examples 10°/100° fix the degree unit
on `wind.cloud_direction`, intensity examples 0/100 and 100/300 give practical ranges.

- `wind.cloud_direction` (spinner, °, [0,360], lighting:true, verified:false — 0.0 assumed)
- `wind.cloud_intensity` (spinner, [0,100], lighting:true, verified:false — 0.0 assumed)
- `wind.affect_vegetation` (dropdown on|off, lighting:false, **verified** — off)
- `wind.vegetation_intensity` (spinner, [0,500], lighting:false, verified:false — 100 assumed)
- `wind.affect_water` (dropdown on|off, lighting:false, **verified** — off)
- lighting split: **2 lighting:true** (cloud wind), 3 lighting:false (vegetation/water —
  render-neutral). verified-dated: the 2 on/off toggles. The 3 spinners are `verified:false`.

## Wiring / totals

- Data-only change: only the `PACKS.vantage33` Wetting/Wind entries were touched. No
  SCHEMAS/METRICS/STORE/ADAPTER/ENGINE/UI/STYLE change; no selftest-suite edit needed
  (`wind.note` was referenced by no assert; the `wet.*`-present assert and the sheet-coverage
  contract auto-accept the new rows; Wetting's lighting:true controls now flow into
  `promptFragment("vantage33")`).
- vantage33: **47 → 75** entries (net +28: +24 Wetting over the 2-entry stub, +5 Wind over
  the 1 placeholder). vray7max unchanged at 51.
- SELFTEST: **PASS (7488 asserts)**, up from 6846 (+642 for the 28 net-new entries across the
  packs + sheet suites).
