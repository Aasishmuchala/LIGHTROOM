# Settings audit — existing PACKS entries vs current Chaos docs

**Date:** 2026-07-03 (all doc pages re-read from the live source on this date)
**Scope:** every existing entry in `lightmatch.html` `PACKS.vray7max` (30 entries) and
`PACKS.vantage33` (27 entries). Read-only audit; no code was changed.
**Trigger:** user report — "most of the settings aren't as per V-Ray 7."

**Method.** `docs.chaos.com` is JS-rendered, so every page body was pulled through the public
Confluence Cloud REST API (`https://docs-chaos.atlassian.net/wiki/rest/api/content?spaceKey=<SPACE>&title=<Title>&expand=body.view`)
and read in full — the same method `docs/pack-verification.md` used, re-executed independently.
Freshness was verified per page (page version + last-modified from the API; the VMAX pages carry
2026-04/05 modification dates and V-Ray 7.3-era content — e.g. the Layers page states "With V-Ray 7.3
the Background layer is now called Image"; the LAV pages carry 2026-02..07 dates, i.e. Vantage 3.3).
Where location claims were ambiguous, page **ancestor chains** and **cross-page links** were also
pulled from the API (`.../content/<id>?expand=ancestors`) to establish which UI tab a control
actually documents.

## Verdicts

- **OK** — the named control exists at the stated location with the stated label in the current
  doc page; option lists match; any doc-stated range/default matches. Entries whose factory default
  is honestly flagged `verified:false` ("N assumed") were confirmed to be genuinely unprinted in
  current docs (also probed: MAXScript page, Universal V-Ray Settings) and are counted OK.
- **WRONG** — the doc contradicts the entry (wrong location/label/options/doc-stated value).
- **UNCERTAIN** — could not confirm or refute from any doc page.

## Summary

| Pack | OK | WRONG | UNCERTAIN | Total |
|---|---|---|---|---|
| `vray7max` | **30** | 0 | 0 | 30 |
| `vantage33` | **20** | **7** | 0 | 27 |

**Headline finding:** the V-Ray 7 for 3ds Max pack survives the audit fully — all 30 ui_paths,
option lists and doc-stated values match the current VMAX pages verbatim (details + quotes per
entry below). The errors are all in the **Vantage 3.3 pack**: all seven `sun.*` entries point at a
**stale panel location** ("Lights tab ▸ Sun ▸ Basic settings"). In current Vantage the *default*
sun is driven from **Environment tab ▸ Sun and Moon rollout ▸ Sun tab**, and only an *imported*
V-Ray sun appears in the Lights tab (as "Sun Light", with no "Basic settings" grouping there).
Parameter names, options and semantics inside those seven entries are otherwise doc-correct, so
the fix is a path rewrite, not a value rewrite.

---

## WRONG — the 7 Vantage sun entries (shared root cause + per-entry corrections)

### Root cause

The pack path `Lights tab ▸ Sun (Vantage Default Sun / Sun Light) ▸ Basic settings ▸ …` conflates
two different current locations and borrows a tab name ("Basic settings") that only exists on a
legacy reference page:

1. **Vantage's own (default) sun lives in the Environment tab, not the Lights tab.**
   - Environment Tab page (last modified 2026-06-11 — the v3.3.0 release date): "The Environment
     tab provides properties for setting up the environment. The tab contains several rollouts:
     Scene Sub-State, **Sky**, **Sun and Moon**, Clouds, Wetting, Wind, Fog, Ambient settings,
     Background."
     API: `https://docs-chaos.atlassian.net/wiki/rest/api/content?spaceKey=LAV&title=Environment+Tab&expand=body.view`
   - Sun and Moon page: "The **Sun and Moon rollout** is located under the **Environment tab** in
     the right-hand side panel. The Sun and Moon settings are grouped into **Sun** settings,
     **Moon** settings, **advanced settings**, and **include/exclude** list tabs." — the sun
     grouping is a **"Sun" tab**, not "Basic settings".
     API: `https://docs-chaos.atlassian.net/wiki/rest/api/content?spaceKey=LAV&title=Sun+and+Moon&expand=body.view`
   - The Sun Light page explicitly routes default-sun readers there: "For information about the
     Default Vantage Sun, see the Sun page" — that link's target is page id **125275477 = Sun and
     Moon** (verified in the raw HTML: `href="/wiki/spaces/LAV/pages/125275477/Sun+and+Moon"`).
   - Ancestor chains (API `…/content/<id>?expand=ancestors`):
     `Sun and Moon` → *User Interface > Right Side Panel > **Environment Tab***;
     `Sun Light` → *User Interface > Right Side Panel > **Lights Tab***;
     `Vantage Default Sun` → *Chaos Vantage Home > Lights* (a light-type reference section — **not**
     in the Right Side Panel UI tree).
   - The v3.3 What's New page references the Sun-and-Moon tab set as the live UI (fix note:
     "Moon, Include/Exclude, and Advanced tab being hidden when Sun is disabled. Now they are
     always visible.").

2. **Only imported V-Ray suns are in the Lights tab, and there is no "Basic settings" tab there.**
   - Sun Light page: "The Sun Light is the representation of the V-Ray Sun in Chaos Vantage. The
     Sun Light **can only be imported with a .vrscene file**." and "Listed parameters can be
     filtered by using the **Compact, Basic, and Advanced buttons**" — display filters on the Light
     Lister, not a "Basic settings" tab.
     API: `https://docs-chaos.atlassian.net/wiki/rest/api/content?spaceKey=LAV&title=Sun+Light&expand=body.view`
   - Lights Tab page: "The **Light lister** lists all lights and their properties imported with a
     .vrscene file." Its light-type index (Sun Light, Sphere, Rect, IES, Point, Spot, Direct, Mesh,
     Cylinder) contains **no** default-sun entry. A full-space CQL text search found **no** current
     page stating the default sun appears in the Lights tab.
     API: `https://docs-chaos.atlassian.net/wiki/rest/api/content?spaceKey=LAV&title=Lights+Tab&expand=body.view`
   - The "Basic settings" tab name comes from the **Vantage Default Sun** page ("divided into three
     tabs: Basic settings, Advanced settings, and Include/Exclude") — a page the current docs
     supersede for UI location (see the ancestor chain and the Sun Light cross-link above).

3. **Two label divergences between the sun types** (both misfit the pack's single label):
   - Sun and Moon (default sun): "**Sun size** – Controls the visible size of the sun disc." vs
     Sun Light (imported): "**Sun size mult.** – Controls the visible size of the sun disc."
   - Sun and Moon + Vantage Default Sun: "**Sun position mode** – Specifies the control mode for
     the sun's position in the sky." vs Sun Light (imported): "**Sun position** – Specifies the
     control mode for the sun's position in the sky."

All other facts inside these entries were re-verified as correct: options `Filter | Direct |
Override` ("Color mode – … Filter / Direct / Override", both sun pages and Sun and Moon); options
`Manual | Altitude/Azimuth | Geolocation | Animated Geolocation` (all three pages); control names
`Altitude` / `Azimuth` gated on Altitude/Azimuth mode; "Intensity – Specifies the intensity of the
sun and can be used to reduce the default brightness"; no Kelvin control exists on any Vantage sun;
sun-size shadow-softness semantics verbatim ("Lower values produce sharp shadows, while large
values produce softer shadows").

### Per-entry corrections (ranges/defaults/options unchanged — all doc-consistent)

| id | corrected ui_path |
|---|---|
| `sun.enabled` | `Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Enabled` — Vantage's own sun. Imported V-Ray sun: `Lights tab ▸ Light Lister ▸ Sun Light ▸ Enabled` |
| `sun.intensity` | `Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Intensity` (imported Sun Light: same label, Lights tab ▸ Light Lister) |
| `sun.size` | `Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Sun size` (imported Sun Light: label is `Sun size mult.`) |
| `sun.position_mode` | `Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Sun position mode` (imported Sun Light: label is `Sun position`) |
| `sun.azimuth` | `Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Azimuth (Sun position mode = Altitude/Azimuth)` (same control on Sun Light) |
| `sun.elevation` | `Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Altitude (Sun position mode = Altitude/Azimuth)` (same control on Sun Light) |
| `sun.color_mode` | `Environment tab ▸ Sun and Moon rollout ▸ Sun tab ▸ Color mode` (same control + options on Sun Light) |

**Notes fix needed on `sun.enabled`:** replace "Imported V-Ray suns list as Sun Light; Vantage's
own sun as Vantage Default Sun — same parameters (docs)" with e.g. "Imported V-Ray suns list in the
Lights tab as Sun Light; Vantage's own sun is configured in Environment tab ▸ Sun and Moon (Sun
tab) — near-identical parameters (docs)". The "same parameters" claim itself holds.

Doc URLs (canonical): https://docs.chaos.com/display/LAV/Sun+and+Moon ·
https://docs.chaos.com/display/LAV/Sun+Light · https://docs.chaos.com/display/LAV/Lights+Tab ·
https://docs.chaos.com/display/LAV/Environment+Tab · https://docs.chaos.com/display/LAV/Vantage+Default+Sun

---

## PACKS.vray7max — per-entry verdicts (30/30 OK)

Every ui_path element below was matched against the current page text (section headings = rollout
names on these pages; V-Ray 7.x content, last modified 2026-04/05).

| id | verdict | issue | doc URL |
|---|---|---|---|
| `env.gi_skylight_on` | OK | — ("Render Setup window > V-Ray tab > Environment rollout"; group heading "GI Environment (Skylight)"; "On – Turns on and off the GI environment override"; default-off derivation supported: "If you don't specify a color/map then the background color and map specified in the 3ds Max Environment dialog will be used by default") | https://docs.chaos.com/display/VMAX/Environment+Settings |
| `env.gi_skylight_mult` | OK | — ("the multiplier does not affect the environment texture (if present). Use an Output map…" — verbatim basis for the notes) | https://docs.chaos.com/display/VMAX/Environment+Settings |
| `dome.texture_slot` | OK | — (General Rollout lists "Map – Enables the use of a texture for the light surface"; see advisory A3 on rollout naming) | https://docs.chaos.com/display/VMAX/Dome+Light |
| `dome.intensity` | OK | — ("Multiplier – Multiplier for the light color, and also the light intensity for some Units settings" in General Rollout; factory value genuinely unprinted → `verified:false` correct) | https://docs.chaos.com/display/VMAX/Dome+Light |
| `dome.rotation_h` | OK | — ("Horiz. rotation – Allows left and right rotation of the environment map. Ignored when the Mapping type is 3ds Max standard" under Mapping; alternative "Lock texture to icon" confirmed in Dome Light Rollout) | https://docs.chaos.com/display/VMAX/VRayBitmap |
| `dome.invisible` | OK | — (Options Rollout; camera/refraction-only visibility + still-seen-by-GI note verbatim) | https://docs.chaos.com/display/VMAX/Dome+Light |
| `dome.temperature` | OK | — (Mode: Color / Temperature, "specified by the Temperature value expressed in Kelvin"; factory Kelvin unprinted → `verified:false` correct) | https://docs.chaos.com/display/VMAX/Dome+Light |
| `sun.placement_azimuth` | OK | — (no azimuth spinner exists on VRaySun — confirmed, the only Azimuth on the page is the Moon sub-object's; "You can also specify the VRaySun as the sun type inside a 3ds Max Daylight system" verbatim) | https://docs.chaos.com/display/VMAX/VRaySun |
| `sun.placement_elevation` | OK | — (same grounds; sun/sky appearance follows direction per the page) | https://docs.chaos.com/display/VMAX/VRaySun |
| `sun.intensity_mult` | OK | — ("Sun Parameters" heading; "Intensity multiplier – … you can use this parameter to reduce its effect"; Notes section supports the keep-at-1.0/expose-via-camera guidance) | https://docs.chaos.com/display/VMAX/VRaySun |
| `sun.size_mult` | OK | — ("Size multiplier – Controls the visible size of the sun … as well as the blurriness of the sun shadows"; examples 4.0/10.0/40.0; "overall illumination strength remains the same" verbatim) | https://docs.chaos.com/display/VMAX/VRaySun |
| `sun.kelvin` | OK | — (correctly documents the ABSENCE of a Kelvin control; "Color mode – … filter / direct / override" verbatim; 5777 K informational) | https://docs.chaos.com/display/VMAX/VRaySun |
| `sun.turbidity` | OK | — (Turbidity sits under the "Sky Parameters" heading in V-Ray 7 docs; examples 2.0/4.0/8.0; factory default unprinted → `verified:false` correct) | https://docs.chaos.com/display/VMAX/VRaySun |
| `fill.plane_intensity` | OK | — (General Rollout ▸ Multiplier; "With the Default (image), Luminance … and Radiance … settings, the light's intensity is directly affected by the size of the light source" verbatim; default unprinted → `verified:false` correct) | https://docs.chaos.com/display/VMAX/Plane+-+Disc+-+Sphere+Light |
| `fill.plane_kelvin` | OK | — (Mode: Color / Temperature; Kelvin semantics verbatim; default unprinted → `verified:false` correct) | https://docs.chaos.com/display/VMAX/Plane+-+Disc+-+Sphere+Light |
| `fill.sphere_intensity` | OK | — (same grounds as plane; size/units interaction verbatim) | https://docs.chaos.com/display/VMAX/Plane+-+Disc+-+Sphere+Light |
| `fill.key_fill_guidance` | OK | — (creation path "Create menu > Lights > V-Ray > V-Ray Plane/Sphere Light > Click and drag in a viewport" verbatim from the page's UI Path table) | https://docs.chaos.com/display/VMAX/Plane+-+Disc+-+Sphere+Light |
| `cam.iso` | OK | — ("Aperture" heading; "Film speed (ISO)" exact label; "A day scene, lit with a V-Ray Sun … looks best when captured with around 100 ISO" verbatim; default unprinted → `verified:false` correct) | https://docs.chaos.com/display/VMAX/VRayPhysicalCamera |
| `cam.fnumber` | OK | — ("F-Number" exact label; brightness/DOF semantics verbatim; default unprinted → `verified:false` correct) | https://docs.chaos.com/display/VMAX/VRayPhysicalCamera |
| `cam.shutter` | OK | — ("Shutter speed (s^-1)" exact label incl. the (s^-1); "shutter speed of 1/30 s corresponds to a value of 30" verbatim; default unprinted → `verified:false` correct) | https://docs.chaos.com/display/VMAX/VRayPhysicalCamera |
| `cam.wb_kelvin` | OK | — ("Temperature (K) – Specifies the temperature (in Kelvins) when White balance is set to Temperature" verbatim, in "Color & Exposure"; Daylight preset mention confirmed; default unprinted → `verified:false` correct) | https://docs.chaos.com/display/VMAX/VRayPhysicalCamera |
| `cam.ev_readout` | OK | — ("When Physical Exposure mode is selected, changing the value of ISO, F-number, or Shutter speed automatically shows the corrected Exposure value which is greyed out" verbatim; the entry's default 14 is arithmetically consistent with ISO 100 / f8 / 1/200 and labeled approximate) | https://docs.chaos.com/display/VMAX/VRayPhysicalCamera |
| `cm.type` | OK | — (all 7 options incl. both "deprecated" flags verbatim; default doc-stated: "The standard settings for color mapping are set by default … (Reinhard color mapping with Burn value 1.0 produces a linear result)") | https://docs.chaos.com/display/VMAX/Color+Mapping |
| `cm.highlight_burn` | OK | — ("Burn value – Available when Type is set to Reinhard. If this value is 1.0 … Linear multiply. If this value is 0.0 … Exponential. Values between 0.0 and 1.0 blend" — range AND default doc-stated) | https://docs.chaos.com/display/VMAX/Color+Mapping |
| `cm.contrast` | OK | — (Exposure layer contains Contrast; ± around medium grey verbatim; see advisory A1) | https://docs.chaos.com/display/VMAX/Layers |
| `cm.saturation` | OK | — (Hue/Saturation layer; "Lower Saturation values move the image towards greyscale while higher values increase the colors' intensities" verbatim; see advisories A1 + A2) | https://docs.chaos.com/display/VMAX/Layers |
| `vfb.exposure` | OK | — ("An Exposure value of 0.0 leaves the original image brightness. When set to +1.0, makes the image twice as bright. When set to -1.0, makes the image twice as dark" — default doc-stated; see advisory A1) | https://docs.chaos.com/display/VMAX/Layers |
| `vfb.wb_kelvin` | OK | — ("Temperature - … in Kelvin. Lower values make the image bluer, higher ones make it more amber" verbatim; "Magenta - Green tint" confirmed in the same layer; see advisory A1) | https://docs.chaos.com/display/VMAX/Layers |
| `gi.primary` | OK | — ("Render Setup window > GI tab > Global illumination rollout"; options + "Irradiance Map GI engine is deprecated … will be soon removed as an option" verbatim; default doc-stated in Universal V-Ray Settings: "GI enabled, using Brute Force as Primary GI engine and Light Cache as Secondary GI engine") | https://docs.chaos.com/display/VMAX/Global+Illumination+Rollout |
| `gi.secondary` | OK | — (options None / Brute force / Light cache verbatim; "by default Brute Force has 3 light bounces and Light Cache works with 100" verbatim; None = "skylit images without indirect color bleeding" verbatim) | https://docs.chaos.com/display/VMAX/Global+Illumination+Rollout |

## PACKS.vantage33 — per-entry verdicts (20 OK / 7 WRONG)

| id | verdict | issue | doc URL |
|---|---|---|---|
| `env.mode` | OK | — (Sky rollout ▸ Settings tab; "Environment mode – Texture / Solid Color / Physical Sky"; "Available only when the imported .vrscene has VRaySky texture" verbatim) | https://docs.chaos.com/display/LAV/Sky |
| `env.hdri_slot` | OK | — ("Load environment – Loads an image for the Environment" in Texture Mode; RGB color space Auto/Raw/sRGB/ACEScg confirmed) | https://docs.chaos.com/display/LAV/Sky |
| `env.intensity` | OK | — (Intensity present in Texture, Solid Color AND Physical Sky mode parameter lists) | https://docs.chaos.com/display/LAV/Sky |
| `env.rotation` | OK | — ("Rotation – Specifies a rotation angle in degrees for the Environment texture" verbatim, Texture mode) | https://docs.chaos.com/display/LAV/Sky |
| `env.background_mode` | OK | — ("Mode – … Same as environment / Solid color / Image"; "the Background texture is not used for lighting and glossy reflections" verbatim) | https://docs.chaos.com/display/LAV/Background |
| `env.sky_model` | OK | — (all 6 options verbatim incl. "PRG Clear Sky (old)"; updated-PRG facts — altitude, −12° twilight, turbidity 1.81–4.89 — verbatim) | https://docs.chaos.com/display/LAV/Sky |
| `sun.enabled` | **WRONG** | stale location: default sun is Environment tab ▸ Sun and Moon ▸ Sun tab; only imported suns are in the Lights tab; "Basic settings" is not the current grouping. See correction block. | https://docs.chaos.com/display/LAV/Sun+and+Moon |
| `sun.intensity` | **WRONG** | same location issue (control name Intensity correct in both locations) | https://docs.chaos.com/display/LAV/Sun+and+Moon |
| `sun.size` | **WRONG** | same location issue + label is "Sun size" on the default sun ("Sun size mult." only on imported Sun Light) | https://docs.chaos.com/display/LAV/Sun+and+Moon |
| `sun.position_mode` | **WRONG** | same location issue + label is "Sun position" on imported Sun Light ("Sun position mode" on the default sun); options correct | https://docs.chaos.com/display/LAV/Sun+and+Moon |
| `sun.azimuth` | **WRONG** | same location issue (control + Altitude/Azimuth gating correct) | https://docs.chaos.com/display/LAV/Sun+and+Moon |
| `sun.elevation` | **WRONG** | same location issue (control name Altitude correct; −12° twilight bound doc-true) | https://docs.chaos.com/display/LAV/Sun+and+Moon |
| `sun.color_mode` | **WRONG** | same location issue (options Filter/Direct/Override correct; no-Kelvin claim correct) | https://docs.chaos.com/display/LAV/Sun+and+Moon |
| `cam.exposure_mode` | OK | — (advanced "Exposure – … None / Physical / Value"; "Physical – … Grays out Exposure value" / "Value – … Grays out the ISO parameter" verbatim; startup default genuinely unprinted → `verified:false` correct) | https://docs.chaos.com/display/LAV/Camera+Tab |
| `cam.exposure_value` | OK | — ("Exposure Value – Controls the image brightness" in the advanced Exposure group; Sky-page twilight examples use "Exposure Value = 10"; default unprinted → `verified:false` correct) | https://docs.chaos.com/display/LAV/Camera+Tab |
| `cam.auto_exposure` | OK | — ("Toggle auto-exposure – Enables/disables automatic calculation of exposure. When enabled, ignores set camera exposure" verbatim on the Viewport bar ▸ Exposure cluster; startup state unprinted → `verified:false` correct) | https://docs.chaos.com/display/LAV/Viewport+Bar |
| `cam.wb` | OK | — (color-swatch semantics + "White balance only works when Exposure is set to either Physical or Value. When Exposure is None, White balance is disabled" verbatim; no Kelvin field on the camera confirmed) | https://docs.chaos.com/display/LAV/Camera+Tab |
| `cam.dof_note` | OK | — (DoF toggle + advanced Focus distance / Aperture size / Optical vignetting all present; "it is recommended to use the Optical vignetting option in the Advanced Depth of field settings instead of the Vignetting option" verbatim) | https://docs.chaos.com/display/LAV/Camera+Tab |
| `post.exposure_corrections` | OK | — ("Exposure corrections – Turns on/off exposure corrections"; Viewport bar "Toggle Color Corrections" cross-ref confirmed) | https://docs.chaos.com/display/LAV/Color+Corrections+Tab |
| `post.exposure_bias` | OK | — ("Exposure bias – Adjusts the Exposure bias value"; also on the Viewport bar, confirmed) | https://docs.chaos.com/display/LAV/Color+Corrections+Tab |
| `post.highlight_burn` | OK | — ("Highlight burn – Applies exposure corrections to highlights in the image. This option is hidden when Filmic tonemap is on" verbatim; [0,1]/1.0 correctly flagged as convention, not doc-stated → `verified:false` correct) | https://docs.chaos.com/display/LAV/Color+Corrections+Tab |
| `post.contrast` | OK | — ("Positive values push the colors away from the medium gray value … Negative values push the colors closer to medium grey" verbatim) | https://docs.chaos.com/display/LAV/Color+Corrections+Tab |
| `post.tonemap_type` | OK | — ("Type – … You can choose between Hable and AMPAS" verbatim — genuinely fewer curve types than the VMAX VFB's five (Linear, Hejl-Dawson, AMPAS, Hable, Power Curve); Filmic-on hides Highlight burn confirmed; default unprinted → `verified:false` correct) | https://docs.chaos.com/display/LAV/Color+Corrections+Tab |
| `post.saturation` | OK | — ("Positive values produce a more vibrant, saturated image while negative values desaturate and dull the image colors" verbatim; Hue / Saturation is a toggle group; see advisory A2 on the ±100 scale) | https://docs.chaos.com/display/LAV/Color+Corrections+Tab |
| `post.wb_kelvin` | OK | — ("Temperature – Adjusts the white balance of the image by specifying the color temperature in Kelvin. Lower values make the image bluer, higher ones make it more amber" verbatim) | https://docs.chaos.com/display/LAV/Color+Corrections+Tab |
| `post.wb_tint` | OK | — ("Magenta-Green tint – … greener (positive values) or more purple (negative values)" verbatim) | https://docs.chaos.com/display/LAV/Color+Corrections+Tab |
| `render.quality_preset` | OK | — ("Sets the quality of the render – Available options are: Low, Medium, High, Ultra, and Custom" verbatim on Viewport bar ▸ Render; per-preset GI facts confirmed (Low: GI Off; Medium: GI On, 2 bounces; High: 3; Ultra: 4); startup preset unprinted → `verified:false` correct) | https://docs.chaos.com/display/LAV/Viewport+Bar |

---

## Advisories (verdict OK, but worth acting on)

- **A1 — VFB color-correction layers are user-added, not default-present.** The Layers page states
  the default stack is "The Stamp, Display Correction, Sharpen/Blur, Denoiser, Lens Effects,
  Backgrounds and Foregrounds and Source layers are listed in the Layers panel by default". The
  Exposure, White Balance and Hue/Saturation layers referenced by `cm.contrast`, `cm.saturation`,
  `vfb.exposure`, `vfb.wb_kelvin` must first be created via the Layers panel's create-layer (+)
  menu ("Exposure – Adds an Exposure color correction layer", etc.). Suggest one sentence in those
  entries' notes ("add the layer via Layers panel ▸ + if not present") so a recipe is followable on
  a fresh VFB. (https://docs.chaos.com/display/VMAX/Layers)
- **A2 — ±100 saturation/tint scales are unverifiable from docs.** No Chaos page (VMAX Layers, LAV
  Color Corrections, other-host VFB pages checked) prints the slider bounds for
  Saturation/Magenta-Green tint; the entries already declare "slider bounds not stated in docs".
  Residual risk: if the actual sliders are −1..1 rather than −100..100, emitted values would be
  mis-scaled 100×. Recommend a one-time UI spot-check in 3ds Max + Vantage to stamp the true
  bounds for `cm.saturation`, `post.saturation`, `post.wb_tint` (and while there, the ±1 contrast
  and ±5-stop exposure clamps).
- **A3 — stale "Intensity rollout" cross-references in the VMAX light pages.** The Dome and
  Plane/Disc/Sphere pages' Options-rollout text mentions "the Color or Temperature setting in the
  Intensity rollout", but the pages' own parameter structure — and the VRayLight overview page
  ("The light type is set or changed with the Type parameter in the VRayLight **General
  rollout**"), plus UI screenshot attachments (`max2022_60010_domeLight_general.png`,
  `VRayLight_General_ALL_MAX.png`) — put Multiplier/Mode/Color/Temperature/Map in the **General
  rollout**, which is what the pack says. No pack change needed; noted so a future doc refresh
  isn't misread as contradicting the pack. (https://docs.chaos.com/display/VMAX/VRayLight)
- **A4 — a few `verified:"2026-07-02"` defaults are neutral-derivations, not doc-printed values**
  (e.g. `sun.color_mode` "Filter", `env.gi_skylight_mult` 1.0, `vfb.wb_kelvin`/`post.wb_kelvin`
  6500-as-neutral). This matches the pack's stated derivation policy and each notes field says so;
  flagged only for completeness.

## Source pages (all re-read 2026-07-03 via the Confluence API)

| Space/Title | Page id | Last modified | API URL |
|---|---|---|---|
| VMAX VRaySun | 113587755 | 2026-04-22 | `https://docs-chaos.atlassian.net/wiki/rest/api/content?spaceKey=VMAX&title=VRaySun&expand=body.view` |
| VMAX Dome Light | 113575431 | 2026-04-22 | `…spaceKey=VMAX&title=Dome+Light…` |
| VMAX Plane - Disc - Sphere Light | 113587751 | 2026-04-22 | `…spaceKey=VMAX&title=Plane+-+Disc+-+Sphere+Light…` |
| VMAX VRayLight (overview) | 113586936 | 2026-04-22 | `…spaceKey=VMAX&title=VRayLight…` |
| VMAX VRayBitmap | 113575830 | 2026-04-24 | `…spaceKey=VMAX&title=VRayBitmap…` |
| VMAX VRayPhysicalCamera | 113586662 | 2026-05-21 | `…spaceKey=VMAX&title=VRayPhysicalCamera…` |
| VMAX Environment Settings | 113587655 | 2026-05-21 | `…spaceKey=VMAX&title=Environment+Settings…` |
| VMAX Color Mapping | 113575645 | 2026-05-21 | `…spaceKey=VMAX&title=Color+Mapping…` |
| VMAX Global Illumination Rollout | 113587715 | 2026-05-21 | `…spaceKey=VMAX&title=Global+Illumination+Rollout…` |
| VMAX Universal V-Ray Settings | 113587869 | 2026-05-22 | `…spaceKey=VMAX&title=Universal+V-Ray+Settings…` |
| VMAX Layers (VFB) | 113588521 | 2026-05-21 | `…spaceKey=VMAX&title=Layers…` |
| VMAX MAXScript (defaults probe) | 113575613 | 2026-05-07 | `…spaceKey=VMAX&title=MAXScript…` |
| LAV Sky | 125079281 | 2026-02-27 | `…spaceKey=LAV&title=Sky…` |
| LAV Environment Tab | 124490991 | 2026-06-11 | `…spaceKey=LAV&title=Environment+Tab…` |
| LAV Background | 124654857 | 2026-03-19 | `…spaceKey=LAV&title=Background…` |
| LAV Sun and Moon | 125275477 | 2026-02-27 | `…spaceKey=LAV&title=Sun+and+Moon…` |
| LAV Sun Light | 125275692 | 2026-02-27 | `…spaceKey=LAV&title=Sun+Light…` |
| LAV Vantage Default Sun (legacy ref) | 124357222 | 2026-03-19 | `…spaceKey=LAV&title=Vantage+Default+Sun…` |
| LAV Lights Tab | 125306489 | 2026-06-23 | `…spaceKey=LAV&title=Lights+Tab…` |
| LAV Camera Tab | 125046841 | 2026-07-01 | `…spaceKey=LAV&title=Camera+Tab…` |
| LAV Viewport Bar | 125272932 | 2026-06-23 | `…spaceKey=LAV&title=Viewport+Bar…` |
| LAV Color Corrections Tab | 125273373 | 2026-06-15 | `…spaceKey=LAV&title=Color+Corrections+Tab…` |
| LAV What's New (v3.3.0) | — | 2026-06-11 | `…spaceKey=LAV&title=What%27s+New…` |

*(Ancestry/link checks: `…/wiki/rest/api/content/<id>?expand=ancestors` for ids 124357222,
125275692, 125275477; raw `body.view` of 125275692 for the "Sun page" link target; attachment
listing `…/content/<id>/child/attachment` for 113575431 and 113587751.)*
