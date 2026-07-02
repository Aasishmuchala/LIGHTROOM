# Independent re-verification — PACKS.vray7max vs live Chaos docs

**Date:** 2026-07-03 (adversarial re-audit, from scratch; prior audit files deliberately NOT read)
**Scope:** all 51 entries of `PACKS.vray7max` in `lightmatch.html` (SECTION: PACKS), including the step-6 atmosphere group (`fog.*`, `aerial.*`, `clouds.*`).
**Method:** every claim checked against the live page bodies pulled through the public Confluence Cloud REST API at `docs-chaos.atlassian.net` (space **VMAX** = V-Ray 7 for 3ds Max, space **LAV** for one Vantage cross-reference), `/wiki/rest/api/content/<id>?expand=body.view`. No auth, JS-free, full rendered body. WebFetch on docs.chaos.com is empty (JS-rendered) — not used.

## Pages consulted (live version at check time)

| Page (space VMAX unless noted) | id | version (date) |
|---|---|---|
| Environment Settings | 113587655 | v21 (2026-05-21) |
| VRayLight (overview) | 113586936 | v14 (2026-04-22) |
| Dome Light | 113575431 | v38 (2026-04-22) |
| Plane - Disc - Sphere Light | 113587751 | v41 (2026-04-22) |
| VRayBitmap | 113575830 | v55 |
| VRaySun | 113587755 | v71 (2026-04-22) |
| VRaySky | 113575846 | v31 (2026-04-28) |
| VRayPhysicalCamera | 113586662 | v56 |
| Color Mapping | 113575645 | v28 (2026-05-21) |
| Layers (V-Ray Frame Buffer) | 113588521 | v149 |
| Global Illumination Rollout | 113587715 | v30 (2026-05-21) |
| Universal V-Ray Settings | 113587869 | — |
| VRayEnvironmentFog | 113575533 | v52 (2026-05-05) |
| VRayAerialPerspective | 113575363 | v24 (2026-05-05) |
| Clouds (Vantage, space LAV) | 125079048 | — |

API URL pattern for every citation below: `https://docs-chaos.atlassian.net/wiki/rest/api/content/<id>?expand=body.view`

---

## Summary

| Verdict | Count |
|---|---|
| **OK** | **50** |
| **WRONG** | **0** |
| **UNCERTAIN** | **1** (`cm.saturation` — range only) |

**Headline result: no WRONG entries.** Every ui_path names a control that exists at that exact rollout/panel/menu location with that exact label on the current V-Ray 7 doc pages, every dropdown option list matches the docs' current options, and every doc-stated range/default in the pack matches the doc text. The five specifically-challenged atmosphere facts all held:

1. **VRayEnvironmentFog is added via `Rendering menu > Environment > Add > VRayEnvironmentFog`** — verbatim UI Path on the VRayEnvironmentFog page (113575533).
2. **"Inscattered light intensity" is a real VRayAerialPerspective parameter** — "Inscattered light intensity – Controls the amount of sunlight scattered from the atmospheric effect. The default value 1.0 is physically accurate" (113575363). Pack default 1.0 is doc-stated.
3. **Clouds really live on VRaySun** — the `## Clouds` section ("Clouds on – Enables the cloud system", Density, Density multiplier, Variety, Seed, Cirrus amount, Offset X/Y (m), Height (m), Thickness (m), Phase X/Y (%), contrail params) is on the VRaySun page (113587755). The VRaySky page (113575846) has **no** cloud parameters and confirms the sky "automatically takes its parameters from the active VRaySun that was created last".
4. **No invented atmosphere param found.** Every folded sub-param in the notes (Scatter bounces, Fog emission, Affect environment rays, Seed, Phase/Offset, all six contrail controls) exists on the cited page with matching semantics and doc example values (contrails 5–40, strength 0.1–1.0, time 0–2; offsets −250/500; phase loops at 0/100/200).
5. **VRaySun has no azimuth/elevation spinners and no Kelvin spinner** — Sun Parameters contains only Enabled, Intensity multiplier, Size multiplier, Filter color, Color mode (filter | direct | override, exactly three). Positioning is viewport placement or the 3ds Max Daylight system with VRaySun as Sunlight, both doc-confirmed.

**Most serious findings (all advisory, none doc-contradicting):**

- **A1 — `sun.placement_elevation` range [0, 90] excludes doc-supported twilight.** VRaySky (113575846): the V-Ray 7 PRG Clear Sky model "supports rendering of nautical twilight effects with sun positions up to 12 degrees below the horizon", and VRaySun's Night blueness text discusses solar elevations to −18°. The sibling `vantage33` pack already uses [−18, 90] for the same concept. A sunset/blue-hour reference would have its negative elevation clamped to 0 by `PACKS.clamp`. Recommend widening to **[−12, 90]** (or [−18, 90] to match Vantage).
- **A2 — six entries carry a dated `verified:` stamp while their stated default is not literally printed in the docs** (all are neutral/identity values, so no factual risk, but they are inconsistent with the pack's own `verified:false` convention): `env.gi_skylight_on` ("off"), `env.gi_skylight_mult` (1.0), `dome.rotation_h` (0), `sun.intensity_mult` (1.0), `sun.size_mult` (1.0), `cm.contrast` (0). By contrast, entries like `vfb.wb_kelvin`/`clouds.density_mult`/`fog.color` do declare "derived, not doc-stated" inline — the six above could add the same wording or flip to `verified:false`.
- **A3 — `cm.saturation` range [−100, 100] cannot be established from docs** (the entry itself already flags the possible 100× scale mismatch and demands an in-product check — docs print no slider bounds; the Hue/Saturation layer section only says "Lower Saturation values move the image towards greyscale while higher values increase the colors' intensities"). Kept UNCERTAIN until someone drags the slider in the product.
- Spot-checks of `verified:false` entries confirmed the docs genuinely print no factory default for them (dome/plane/sphere Multiplier, Temperature, ISO/F-Number/Shutter, Turbidity, Fog distance/height, cloud Density/Variety/Height/Thickness, aerial ranges) — the flags are honest, not lazy.

---

## Per-entry verdicts

Doc URL column = Confluence API id; prepend `https://docs-chaos.atlassian.net/wiki/rest/api/content/` and append `?expand=body.view`.

| id | verdict | issue | doc URL (id) |
|---|---|---|---|
| env.gi_skylight_on | OK | Path + control verbatim: "Render Setup window > V-Ray tab > Environment rollout", group "GI Environment (Skylight)", "On – Turns on and off the GI environment override". Default "off" not doc-printed (neutral) — see A2. | 113587655 |
| env.gi_skylight_mult | OK | "Multiplier – A multiplier for the color value... does not affect the environment texture... Use an Output map" — notes match doc verbatim. Default 1.0 not doc-printed — see A2. | 113587655 |
| dome.texture_slot | OK | Dome Light > General Rollout > "Map – Enables the use of a texture for the light surface. The button selects the map to use." Nit: "texture overrides Color/Temperature (docs)" — override wording is not literally on the Dome page (functionally true; explicit override wording exists only for environment textures on 113587655). | 113575431 |
| dome.intensity | OK | General rollout Multiplier exists; "Default (image) – The color and multiplier directly determine the visible color" + "texture intensity is also affected by the Multiplier". verified:false honest — no factory value printed. | 113575431 |
| dome.rotation_h | OK | VRayBitmap > Mapping > "Horiz. rotation – Allows left and right rotation of the environment map. Ignored when the Mapping type is 3ds Max standard" — verbatim. "Lock texture to icon" alternative confirmed in Dome Light Rollout. Default 0 not doc-printed — see A2. | 113575830, 113575431 |
| dome.invisible | OK | Options rollout > Invisible: "only affects the visibility of the light when seen directly by the camera or through refractions" + GI note ("still taken into account by Global Illumination calculations") — notes match. Default-off supported by "By default, V-Ray renders the light source if it is seen in the camera" (113587751). | 113575431 |
| dome.temperature | OK | General rollout > Mode = Temperature: "the color of both light rays and the light source itself is specified by the Temperature value expressed in Kelvin". verified:false honest. | 113575431 |
| sun.placement_azimuth | OK | Confirmed NO azimuth control in Sun Parameters; "You can also specify the VRaySun as the sun type inside a 3ds Max Daylight system" + "Daylight system > Daylight Parameters VRaySun is set as the Sunlight". Compass convention matches doc's "measured from the scene North to Eastward. A value of 90 aligns with the X-axis in 3ds Max or East". Nit: Daylight Position also offers "Weather Data File" (Max-native, omitted; harmless in an instruction row). | 113587755 |
| sun.placement_elevation | OK | Placement instruction correct; "the sun position also changes the appearance of the sky and the sun light color" confirmed. **Advisory A1:** range [0,90] excludes twilight (docs support sun to −12° with PRG Clear Sky; Vantage twin uses [−18,90]). | 113587755, 113575846 |
| sun.intensity_mult | OK | "Intensity multiplier – An intensity multiplier for the VRaySun. Since the sun is very bright by default..." in Sun Parameters; Notes section confirms color-mapping/physical-camera preferred over lowering it. Default 1.0 not literally printed — see A2. | 113587755 |
| sun.size_mult | OK | "Size multiplier – Controls the visible size of the sun... as well as the blurriness of the sun shadows"; example: "overall illumination strength remains the same", values 4.0/10.0/40.0 — notes verbatim. | 113587755 |
| sun.kelvin | OK | Confirmed NO Kelvin spinner on VRaySun; Color mode = exactly "filter | direct | override" with matching semantics; physical color via position/Turbidity/Ozone confirmed. | 113587755 |
| sun.turbidity | OK | Turbidity is under **Sky Parameters** (doc section heading) — location right; "Smaller values produce a clear and blue sky and sun... larger values make them yellow and orange"; examples 2.0/4.0/8.0. verified:false honest (doc examples elsewhere hold "Turbidity: 3.0" constant, consistent with the assumed 3.0). | 113587755 |
| fill.plane_intensity | OK | General Rollout > Multiplier; "With the Default (image), Luminance and Radiance settings, the light's intensity is directly affected by the size of the light source". verified:false honest (30 assumed). | 113587751 |
| fill.plane_kelvin | OK | Mode = Temperature in General Rollout. verified:false honest. | 113587751 |
| fill.sphere_intensity | OK | Same Multiplier; size-affects-intensity for Default/Luminance/Radiance units — doc verbatim. verified:false honest. | 113587751 |
| fill.key_fill_guidance | OK | Creation path verbatim from doc: "\|\|Create menu\|\| > Lights > V-Ray > V-Ray Plane/Sphere Light > Click and drag in a viewport". Ratio guidance is artistic (not doc-checkable, correctly framed). | 113587751 |
| cam.iso | OK | Aperture > "Film speed (ISO)"; "A day scene, lit with a V-Ray Sun... looks best when captured with around 100 ISO" (cheat sheet); Physical Exposure gating confirmed. verified:false honest. | 113586662 |
| cam.fnumber | OK | Aperture > "F-Number"; lower = brighter + more DOF per cheat sheet. verified:false honest (doc examples use F-Number 8.0 as constant). | 113586662 |
| cam.shutter | OK | Aperture > "Shutter speed (s^-1)"; "shutter speed of 1/30 s corresponds to a value of 30"; lower value = brighter. verified:false honest (doc example holds 200.0 constant). | 113586662 |
| cam.wb_kelvin | OK | Color & Exposure > "Temperature (K) – Specifies the temperature (in Kelvins) when White balance is set to Temperature"; Daylight preset mentioned in doc. verified:false honest. | 113586662 |
| cam.ev_readout | OK | "Exposure value – Controls the exposure value when the Exposure Value (EV) option is selected"; readout behavior doc-stated: "When Physical Exposure mode is selected, changing the value of ISO, F-number, or Shutter speed automatically shows the corrected Exposure value which is greyed out." Default 14 ≈ factory ISO100/f8/1/200s readout (log2(64x200)=13.6) — correctly labeled "approximate". | 113586662 |
| cm.type | OK | UI Path verbatim; options exactly: Linear multiply, Exponential, HSV exponential, Intensity exponential, Gamma correction (deprecated), Intensity gamma (deprecated), Reinhard. Default **doc-stated**: "set by default so that V-Ray renders out the image in linear space (Reinhard color mapping with Burn value 1.0 produces a linear result)". | 113575645 |
| cm.highlight_burn | OK | "Burn value – Available when Type is set to Reinhard. If this value is 1.0... Linear multiply. If... 0.0... Exponential. Values between 0.0 and 1.0 blend" — range AND default doc-stated. | 113575645 |
| cm.contrast | OK | VFB Layers > Exposure layer > "Contrast – ...Positive Contrast values push the colors away from the medium gray value..., negative values push the colors closer to medium grey" — verbatim. Not-in-default-stack claim confirmed (default layers listed: Stamp, Display Correction, Sharpen/Blur, Denoiser, Lens Effects, Backgrounds and Foregrounds, Source). Default 0 neutral, not literally printed — see A2. | 113588521 |
| cm.saturation | **UNCERTAIN** | Path + semantics confirmed (Hue/Saturation layer: "Lower Saturation values move the image towards greyscale while higher values increase the colors' intensities"). **Range [−100,100] unverifiable from docs** — no slider bounds printed anywhere on the Layers page; the entry itself flags the possible −1..1 scale mismatch. Needs the in-product check it already demands. | 113588521 |
| vfb.exposure | OK | "Exposure – ...An Exposure value of 0.0 leaves the original image brightness. When set to +1.0, makes the image twice as bright. When set to -1.0, makes the image twice as dark" — default and semantics doc-stated verbatim. Add-layer claim confirmed. | 113588521 |
| vfb.wb_kelvin | OK | White Balance layer > "Temperature - ...Lower values make the image bluer, higher ones make it more amber"; "Magenta - Green tint" sibling confirmed. 6500-neutral correctly declared "derived, not doc-stated". | 113588521 |
| gi.primary | OK | "Render Setup window > GI tab > Global illumination rollout" verbatim; options Irradiance map / Brute force / Light cache + "Irradiance Map GI engine is deprecated... will be soon removed as an option". Default **doc-stated** on Universal V-Ray Settings: "GI enabled, using Brute Force as Primary GI engine and Light Cache as Secondary GI engine". | 113587715, 113587869 |
| gi.secondary | OK | Options exactly None / Brute force / Light cache; "None – ...skylit images without indirect color bleeding"; "by default Brute Force has 3 light bounces and Light Cache works with 100" — all verbatim. Default Light cache doc-stated (Universal Settings). | 113587715, 113587869 |
| fog.enabled | OK | UI Path verbatim: "\|\|Rendering menu\|\| > Environment > Add > VRayEnvironmentFog". Below-Fog-height fill and the System-rollout "Optimized atmospherics evaluation" recommendation both doc-stated. | 113575533 |
| fog.color | OK | General parameters > "Fog color – Defines the color of the fog when it is illuminate[d] by light sources. You can also use a texture map"; example: "color only changes the way the volume reacts to light, and not the volume transparency" — verbatim. White-neutral correctly declared derived. | 113575533 |
| fog.distance | OK | "Fog distance – Controls the fog density. Larger values make the fog more transparent, while smaller values make it more dense." Default-50 assumption honestly sourced from the doc's Fog height example pairing (Fog distance = 50 / Fog height = 10). Unit honestly stated as unprinted. | 113575533 |
| fog.height | OK | "If no atmospheric gizmos are specified, the fog is assumed to start from a certain Z-level height and continue downward indefinitely... If there are atmospheric gizmos listed in the Nodes section, this parameter is ignored." Darkening + raise-Fog-distance compensation doc-stated in the Fog height example. | 113575533 |
| fog.phase | OK | "Fog phase function – ...Default value of 0.0 scatters the light uniformly... Positive value... forward. Negative value... backwards" + "values very close to 1.0 or -1.0 are not recommended as they produce very directional scattering" — default doc-stated, warning verbatim, [−0.9,0.9] practical stop justified. | 113575533 |
| fog.scatter_gi | OK | "Scatter GI – When on, the fog also scatters global illumination. Note that this can be quite slow... can be substituted with a simple emission term... the currently selected global illumination algorithm... is used." Folded Scatter bounces ("When Scatter GI is enabled...", example uses 100) and Fog emission ("self-illumination... substitute the ambient illumination... instead of using GI") both real. | 113575533 |
| aerial.enabled | OK | UI Path verbatim: "\|\|Rendering menu\|\| > Environment > Add > VRayAerialPerspective"; "works together with VRaySun and the VRaySky"; "renders faster than VRayEnvironmentFog... does not produce volumetric shadows"; VRaySun page note: "The Affect atmospherics option has no effect on VRayAerialPerspective". Folded "Affect environment rays" default-OFF doc-stated ("disabled by default because the VRaySky texture already takes into account the amount of scattered sunlight"). | 113575363, 113587755 |
| aerial.visibility_range | OK | Exact label "Visibility range (in meters)"; "distance at which the fog has absorbed 90% of the light coming from objects behind it. Lower values make the fog appear denser"; "value is in meters and is converted internally based on the currently selected 3ds Max units". Doc demo values 30–540 m as cited. verified:false honest. | 113575363 |
| aerial.atmosphere_height | OK | Exact label "Atmosphere height (in meters)"; "Lower values can be used for artistic effects"; meters conversion + scene-scale dependency doc-stated. verified:false honest. | 113575363 |
| aerial.inscatter | OK | Exact label "Inscattered light intensity"; **default 1.0 doc-stated**: "The default value 1.0 is physically accurate; lower or higher values could be used for artistic purposes." | 113575363 |
| aerial.filter_color | OK | "Filter color – Affects the color of the inscattered light"; doc example is a red filter with Hue adjustment, as cited. White-neutral declared derived. | 113575363 |
| aerial.affect_background | OK | "Affect background – Specifies whether the effect is applied to camera rays that hit the background (if a background other than VRaySky is used). This option is enabled by default" — **default ON doc-stated**, semantics verbatim. | 113575363 |
| clouds.enabled | OK | "Clouds on – Enables the cloud system" under VRaySun ## Clouds; VRaySky has no cloud params and auto-follows the active sun ("automatically takes its parameters from the active VRaySun that was created last"); CIE Overcast present in both Sky model lists (VRaySun + VRaySky pages). | 113587755, 113575846 |
| clouds.density | OK | "Density – Controls the density of the cumulus and stratus types of clouds. A value of 1 fills up the sky"; examples 0/0.4/0.8. verified:false honest. | 113587755 |
| clouds.density_mult | OK | "Density multiplier – A multiplier to the Density parameter. The larger the value, the darker the sky becomes at the horizon. Setting a value of 0 results in no clouds, regardless of the Density value" — verbatim. 1.0-neutral declared derived. | 113587755 |
| clouds.variety | OK | "Variety – Controls the variety of the cumulus and stratus types of clouds"; examples 0/0.5/1. verified:false honest. | 113587755 |
| clouds.cirrus_amount | OK | "Cirrus amount – The maximum value of 1 fills the sky with cirrus clouds... When set to 0, the cirrus clouds are completely gone" — scale doc-stated. verified:false honest. | 113587755 |
| clouds.height | OK | Exact label "Height (m) – Clouds position in height"; examples 500/1000/1500. verified:false honest. | 113587755 |
| clouds.thickness | OK | Exact label "Thickness (m) – Lower values make the cumulus and stratus types of clouds thin and sheer/lucent, while higher values make them full and heavy"; examples 200/500/800. verified:false honest. | 113587755 |
| clouds.ground_shadows | OK | Doc verbatim: disabled = "the entire scene is covered by a single shadow or fully illuminated depending on whether the sun is blocked by a cloud at the current camera position... useful for smaller scenes"; enabled = "calculates the shadows precisely at every point... helpful in larger scenes". Vantage-contrast note verified in LAV space: Vantage's "Ground shadows – When enabled, casts shadows from the clouds" is a plain on/off. | 113587755, 125079048 (LAV) |
| clouds.detail | OK | All folded params real: "Seed – Generates a random value... to change the pattern of the clouds and the Contrails"; Phase X/Y (%) "loops at 0, 100, 200"; Offset X/Y (m) with doc example −250/500; "Enable contrails"; "Number of contrails" 5–40 + "spread randomly across the sky"; "Contrails strength" 0.1–1.0, "Lower values create less opaque trails, which look older"; Contrails distortion; Contrails offset X/Y (m); "Contrails time" animated 0–2.0. Recipe-critical same-seed advice consistent with Seed reseeding both patterns. | 113587755 |

---

## Corrections required

**None.** No entry states a control, location, label, option list, doc-stated range, or doc-stated default that contradicts the live V-Ray 7 documentation.

## Recommended (non-blocking) amendments

1. **`sun.placement_elevation`**: widen range [0, 90] → **[−12, 90]** (PRG Clear Sky twilight support; VRaySky 113575846: "supports rendering of nautical twilight effects with sun positions up to 12 degrees below the horizon") — or [−18, 90] to mirror the `vantage33` twin. Without this, sunset/blue-hour recipes clamp to horizon.
2. **Flag hygiene (A2)**: `env.gi_skylight_on`, `env.gi_skylight_mult`, `dome.rotation_h`, `sun.intensity_mult`, `sun.size_mult`, `cm.contrast` carry dated `verified:` stamps but their defaults are not literally printed in the docs (all are neutral/identity values). Add "(derived/assumed, not doc-printed)" to notes or flip to `verified:false` for consistency with the pack's own convention.
3. **`dome.texture_slot`**: soften "a texture overrides the light's Color/Temperature (docs)" to "the texture drives the light surface (docs); Color/Temperature apply to the untextured light" — the explicit "overrides" wording exists in the docs only for environment-map slots (113587655), not on the Dome Light page.
4. **`cm.saturation`**: keep the in-product range check on the todo list; docs cannot resolve the −100..100 vs −1..1 question (same applies to the Vantage post.* twins).
