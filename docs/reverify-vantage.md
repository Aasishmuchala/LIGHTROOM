# Independent re-verification — PACKS.vantage33 vs live Chaos Vantage 3.3 docs

**Date:** 2026-07-03 · **Verifier:** adversarial second-pass audit, done from scratch against live
Chaos documentation only. The prior verdict files (`docs/settings-audit-existing.md`,
`docs/settings-research-atmospherics.md`) were **not read**; `docs/pack-verification.md` was used
solely for the Confluence API URL pattern, not for verdicts.

**Method.** Every page body pulled in full via the public Confluence Cloud REST API
(`https://docs-chaos.atlassian.net/wiki/rest/api/content?spaceKey=LAV&title=<Title>&expand=body.view,version,history.lastUpdated`),
HTML stripped locally, and each of the 47 `PACKS.vantage33` entries in `lightmatch.html`
(lines 582–737) checked against the exact page text. Canonical citations below use
`docs.chaos.com/display/LAV/<Page>` (301 → documentation.chaos.com); every page resolved.

Pages fetched (version / last-updated):
Environment Tab v9 2026-06-11 · Sky v7 2026-02-27 · Background v3 2026-03-19 ·
Sun and Moon v4 2026-02-27 · Sun Light v10 2026-02-27 · Vantage Default Sun v11 2026-03-19 ·
Lights Tab v8 2026-06-23 · Camera Tab v6 2026-07-01 · Viewport Bar v8 2026-06-23 ·
Color Corrections Tab v6 2026-06-15 · Fog v3 2026-02-27 · Clouds v5 2026-02-27 ·
Wetting v2 2026-06-15 · What's New v16 2026-06-11 (v3.3.0, official release June 11, 2026).

## Summary

| Verdict | Count |
|---|---|
| **OK** | **47** |
| **WRONG** | **0** |
| **UNCERTAIN** | **0** |

- **The 7 relocated `sun.*` paths are confirmed correct.** The Confluence page tree places
  *Sun and Moon* under `User Interface > Right Side Panel > Environment Tab`, the page states
  "The Sun and Moon rollout is located under the Environment tab in the right-hand side panel"
  with a "Sun tab", and the current *Sun Light* page routes Default-Vantage-Sun readers directly
  to the Sun and Moon page (`/wiki/spaces/LAV/pages/125275477/Sun+and+Moon`). The Sun-tab labels
  match the pack exactly: Enabled, Intensity, **Sun size**, Sun position mode
  (Manual | Altitude/Azimuth | Geolocation | Animated Geolocation), Azimuth, **Altitude**,
  Color mode (Filter | Direct | Override). The imported-sun label divergences noted in the pack
  ("Sun size mult.", "Sun position" on the Lights-tab Sun Light) are printed verbatim on the
  Sun Light page.
- **No invented atmosphere/weather params.** All fog (simple ×2-layer + scattering), clouds
  (incl. the "available when the Environment mode is set to Physical sky in the Sky rollout"
  gate, printed verbatim), and Wetting (Beta) controls exist under the exact names used —
  including "Enable wetting (Beta)" (Settings) and "Wet cover" (General tab, doc-stated
  "0% keeps surfaces dry; 100% makes surfaces uniformly wet"). Wet effects (Beta) confirmed as
  new in v3.3.0 on What's New.
- **All 18 `verified:false` flags are legitimate.** A sweep of every fetched page for printed
  defaults found only three (Stars size, Moon Filter color, Sun Shadows on-state) — none of them
  pack entries. No entry claims "not printed in docs" for a value the docs actually print.
- Six notes-level remarks (below), none verdict-changing.

## Per-entry table

Doc URLs: `D` = https://docs.chaos.com/display/LAV/… (canonical) — API equivalent is
`https://docs-chaos.atlassian.net/wiki/rest/api/content?spaceKey=LAV&title=<Title>&expand=body.view`.

| id | verdict | issue | doc URL |
|---|---|---|---|
| env.mode | OK | Options exact: "Texture / Solid Color / Physical Sky"; Physical Sky "Available only when the imported .vrscene has VRaySky texture"; Settings tab confirmed | D/Sky |
| env.hdri_slot | OK | "Load environment – Loads an image for the Environment" (Texture Mode); RGB color space Auto/Raw/sRGB/ACEScg | D/Sky |
| env.intensity | OK | Intensity listed under all three modes; 1.0 neutral derived, range declared practical | D/Sky |
| env.rotation | OK | "Rotation – Specifies a rotation angle in degrees for the Environment texture" (Texture Mode) | D/Sky |
| env.background_mode | OK | Options exact: Same as environment / Solid color / Image; "the Background texture is not used for lighting and glossy reflections" | D/Background |
| env.sky_model | OK | All 6 options verbatim incl. "PRG Clear Sky (old)"; updated PRG: observer altitude, twilight to −12°, turbidity 1.81–4.89 — all printed | D/Sky |
| sun.enabled | OK | Sun and Moon rollout ▸ Sun tab ▸ "Enabled – Turns on and off the sun light"; imported suns = Lights-tab "Sun Light" (import-only per its page) | D/Sun+and+Moon · D/Sun+Light |
| sun.intensity | OK | "Intensity – …can be used to reduce the default brightness"; 1.0 physical-neutral derived (remark 2); examples 0.05/0.5/1 | D/Sun+and+Moon |
| sun.size | OK | Label "Sun size" on Sun tab; sharp-vs-soft shadow semantics printed; imported label "Sun size mult." printed on Sun Light | D/Sun+and+Moon · D/Sun+Light |
| sun.position_mode | OK | "Sun position mode" with all 4 options verbatim; imported label "Sun position" printed on Sun Light; default is doc-silent, entry notes scene-dependence (remark 2) | D/Sun+and+Moon · D/Sun+Light |
| sun.azimuth | OK | "Azimuth – Sets the azimuth position (in degrees)…" under Altitude/Azimuth Mode; 90°=East convention printed for the Moon param on the same page, not the Sun line (remark 1) | D/Sun+and+Moon |
| sun.elevation | OK | Vantage label is "Altitude", gated on Altitude/Azimuth mode; −12° twilight printed on Sky (PRG); Sky's Night-blueness text discusses −12°…−18°, anchoring the −18 practical bound | D/Sun+and+Moon · D/Sky |
| sun.color_mode | OK | "Color mode" options Filter/Direct/Override with exact semantics; no Kelvin control anywhere on the sun — confirmed; Filter+white neutral derived (remark 2) | D/Sun+and+Moon |
| cam.exposure_mode | OK | Advanced Exposure ▸ "Exposure": None / Physical ("Grays out Exposure value") / Value ("Grays out the ISO parameter"); default doc-silent → verified:false justified | D/Camera+Tab |
| cam.exposure_value | OK | "Exposure Value – Controls the image brightness"; basic-panel text confirms "when the Value mode is selected"; EV-10 twilight example printed on Sky; default doc-silent → verified:false justified (remark 6) | D/Camera+Tab · D/Sky |
| cam.auto_exposure | OK | Viewport bar ▸ Exposure ▸ "Toggle auto-exposure … When enabled, ignores set camera exposure" — verbatim; startup state doc-silent → verified:false justified | D/Viewport+Bar |
| cam.wb | OK | "White balance – …Objects in the scene that have the specified color appear white"; "only works when Exposure is set to either Physical or Value" printed; no camera Kelvin field exists | D/Camera+Tab |
| cam.dof_note | OK | DOF toggle + advanced Focus distance / Aperture size / Optical vignetting all printed; "recommended to use the Optical vignetting option … instead of the Vignetting option" printed | D/Camera+Tab |
| post.exposure_corrections | OK | "Exposure corrections – Turns on/off exposure corrections" heading the bias/burn/contrast group; Viewport-bar "Toggle Color Corrections" printed | D/Color+Corrections+Tab · D/Viewport+Bar |
| post.exposure_bias | OK | "Exposure bias – Adjusts the Exposure bias value" in tab AND on Viewport bar | D/Color+Corrections+Tab · D/Viewport+Bar |
| post.highlight_burn | OK | "Highlight burn – …This option is hidden when Filmic tonemap is on" — verbatim; range/neutral doc-silent → verified:false justified | D/Color+Corrections+Tab |
| post.contrast | OK | Positive-away-from-medium-gray / negative-toward semantics printed verbatim | D/Color+Corrections+Tab |
| post.tonemap_type | OK | "Type – …choose between Hable and AMPAS" under Filmic tonemap; Highlight-burn interaction printed; default doc-silent → verified:false justified | D/Color+Corrections+Tab |
| post.saturation | OK | Hue/Saturation layer ▸ "Saturation – Positive values produce a more vibrant, saturated image while negative values desaturate"; slider bounds unprinted — 100x-mismatch caveat honest | D/Color+Corrections+Tab |
| post.wb_kelvin | OK | "Temperature – …in Kelvin. Lower values make the image bluer, higher ones make it more amber" — verbatim; "requires toggle ON" is UI-consistent inference (remark 3) | D/Color+Corrections+Tab |
| post.wb_tint | OK | "Magenta-Green tint – …greener (positive values) or more purple (negative values)" — verbatim; bounds-unprinted caveat honest (remark 3) | D/Color+Corrections+Tab |
| render.quality_preset | OK | Render group "Sets the quality of the render": Low/Medium/High/Ultra/Custom; per-preset GI values printed exactly (Low GI Off; Medium GI On, 2 bounces; …); startup doc-silent → verified:false justified | D/Viewport+Bar |
| fog.enabled | OK | "Enable fog – Enables aerial perspective fog"; "Enable fog 2" second layer printed; examples titled "Simple Fog 1"; Viewport-bar Atmosphere view names Simple fog 1/2 + Scattered fog | D/Fog · D/Viewport+Bar |
| fog.visibility_range | OK | "distance in km at which the fog has absorbed 90% of the light" — km unit printed; examples 10/50/100/150; default doc-silent → verified:false justified | D/Fog |
| fog.height | OK | "height of the fog layer in meters"; examples 100–2000; default doc-silent → verified:false justified | D/Fog |
| fog.start_distance | OK | "distance from the camera at which the fog starts"; unit genuinely unprinted; examples 0–20000; 0 = derived neutral | D/Fog |
| fog.max_opacity | OK | "A value of 1 means the fog is completely opaque, while 0 means the fog is invisible" — doc-stated scale; examples 0.01–1; default doc-silent → verified:false justified | D/Fog |
| fog.color | OK | "Fog color – Specifies the color of the fog layer"; examples white/blue/grey/orange/yellow | D/Fog |
| fog.scatter_enabled | OK | "Enable scattering fog – Enables scattering volumetric fog"; every folded sub-control (Fog transparency, Fog emission, Fog start/end, Fog max opacity w/ "light shaft", Fog light boost ex.1–8, Affect secondary rays, Scatter only infinite direct lights) printed | D/Fog |
| fog.scatter_distance | OK | Scattering "Fog distance – Specifies the fog density. Larger values make the fog more transparent"; examples 5–30; unit unprinted; default doc-silent → verified:false justified | D/Fog |
| fog.scatter_height | OK | Scattering "Fog height – …in meters"; examples 2/4/8/16; default doc-silent → verified:false justified | D/Fog |
| fog.scatter_gi | OK | "Scatter GI – …can be quite slow … can be substituted with a simple emission term" — verbatim; state doc-silent → verified:false justified | D/Fog |
| fog.scatter_texture_mode | OK | "Available options are Off, Built-in smoke density, and From V-Ray scene" — verbatim; Smoke size(m)/num iterations/exponent + Ground fog + Raymarch trio printed under BOTH texture modes | D/Fog |
| clouds.enabled | OK | "Enable clouds – Enables the cloud system"; gate printed verbatim: "The Clouds rollout is available when the Environment mode is set to Physical sky in the Sky rollout"; Ground shadows + Improved shading (offline-better note) printed | D/Clouds |
| clouds.density | OK | "A value of 100% fills up the sky" with 0/0.4/0.8 examples — the pack's 0–1-scale note mirrors the doc's own %-vs-decimal split; Density multiplier folded text verbatim; default doc-silent → verified:false justified | D/Clouds |
| clouds.variety | OK | "Variety – Specifies the variety of the cumulus and stratus types"; examples 0/0.5/1; default doc-silent → verified:false justified | D/Clouds |
| clouds.cirrus_amount | OK | "maximum value of 1 fills the sky with cirrus clouds. When set to 0 … completely gone" — doc-stated scale; "high altitude, wispy" from the example text; default doc-silent → verified:false justified | D/Clouds |
| clouds.start_height | OK | Clouds positioning settings ▸ "Start height – Specifies the clouds' starting height position"; examples 500/1000/1500; unit genuinely unprinted; default doc-silent → verified:false justified | D/Clouds |
| clouds.thickness | OK | Positioning ▸ "Thickness – …thin and sheer/lucent … full and heavy" — verbatim; examples 200/500/800; unit unprinted; default doc-silent → verified:false justified | D/Clouds |
| clouds.detail | OK | "Random seed – …change the pattern of the clouds and the Contrails" (Clouds settings); Phase X/Y "loops at 0, 100, 200" + Offset X/Y (positioning); contrails: enable + count slider (ex. 5/20/40, "spread randomly"), strength ("less opaque … look older"), distortion, offset X/Y, time (anim 0–2.0) — all printed | D/Clouds |
| wet.enabled | OK | "Enable wetting (Beta) – Enables a global wetting effect on material surfaces" under Settings — exact name+location; overview lists darkened diffuse / glossier coat / puddles / beaded drops; General(Size,Puddles,Occlusion)+Drops and Ripples+Advanced tabs all real; Beta new in v3.3.0 per What's New | D/Wetting · D/What%27s+New |
| wet.amount | OK | General tab ▸ "Wet cover – Surface coverage of the wetting effect when fully rained on. 0% keeps surfaces dry; 100% makes surfaces uniformly wet" — verbatim incl. % scale; the separate droplet "Amount" correctly distinguished; factory value doc-silent → verified:false justified | D/Wetting |

## Remarks (notes-level, non-blocking)

1. **sun.azimuth** — "0 = North, 90 = East" is printed only for the *Moon's* Azimuth on the same
   Sun and Moon page ("measured from the scene North to Eastward. A value of 90 aligns with …
   East"); the Sun's line just says "Sets the azimuth position (in degrees)". Calling it "docs
   convention" is a same-rollout inference — reasonable, but worth knowing it isn't printed on
   the Sun parameter itself.
2. **sun.intensity / sun.size / sun.position_mode / sun.color_mode / sun.enabled defaults** — the
   docs print no factory values for any Sun-tab parameter. The entries carry derived-neutral or
   scene-dependent defaults with the derivation/qualifier stated in notes, which matches the
   pack's own published policy; just don't read those `default` fields as doc-printed facts.
3. **post.wb_kelvin / post.wb_tint** — "Requires the White balance toggle ON": the Color
   Corrections page prints an explicit toggle line for most layers (e.g. "Hue / Saturation –
   Applies HSL transformation…") but **not** for the White balance section. The toggle claim is
   UI-consistent inference, not doc text.
4. **"Physical Sky" vs "Physical sky"** — the Sky page capitalizes "Physical Sky" in the mode
   list; the Clouds page's gating sentence writes "Physical sky". The pack mirrors each page
   faithfully; the inconsistency is Chaos's, not LightMatch's.
5. **Vantage Default Sun page still exists** (v11, 2026-03-19, tree: `Chaos Vantage Home > Lights >
   Vantage Default Sun`) and still describes the old "Basic settings" grouping with "Sun size
   mult". It is *not* part of the Right Side Panel UI reference, is no longer linked from the
   Lights Tab page, and the current Sun Light page redirects Default-Sun readers to the Sun and
   Moon page — so it cannot be used to argue the old `Lights tab ▸ Basic settings` paths. The
   pack's relocation stands.
6. **cam.exposure_value "HIGHER = darker"** — standard photographic-EV semantics, not literally
   printed; consistent with the Sky page pairing EV 10 with below-horizon (darker) sun positions.

## verified:false audit (18 entries)

`cam.exposure_mode, cam.exposure_value, cam.auto_exposure, post.highlight_burn,
post.tonemap_type, render.quality_preset, fog.visibility_range, fog.height, fog.max_opacity,
fog.scatter_distance, fog.scatter_height, fog.scatter_gi, clouds.density, clouds.variety,
clouds.cirrus_amount, clouds.start_height, clouds.thickness, wet.amount` — for every one, the
control name/location/options were confirmed on the cited page and the flagged value is genuinely
absent from the live docs. A full-text sweep of all fetched pages for "default" found printed
defaults only for Stars size (1), Moon Filter color (white 1,1,1), and Sun Shadows (on) — none of
which are pack entries.
