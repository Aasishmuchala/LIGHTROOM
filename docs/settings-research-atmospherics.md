# Atmospherics / weather settings research — 2026-07-03

Ready-to-implement entry specs for the planned **step 6 — Atmosphere / weather** group
(fog, mist, haze, clouds) in `PACKS.vray7max` and `PACKS.vantage33` (`lightmatch.html`,
SECTION: PACKS). Research only — no pack code was modified.

**Method.** Same as `docs/pack-verification.md`: every page body was pulled in full through
the public Confluence Cloud REST API at `docs-chaos.atlassian.net` (no auth) and read
verbatim — `docs.chaos.com` itself is JS-rendered. Space **VMAX** = V-Ray for 3ds Max
(current = V-Ray 7.x), space **LAV** = Chaos Vantage (current = 3.3; the What's New page
lists v3.3.0, official release 2026-06-11, and confirms the Fog and Clouds rollouts carried
into 3.3 unchanged — the "additional clouds density and contrails parameters" entry dates to
v3.0.3, and 3.3's only new weather feature is Wet effects (Beta)).

**Verification policy** (identical to the shipped pack header):
- `verified: "2026-07-03"` — control name, panel location, option lists and every doc-stated
  range/default in the entry confirmed on the cited page. Chaos docs almost never print
  spinner bounds, so `range` is a **practical range** flagged in `notes`. Neutral values that
  follow from doc-stated semantics (a multiplier's 1.0, a zero offset, an effect-absent
  toggle state, a filter color's white) are accepted as verified with the derivation noted.
- `verified: false` — the ui_path is doc-checked, but the stated default is a **factory value
  current Chaos docs do not print**; the shipped value is conservative and flagged
  "(N assumed)" in `notes`. Where possible the assumed value is a doc example value.

## Source pages

Confluence API pattern (used for every page below):
`https://docs-chaos.atlassian.net/wiki/rest/api/content?spaceKey=<SPACE>&title=<Title>&expand=body.view`

| Key | Canonical URL | API title | Last modified |
|---|---|---|---|
| VMAX VRayEnvironmentFog | https://docs.chaos.com/display/VMAX/VRayEnvironmentFog | `spaceKey=VMAX&title=VRayEnvironmentFog` | 2026-05-05 |
| VMAX VRayAerialPerspective | https://docs.chaos.com/display/VMAX/VRayAerialPerspective | `spaceKey=VMAX&title=VRayAerialPerspective` | 2026-05-05 |
| VMAX VRaySky | https://docs.chaos.com/display/VMAX/VRaySky | `spaceKey=VMAX&title=VRaySky` | 2026-04-28 |
| VMAX VRaySun | https://docs.chaos.com/display/VMAX/VRaySun | `spaceKey=VMAX&title=VRaySun` | 2026-04-22 |
| LAV Fog | https://docs.chaos.com/display/LAV/Fog | `spaceKey=LAV&title=Fog` | 2026-02-27 |
| LAV Clouds | https://docs.chaos.com/display/LAV/Clouds | `spaceKey=LAV&title=Clouds` | 2026-02-27 |
| LAV Environment Tab | https://docs.chaos.com/display/LAV/Environment+Tab | `spaceKey=LAV&title=Environment Tab` | 2026-06-11 |
| LAV Wind | https://docs.chaos.com/display/LAV/Wind | `spaceKey=LAV&title=Wind` | 2026-03-19 |
| LAV Wetting | https://docs.chaos.com/display/LAV/Wetting | `spaceKey=LAV&title=Wetting` | 2026-06-15 |
| LAV What's New | https://docs.chaos.com/display/LAV/What%27s+New | `spaceKey=LAV&title=What's New` | 2026-06-11 |

---

# 1. PACKS.vray7max — step 6 additions (30 entries)

Three sub-groups: `fog.*` (VRayEnvironmentFog), `aerial.*` (VRayAerialPerspective),
`clouds.*` (VRaySun procedural clouds + sky model).

## 1a. `fog.*` — VRayEnvironmentFog (volumetric fog / ground mist)

Doc facts (all from VMAX/VRayEnvironmentFog):
- **Doc UI path (verbatim, single path):** `Rendering menu > Environment > Add >
  VRayEnvironmentFog` — the effect is an *atmospheric effect* added from the Environment
  side, **not** the Effects tab and **not** the environment map slot.
- General parameters: Fog color, Fog phase function (doc-stated default 0.0), Fog distance,
  Fog transparency (a color), Fog emission (a color), Scatter GI, Scatter bounces, Fog height.
- Two samplers: Exponential (untextured) / Raymarching (any property texture-mapped) with
  Step size, Texture samples, Cutoff threshold, Max steps; gizmo controls (falloff radius,
  falloff mode: Multiply by density | Add density to falloff, merge mode); Deep output;
  Affect alpha. Texture maps: color / density / emission / transparency. Ray filter: Affect
  background / reflections / refractions / shadows / GI / camera rays. Nodes: Gizmos list,
  Use all lights, Lights list.
- Docs recommend enabling **Optimized atmospherics evaluation** (Render Setup ▸ System
  rollout) when using VRayEnvironmentFog.

```js
// -- atmosphere / weather: volumetric fog (VRayEnvironmentFog) -----------------------
// doc: https://docs.chaos.com/display/VMAX/VRayEnvironmentFog
{ id: "fog.enabled", ui_path: "Rendering menu ▸ Environment ▸ Add ▸ VRayEnvironmentFog",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: "2026-07-03",
  notes: "Options: on | off. on = the VRayEnvironmentFog atmospheric effect is added via the docs' Add path; off = effect absent (neutral — no fog). Without gizmos it fills the scene below Fog height (docs). Docs recommend turning on Optimized atmospherics evaluation (Render Setup ▸ System rollout) with it." },
// doc: https://docs.chaos.com/display/VMAX/VRayEnvironmentFog
{ id: "fog.color", ui_path: "VRayEnvironmentFog ▸ General parameters ▸ Fog color",
  kind: "placement", unit: "", range: [0, 0], default: "white (untinted)", verified: "2026-07-03",
  notes: "Color swatch (texture-mappable): how the fog reacts to light — it does NOT change the volume transparency (docs). white = untinted scattering (derived neutral; factory value not printed). Emit as an instruction, e.g. 'pale warm grey for dusty evening air'." },
// doc: https://docs.chaos.com/display/VMAX/VRayEnvironmentFog
{ id: "fog.distance", ui_path: "VRayEnvironmentFog ▸ General parameters ▸ Fog distance",
  kind: "spinner", unit: "units", range: [0.1, 10000], default: 50, verified: false,
  notes: "THE density control: larger = more transparent fog, smaller = denser (docs). Value in 3ds Max scene units (no fixed unit stated in docs); practical range. Factory creation value not printed in current Chaos docs (50 assumed — the docs' Fog height example pairs distance 50 with height 10)." },
// doc: https://docs.chaos.com/display/VMAX/VRayEnvironmentFog
{ id: "fog.height", ui_path: "VRayEnvironmentFog ▸ General parameters ▸ Fog height",
  kind: "spinner", unit: "units", range: [0, 10000], default: 10, verified: false,
  notes: "Z-level the fog starts at, continuing downward indefinitely; IGNORED when gizmos are listed in the Nodes section (docs). Raising it darkens the scene (more fog blocks the sun) — compensate by raising Fog distance (docs). Factory value not printed (10 assumed, doc example)." },
// doc: https://docs.chaos.com/display/VMAX/VRayEnvironmentFog
{ id: "fog.phase", ui_path: "VRayEnvironmentFog ▸ General parameters ▸ Fog phase function",
  kind: "spinner", unit: "", range: [-0.9, 0.9], default: 0.0, verified: "2026-07-03",
  notes: "Doc-stated default 0.0 = uniform scattering; positive = forward scatter (glow around backlights), negative = backward (docs). Docs warn values very close to +/-1.0 produce very directional scattering — practical range stops at 0.9." },
// doc: https://docs.chaos.com/display/VMAX/VRayEnvironmentFog
{ id: "fog.emission", ui_path: "VRayEnvironmentFog ▸ General parameters ▸ Fog emission",
  kind: "placement", unit: "", range: [0, 0], default: "black (no self-illumination)", verified: "2026-07-03",
  notes: "Color swatch (texture-mappable): fog self-illumination, usable as a cheap substitute for GI inside the fog (docs). black = no emission (derived neutral; factory value not printed). NO separate emission multiplier exists in V-Ray 7 — brightness comes from the color value itself." },
// doc: https://docs.chaos.com/display/VMAX/VRayEnvironmentFog
{ id: "fog.scatter_gi", ui_path: "VRayEnvironmentFog ▸ General parameters ▸ Scatter GI",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: false,
  notes: "Options: on | off. When on, the fog scatters global illumination using the current GI engine — can be quite slow; docs suggest a simple Fog emission term as the substitute. Factory state not printed in current Chaos docs (off assumed)." },
// doc: https://docs.chaos.com/display/VMAX/VRayEnvironmentFog
{ id: "fog.scatter_bounces", ui_path: "VRayEnvironmentFog ▸ General parameters ▸ Scatter bounces",
  kind: "spinner", unit: "", range: [1, 100], default: 1, verified: false,
  notes: "GI bounces calculated inside the fog; active only when Scatter GI is on (docs). Multiple scattering greatly increases realism for dense/cloud-like volumes — the docs' smoke example uses 100. Factory default not printed (1 assumed, doc example)." },
```

Documented but **not shipped** (seen, deliberately left out of the recipe surface):
Fog transparency (color; volumetric-shadow tint), the four texture-map slots, sampling
controls (Step size / Texture samples / Cutoff threshold / Max steps — raymarcher applies
only when a property is texture-mapped; docs rule of thumb: Step size 2–3× smaller than Fog
distance), gizmo falloff radius/mode/merge (gizmo-confined fog only), Deep output, Affect
alpha, Ray filter toggles, Use all lights + Lights list.

## 1b. `aerial.*` — VRayAerialPerspective (distance haze)

Doc facts (all from VMAX/VRayAerialPerspective):
- **Doc UI path (verbatim, single path):** `Rendering menu > Environment > Add >
  VRayAerialPerspective`.
- Works together with VRaySun + VRaySky; faster than VRayEnvironmentFog but an
  approximation — no volumetric shadows (docs).
- Params: Visibility range (in meters), Atmosphere height (in meters), Inscattered light
  intensity (**doc-stated default 1.0** = physically accurate), Affect environment rays
  (**doc-stated: disabled by default**), Affect background (**doc-stated: enabled by
  default**), Filter color, Primary visibility, Affect alpha.
- VRaySun page note: the sun's *Affect atmospherics* option has **no effect** on
  VRayAerialPerspective.

```js
// -- atmosphere / weather: distance haze (VRayAerialPerspective) ---------------------
// doc: https://docs.chaos.com/display/VMAX/VRayAerialPerspective
{ id: "aerial.enabled", ui_path: "Rendering menu ▸ Environment ▸ Add ▸ VRayAerialPerspective",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: "2026-07-03",
  notes: "Options: on | off. Distance-haze approximation that works together with VRaySun + VRaySky; renders faster than VRayEnvironmentFog but produces no volumetric shadows (docs). off = effect absent (neutral). The sun's Affect atmospherics option has NO effect on it (docs, VRaySun page)." },
// doc: https://docs.chaos.com/display/VMAX/VRayAerialPerspective
{ id: "aerial.visibility_range", ui_path: "VRayAerialPerspective ▸ Parameters ▸ Visibility range (in meters)",
  kind: "spinner", unit: "m", range: [10, 100000], default: 10000, verified: false,
  notes: "Distance at which the haze has absorbed 90% of the light from objects behind it; lower = denser (docs). ALWAYS meters — converted internally from the current 3ds Max units (docs). Factory default not printed (10000 assumed; the docs' small demo scene uses 30-540 m)." },
// doc: https://docs.chaos.com/display/VMAX/VRayAerialPerspective
{ id: "aerial.atmosphere_height", ui_path: "VRayAerialPerspective ▸ Parameters ▸ Atmosphere height (in meters)",
  kind: "spinner", unit: "m", range: [10, 100000], default: 10000, verified: false,
  notes: "Height of the atmosphere layer in meters, converted internally from the scene units; lower values exaggerate the effect artistically and interact with scene scale (docs). Factory default not printed (10000 assumed). Practical range." },
// doc: https://docs.chaos.com/display/VMAX/VRayAerialPerspective
{ id: "aerial.inscatter", ui_path: "VRayAerialPerspective ▸ Parameters ▸ Inscattered light intensity",
  kind: "spinner", unit: "x", range: [0, 5], default: 1.0, verified: "2026-07-03",
  notes: "Doc-stated default 1.0 = physically accurate amount of sunlight scattered into the haze; lower/higher only for artistic purposes (docs). Practical range; spinner bounds not stated in docs." },
// doc: https://docs.chaos.com/display/VMAX/VRayAerialPerspective
{ id: "aerial.filter_color", ui_path: "VRayAerialPerspective ▸ Parameters ▸ Filter color",
  kind: "placement", unit: "", range: [0, 0], default: "white (no tint)", verified: "2026-07-03",
  notes: "Color swatch tinting the inscattered light (docs; their example shifts the hue of a red filter). white = untinted (derived neutral). Emit as an instruction, e.g. 'pale warm filter for golden-hour haze'." },
// doc: https://docs.chaos.com/display/VMAX/VRayAerialPerspective
{ id: "aerial.affect_env", ui_path: "VRayAerialPerspective ▸ Parameters ▸ Affect environment rays",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: "2026-07-03",
  notes: "Options: on | off. Doc-stated default OFF: camera rays hitting the VRaySky are left alone because the sky texture already accounts for scattered sunlight; enable only for artistic effects with low visibility ranges (docs)." },
// doc: https://docs.chaos.com/display/VMAX/VRayAerialPerspective
{ id: "aerial.affect_background", ui_path: "VRayAerialPerspective ▸ Parameters ▸ Affect background",
  kind: "dropdown", unit: "", range: [0, 0], default: "on", verified: "2026-07-03",
  notes: "Options: on | off. Doc-stated default ON — the haze also covers camera rays that hit a background other than VRaySky; disabling gives cut-out looks (docs)." },
```

Documented but **not shipped**: Primary visibility (off = haze seen only by secondary
rays), Affect alpha.

## 1c. `clouds.*` — VRaySun procedural clouds (+ sky model)

Doc facts:
- **V-Ray 7 procedural clouds live on the SUN, not the sky texture.** The VRaySun page
  (VMAX/VRaySun) has a dedicated **Clouds** section; the VRaySky page (VMAX/VRaySky) lists
  NO cloud parameters — the sky auto-takes its parameters from the active VRaySun when
  *Specify sun node* is Off (docs). ui_path is therefore the sun's Modify panel.
- Clouds params (VRaySun page, verbatim names): Clouds on, Ground shadows, Density,
  Density multiplier, Variety, Seed, Cirrus amount, Offset X (m), Offset Y (m), Height (m),
  Thickness (m), Phase X (%), Phase Y (%), Enable contrails, Number of contrails, Contrails
  strength, Contrails distortion, Contrails offset X/Y (m), Contrails time.
- Doc example values: Density 0/0.4/0.8 · Variety 0/0.5/1 · Cirrus 0/0.5/1 · Height
  500/1000/1500 · Thickness 200/500/800 · Offset −250/500 · contrails 5/20/40, strength
  0.1–1.0, time 0–2.
- Sky model (weather lever for overcast looks) sits in the sun's **Sky Parameters**; the
  V-Ray-7-updated option list is on the VRaySky page (see deviations #4).

```js
// -- atmosphere / weather: procedural clouds (VRaySun ▸ Clouds) ----------------------
// doc: https://docs.chaos.com/display/VMAX/VRaySun (Clouds section); absence on the sky:
// https://docs.chaos.com/display/VMAX/VRaySky
{ id: "clouds.enabled", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Clouds on",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: "2026-07-03",
  notes: "Options: on | off. V-Ray 7's procedural clouds are a section of the SUN — the VRaySky texture has no cloud parameters and follows the active sun automatically (docs). off = clear sky (neutral; startup state not printed in docs)." },
// doc: https://docs.chaos.com/display/VMAX/VRaySky (V-Ray 7 option list) +
// https://docs.chaos.com/display/VMAX/VRaySun (Sky Parameters location)
{ id: "clouds.sky_model", ui_path: "VRaySun ▸ Modify panel ▸ Sky Parameters ▸ Sky model",
  kind: "dropdown", unit: "", range: [0, 0], default: "PRG Clear Sky", verified: false,
  notes: "Options (VRaySky page, V-Ray 7): Preetham et al. | CIE Clear | CIE Overcast | Hosek et al. | PRG Clear Sky (old) | PRG Clear Sky. Weather lever: CIE Overcast = grey cloudy-sky model. Docs state old scenes load PRG Clear Sky (old) and V-Ray 7 introduces the new PRG model, but the factory selection for a fresh sun is not printed (PRG Clear Sky assumed). Same dropdown exists on the VRaySky texture (Material Editor ▸ Maps ▸ V-Ray ▸ VRaySky) when Specify sun node is On." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.density", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Density",
  kind: "spinner", unit: "", range: [0, 1], default: 0.5, verified: false,
  notes: "Density of the cumulus/stratus clouds: 1 fills up the sky (docs; examples 0/0.4/0.8). Range doc-implied. Factory value not printed in current Chaos docs (0.5 assumed)." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.density_mult", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Density multiplier",
  kind: "spinner", unit: "x", range: [0, 5], default: 1.0, verified: "2026-07-03",
  notes: "Multiplier on Density; larger values darken the sky at the horizon, 0 removes all clouds regardless of Density (docs). 1.0 = neutral multiplier (derived). Practical range." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.variety", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Variety",
  kind: "spinner", unit: "", range: [0, 1], default: 0.5, verified: false,
  notes: "Variety of the cumulus/stratus cloud pattern (docs; examples 0/0.5/1 — range from doc examples). Factory value not printed (0.5 assumed)." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.seed", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Seed",
  kind: "spinner", unit: "", range: [0, 99999], default: 0, verified: false,
  notes: "Random seed for the cloud AND contrail pattern (docs). RECIPE-CRITICAL: keep the SAME seed across attempts or the pattern changes while every other value matches. Factory value not printed (0 assumed); practical range." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.cirrus_amount", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Cirrus amount",
  kind: "spinner", unit: "", range: [0, 1], default: 0, verified: false,
  notes: "Doc-stated scale: maximum 1 fills the sky with cirrus, 0 = cirrus completely gone. Factory value not printed (0 assumed = no cirrus)." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.ground_shadows", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Ground shadows",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: false,
  notes: "Options: on | off. off = one global lit/shadowed state decided at the camera position (fast, small scenes); on = precise per-point cloud shadows, slower but defined — for larger scenes (docs). Factory state not printed (off assumed). NOTE: Vantage's same-named toggle means cloud shadows on/off instead." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.height", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Height (m)",
  kind: "spinner", unit: "m", range: [100, 10000], default: 1000, verified: false,
  notes: "Clouds position in height, meters (docs; examples 500/1000/1500). Factory value not printed (1000 assumed). Practical range." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.thickness", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Thickness (m)",
  kind: "spinner", unit: "m", range: [10, 5000], default: 500, verified: false,
  notes: "Lower = thin, sheer/lucent cumulus/stratus; higher = full and heavy (docs; examples 200/500/800). Factory value not printed (500 assumed). Practical range." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.phase_x", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Phase X (%)",
  kind: "spinner", unit: "%", range: [0, 100], default: 0, verified: "2026-07-03",
  notes: "Fine-tweaks the cumulus/stratus pattern along X; the appearance LOOPS at 0, 100, 200... (docs), so [0,100] covers every pattern. 0 = base pattern (neutral offset, derived). Animatable for moving clouds (docs)." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.phase_y", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Phase Y (%)",
  kind: "spinner", unit: "%", range: [0, 100], default: 0, verified: "2026-07-03",
  notes: "Fine-tweaks the cumulus/stratus pattern along Y; loops at 0, 100, 200... (docs). 0 = base pattern (neutral offset, derived)." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.offset_x", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Offset X (m)",
  kind: "spinner", unit: "m", range: [-10000, 10000], default: 0, verified: "2026-07-03",
  notes: "Moves the whole cloud system along X in meters (docs; examples -250/500). 0 = no offset (neutral, derived). Practical range." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.offset_y", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Offset Y (m)",
  kind: "spinner", unit: "m", range: [-10000, 10000], default: 0, verified: "2026-07-03",
  notes: "Moves the whole cloud system along Y in meters (docs). 0 = no offset (neutral, derived). Practical range." },
// doc: https://docs.chaos.com/display/VMAX/VRaySun
{ id: "clouds.contrails_on", ui_path: "VRaySun ▸ Modify panel ▸ Clouds ▸ Enable contrails",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: "2026-07-03",
  notes: "Options: on | off. Airplane contrails in the sky; off = none (neutral). Sub-controls (docs): Number of contrails (examples 5-40, spread randomly), Contrails strength 0.1-1.0 (lower = fainter/older), Contrails distortion, Contrails offset X/Y (m), Contrails time (docs animate 0-2). The cloud Seed also reshuffles contrails (docs)." },
```

---

# 2. PACKS.vantage33 — step 6 additions (27 entries)

Two sub-groups: `fog.*` (Environment tab ▸ Fog rollout — simple aerial-perspective layers +
Scattering Fog) and `clouds.*` (Environment tab ▸ Clouds rollout).

The Environment Tab page (2026-06-11, the 3.3 release day) lists the tab's rollouts as:
Scene Sub-State, Sky, Sun and Moon, Clouds, Wetting, Wind, Fog, Ambient settings,
Background — and adds a globally useful note: **"Right-click a parameter value to reset it
to its default."** (worth quoting in the step-6 UI copy).

## 2a. `fog.*` — Environment tab ▸ Fog rollout

Doc facts (all from LAV/Fog):
- The rollout has TWO systems. **Settings** = two independent "simple" fog layers the docs
  explicitly call *aerial perspective fog* (examples call them Simple Fog 1/2): Enable fog,
  Fog visibility range (**in km**), Fog height (**in meters**), Fog start distance, Fog max
  opacity (doc-stated scale 0 = invisible … 1 = opaque), Fog color — then the same six again
  with "(2)" suffixes.
- **Scattering Fog** = true volumetrics: Enable scattering fog, Fog color, Fog distance,
  Fog transparency, Fog emission, Fog height (m), Fog start, Fog end, Fog light boost,
  Fog max opacity, Affect secondary rays, Scatter GI, Scatter only infinite direct lights,
  Texture mode (Off | Built-in smoke density | From V-Ray scene). Texture modes add Smoke
  size (m) / num iterations / exponent, Ground fog (+ distance / height / transition) and
  Raymarch step size / cutoff threshold / max steps.
- No numeric defaults are printed anywhere on the page.

```js
// -- atmosphere / weather: fog (Environment tab ▸ Fog rollout) -----------------------
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.enabled", ui_path: "Environment tab ▸ Fog rollout ▸ Settings ▸ Enable fog",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: "2026-07-03",
  notes: "Options: on | off. Enables the first aerial-perspective fog layer (the docs' examples call it Simple Fog 1); off = no fog (neutral; startup state not printed). A second identical layer exists as Enable fog 2 with its own range/height/start/opacity/color for two-tone atmospheres (docs)." },
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.visibility_range", ui_path: "Environment tab ▸ Fog rollout ▸ Settings ▸ Fog visibility range",
  kind: "spinner", unit: "km", range: [0.1, 300], default: 50, verified: false,
  notes: "Distance in KILOMETERS at which the fog absorbs 90% of the light behind it; lower = denser (docs; examples 10/50/100/150). Note the unit — km here, meters on the V-Ray aerial control. Factory value not printed (50 assumed, doc example). Practical range." },
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.height", ui_path: "Environment tab ▸ Fog rollout ▸ Settings ▸ Fog height",
  kind: "spinner", unit: "m", range: [1, 10000], default: 500, verified: false,
  notes: "Height of the fog layer in meters (docs; examples 100-2000). Factory value not printed (500 assumed, doc example). Practical range." },
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.start_distance", ui_path: "Environment tab ▸ Fog rollout ▸ Settings ▸ Fog start distance",
  kind: "spinner", unit: "", range: [0, 50000], default: 0, verified: "2026-07-03",
  notes: "Distance from the camera at which the fog starts (docs; examples 0-20000 — unit not printed; sibling heights are meters). 0 = fog starts at the camera (neutral offset, derived). Practical range." },
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.max_opacity", ui_path: "Environment tab ▸ Fog rollout ▸ Settings ▸ Fog max opacity",
  kind: "spinner", unit: "", range: [0, 1], default: 1.0, verified: false,
  notes: "Doc-stated scale: 1 = fog completely opaque, 0 = invisible. Lower it to keep distant objects readable through the haze (docs; examples 0.01-1). Factory value not printed (1.0 assumed)." },
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.color", ui_path: "Environment tab ▸ Fog rollout ▸ Settings ▸ Fog color",
  kind: "placement", unit: "", range: [0, 0], default: "white", verified: "2026-07-03",
  notes: "Color swatch for the fog layer (docs; examples white/blue/grey/orange/yellow). Emit as an instruction, e.g. 'cool blue-grey morning mist'. Default informational." },
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.scatter_enabled", ui_path: "Environment tab ▸ Fog rollout ▸ Scattering Fog ▸ Enable scattering fog",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: "2026-07-03",
  notes: "Options: on | off. True volumetric scattering fog with light-shaft support — heavier than the simple layers (docs); off = neutral. Further doc-listed sub-controls not shipped here: Fog transparency + Fog emission colors, Fog start / Fog end, Fog max opacity, Affect secondary rays, Scatter only infinite direct lights." },
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.scatter_distance", ui_path: "Environment tab ▸ Fog rollout ▸ Scattering Fog ▸ Fog distance",
  kind: "spinner", unit: "", range: [0.1, 1000], default: 20, verified: false,
  notes: "Density control for the scattering fog: larger = more transparent, smaller = denser (docs; examples 5-30, unit not printed). Factory value not printed (20 assumed, doc example)." },
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.scatter_height", ui_path: "Environment tab ▸ Fog rollout ▸ Scattering Fog ▸ Fog height",
  kind: "spinner", unit: "m", range: [0.1, 500], default: 8, verified: false,
  notes: "Height of the scattering fog in meters (docs; examples 2-16 — a ground-hugging scale, unlike the simple layer's hundreds of meters). Factory value not printed (8 assumed, doc example)." },
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.scatter_light_boost", ui_path: "Environment tab ▸ Fog rollout ▸ Scattering Fog ▸ Fog light boost",
  kind: "spinner", unit: "x", range: [0, 20], default: 1.0, verified: "2026-07-03",
  notes: "Multiplier for lights affecting the scattering fog — pushes visible light shafts (docs; examples 1/2/4/8). 1.0 = neutral multiplier (derived). Practical range." },
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.scatter_gi", ui_path: "Environment tab ▸ Fog rollout ▸ Scattering Fog ▸ Scatter GI",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: false,
  notes: "Options: on | off. The fog also scatters GI — can be quite slow; docs suggest the Fog emission term as a cheap substitute. Factory state not printed (off assumed)." },
// doc: https://docs.chaos.com/display/LAV/Fog
{ id: "fog.scatter_texture_mode", ui_path: "Environment tab ▸ Fog rollout ▸ Scattering Fog ▸ Texture mode",
  kind: "dropdown", unit: "", range: [0, 0], default: "Off", verified: "2026-07-03",
  notes: "Options: Off | Built-in smoke density | From V-Ray scene (docs). Off = homogeneous fog (neutral no-texture state). Built-in smoke adds procedural clusters — Smoke size (m) / num iterations / exponent — and both texture modes add Ground fog (distance/height/transition) + Raymarch step size / cutoff threshold / max steps (docs)." },
```

## 2b. `clouds.*` — Environment tab ▸ Clouds rollout

Doc facts (all from LAV/Clouds unless noted):
- **Gating (doc-stated):** "The Clouds rollout is available when the Environment mode is
  set to Physical sky in the Sky rollout." — recipes must set `env.mode` = Physical Sky
  first (which itself requires a VRaySky in the imported .vrscene, per the LAV Sky page
  already cited in pack-verification.md).
- The rollout = an Enable clouds toggle + three tabs: **Clouds settings** (Density —
  "a value of 100% fills up the sky", examples captioned 0/0.4/0.8; Density multiplier;
  Variety; Random seed; Cirrus amount 0–1; Ground shadows; Improved shading),
  **Clouds positioning settings** (Offset X/Y; Phase X/Y — loops at 0, 100, 200; Start
  height, examples 500/1000/1500; Thickness, examples 200/500/800), **Contrails settings**
  (Enable contrails + number slider, strength, distortion, offset X/Y, time).
- No units are printed for Offset/Start height/Thickness (the V-Ray equivalents are
  meters); no numeric defaults are printed anywhere on the page.
- Vantage-only extra vs V-Ray: **Improved shading** (cloud-on-cloud shadowing, better in
  offline rendering, docs). Renames vs V-Ray: Seed → **Random seed**, Height (m) →
  **Start height**.

```js
// -- atmosphere / weather: clouds (Environment tab ▸ Clouds rollout) -----------------
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.enabled", ui_path: "Environment tab ▸ Clouds rollout ▸ Enable clouds",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: "2026-07-03",
  notes: "Options: on | off. GATING: the Clouds rollout is available only when Environment mode = Physical sky in the Sky rollout (docs) — set env.mode first. off = clear sky (neutral; startup state not printed)." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.density", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds settings ▸ Density",
  kind: "spinner", unit: "", range: [0, 1], default: 0.5, verified: false,
  notes: "Density of the cumulus/stratus clouds — docs describe 100% = sky fully filled and caption their examples 0/0.4/0.8 on a 0-1 scale. Factory value not printed (0.5 assumed)." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.density_mult", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds settings ▸ Density multiplier",
  kind: "spinner", unit: "x", range: [0, 5], default: 1.0, verified: "2026-07-03",
  notes: "Multiplier on Density; larger values darken the sky at the horizon, 0 removes all clouds regardless of Density (docs). 1.0 = neutral multiplier (derived). Practical range." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.variety", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds settings ▸ Variety",
  kind: "spinner", unit: "", range: [0, 1], default: 0.5, verified: false,
  notes: "Variety of the cumulus/stratus pattern (docs; examples 0/0.5/1 — range from doc examples). Factory value not printed (0.5 assumed)." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.seed", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds settings ▸ Random seed",
  kind: "spinner", unit: "", range: [0, 99999], default: 0, verified: false,
  notes: "Random seed for the cloud AND contrail pattern (docs; Vantage's name for the V-Ray Seed). RECIPE-CRITICAL: keep the SAME seed across attempts or the pattern changes while every other value matches. Factory value not printed (0 assumed)." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.cirrus_amount", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds settings ▸ Cirrus amount",
  kind: "spinner", unit: "", range: [0, 1], default: 0, verified: false,
  notes: "Doc-stated scale: maximum 1 fills the sky with cirrus (high-altitude wispy) clouds, 0 = completely gone. Factory value not printed (0 assumed = no cirrus)." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.ground_shadows", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds settings ▸ Ground shadows",
  kind: "dropdown", unit: "", range: [0, 0], default: "on", verified: false,
  notes: "Options: on | off. When enabled, the clouds cast shadows (docs) — NOTE: unlike the 3ds Max control of the same name, off removes cloud shadowing rather than switching to a faster global approximation. Factory state not printed (on assumed — matching a reference with visible cloud light patches needs it)." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.improved_shading", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds settings ▸ Improved shading",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: false,
  notes: "Options: on | off. Vantage-only: more accurate shadowing of clouds by other clouds; docs note the results are better in offline rendering. Factory state not printed (off assumed)." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.offset_x", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds positioning settings ▸ Offset X",
  kind: "spinner", unit: "", range: [-10000, 10000], default: 0, verified: "2026-07-03",
  notes: "Moves the cloud system on the X axis (docs; unit not printed — the V-Ray equivalent is meters). 0 = no offset (neutral, derived). Practical range." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.offset_y", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds positioning settings ▸ Offset Y",
  kind: "spinner", unit: "", range: [-10000, 10000], default: 0, verified: "2026-07-03",
  notes: "Moves the cloud system on the Y axis (docs; unit not printed). 0 = no offset (neutral, derived). Practical range." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.phase_x", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds positioning settings ▸ Phase X",
  kind: "spinner", unit: "", range: [0, 100], default: 0, verified: "2026-07-03",
  notes: "Fine-tweaks the cumulus/stratus pattern along X; the appearance LOOPS at 0, 100, 200... (docs), so [0,100] covers every pattern. 0 = base pattern (neutral offset, derived)." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.phase_y", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds positioning settings ▸ Phase Y",
  kind: "spinner", unit: "", range: [0, 100], default: 0, verified: "2026-07-03",
  notes: "Fine-tweaks the cumulus/stratus pattern along Y; loops at 0, 100, 200... (docs). 0 = base pattern (neutral offset, derived)." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.start_height", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds positioning settings ▸ Start height",
  kind: "spinner", unit: "", range: [100, 10000], default: 1000, verified: false,
  notes: "The clouds' starting height position (docs; examples 500/1000/1500, unit not printed — the V-Ray equivalent Height is meters). Vantage's name for that param. Factory value not printed (1000 assumed)." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.thickness", ui_path: "Environment tab ▸ Clouds rollout ▸ Clouds positioning settings ▸ Thickness",
  kind: "spinner", unit: "", range: [10, 5000], default: 500, verified: false,
  notes: "Height of the cloud layer: lower = thin/sheer clouds, higher = full and heavy (docs; examples 200/500/800, unit not printed). Factory value not printed (500 assumed)." },
// doc: https://docs.chaos.com/display/LAV/Clouds
{ id: "clouds.contrails_on", ui_path: "Environment tab ▸ Clouds rollout ▸ Contrails settings ▸ Enable contrails",
  kind: "dropdown", unit: "", range: [0, 0], default: "off", verified: "2026-07-03",
  notes: "Options: on | off. Airplane contrails; off = none (neutral). The number-of-contrails slider sits directly below the toggle (docs; examples 5-40, spread randomly). Sub-controls: Contrails strength (0.1-1.0, lower = fainter/older), distortion, offset X/Y, time (docs animate 0-2). Random seed also reshuffles them." },
```

---

# 3. Deviations from the target list

**V-Ray 7 for 3ds Max**

1. **V-Ray 7 procedural clouds exist, but NOT on VRaySky.** The VRaySky page
   (VMAX/VRaySky) lists only: Specify sun node, Sun light, Turbidity, Ozone, Intensity
   multiplier, Sky model, Indirect horiz. illum., Ground Albedo, Blend angle, Horizon
   offset, Altitude — no cloud parameter at all. The full cloud system is the **Clouds
   section of the VRaySun** (VMAX/VRaySun), and the sky follows the active sun
   automatically. Correct ui_path: `VRaySun ▸ Modify panel ▸ Clouds ▸ …`.
2. There is **no cloud "coverage" parameter** — the doc names are Density, Density
   multiplier, Variety, Seed, Cirrus amount, Ground shadows (the target list missed the
   last three plus Density multiplier). Contrails are a six-parameter sub-group.
3. **VRayEnvironmentFog is added via `Rendering menu > Environment > Add`** (docs verbatim,
   the page's only UI path) — the Environment/Atmosphere side, not "Environment and Effects
   ▸ Effects" and not the environment map slot.
4. **Sky model option list is inconsistent between the two VMAX pages**: the VRaySky page
   (V-Ray 7-updated, 2026-04-28) prints 6 options including *PRG Clear Sky (old)* and
   states V-Ray 7 introduces the new PRG model (old scenes load the old one); the VRaySun
   page still prints 5 options without the "(old)" split. The spec uses the VRaySky list.
5. VRayEnvironmentFog target-list misses: there is **no "emission multiplier"** (Fog
   emission is a color + optional texture); **no "density/fog multiplier"** (density =
   inverse Fog distance, plus a Fog density texture); **no "Subdivs"** parameter in V-Ray 7
   (sampling = Step size / Texture samples / Cutoff threshold / Max steps, and the
   raymarcher only runs when a property is texture-mapped); **no "Light mode" dropdown**
   (that is V-Ray for Maya — the Max version has a *Use all lights* checkbox + *Lights*
   list); "fade (mode/radius)" exists as **Gizmo falloff radius / Gizmo falloff mode**
   (Multiply by density | Add density to falloff) and applies only to gizmo-confined fog.
6. VRayAerialPerspective has **no "sun node" picker** in the V-Ray 7 docs — it "works
   together with VRaySun and the VRaySky" automatically. The target list's "inscattered
   light multiplier" is named **Inscattered light intensity**. Extra doc params the list
   missed: Primary visibility, Affect alpha. Bonus doc fact: VRaySun's *Affect
   atmospherics* has **no effect** on VRayAerialPerspective.
7. Doc-printed defaults exist only for: Fog phase function (0.0), Inscattered light
   intensity (1.0), Affect environment rays (off), Affect background (on). Every other
   numeric default on these pages is unprinted → shipped `verified:false` with doc-example
   values where available.

**Chaos Vantage 3.3**

8. **Vantage fog is richer than the target list**: the Environment tab ▸ Fog rollout holds
   TWO systems — two independent "simple" layers the docs explicitly call *aerial
   perspective fog* (Enable fog / Enable fog 2; Fog visibility range **in km**; Fog height
   in m; Fog start distance; Fog max opacity 0–1; Fog color) plus a **Scattering Fog**
   volumetric group (color/distance/transparency/emission/height/start/end/light
   boost/max opacity/Affect secondary rays/Scatter GI/Scatter only infinite direct
   lights/Texture mode: Off | Built-in smoke density | From V-Ray scene, with smoke,
   ground-fog and raymarch sub-controls). The target list's "height falloff" does **not
   exist** as a parameter — the nearest is *Ground fog transition* inside the texture
   modes.
9. **Aerial perspective in Vantage is not a separate feature** — target item 6 collapses
   into item 4: the simple fog layers ARE the aerial perspective ("Enables aerial
   perspective fog to be applied in the scene", LAV/Fog).
10. **Vantage 3.3 exposes a full native cloud UI** (not just pass-through of V-Ray Sky
    clouds): Environment tab ▸ Clouds rollout with three tabs (Clouds settings / Clouds
    positioning settings / Contrails settings), **gated on Environment mode = Physical sky**
    (doc-stated). Parameters mirror the V-Ray sun clouds with renames — *Random seed* (vs
    Seed), *Start height* (vs Height (m)) — plus a Vantage-only **Improved shading** toggle.
    **Ground shadows semantics differ from Max**: in Vantage it enables/disables cloud
    shadows outright; in Max it switches precise per-point shadows vs a fast global
    approximation. Vantage prints no units for Offset/Start height/Thickness.
11. No numeric defaults are printed anywhere on the LAV Fog/Clouds pages (hence the higher
    `verified:false` share on the Vantage side).
12. Weather-adjacent extras seen but out of scope for step 6 (candidates for a later
    sub-step): **Wetting rollout** — NEW in 3.3, Beta (wet surfaces, puddles, animated
    ripples, surface drops; LAV/Wetting + What's New v3.3.0) and **Wind rollout** — Cloud
    wind direction angle / Cloud wind intensity animate the cloud system (viewport
    animation; gated on Physical sky + Enable clouds; LAV/Wind). The Environment Tab page
    also documents "Right-click a parameter value to reset it to its default."

# 4. Summary

| Pack | Group | Entries | verified "2026-07-03" | verified false |
|---|---|---|---|---|
| vray7max | fog.* | 8 | 4 | 4 |
| vray7max | aerial.* | 7 | 5 | 2 |
| vray7max | clouds.* | 15 | 7 | 8 |
| **vray7max total** | | **30** | **16** | **14** |
| vantage33 | fog.* | 12 | 6 | 6 |
| vantage33 | clouds.* | 15 | 7 | 8 |
| **vantage33 total** | | **27** | **13** | **14** |

- Every `verified:false` entry has a doc-checked ui_path; only a factory default (and, where
  noted, a unit or practical range) is unprinted in current Chaos docs. Assumed values use
  doc example values wherever one exists.
- Integration notes: (a) id namespaces follow the plan (`fog.*`, `aerial.*`, `clouds.*` /
  `fog.*`, `clouds.*`) and collide with nothing in the shipped packs; if cross-pack symmetry
  with vantage33's existing `env.sky_model` is preferred, rename `clouds.sky_model` →
  `env.sky_model` in vray7max. (b) If 30/27 entries is too heavy for the system prompt, the
  lean core is: fog.enabled/distance/height, aerial.enabled/visibility_range/inscatter,
  clouds.enabled/density/variety/cirrus_amount(+seed) per pack — the rest are exactness
  refinements. (c) `clouds.seed` (both packs) carries the same keep-identical-across-attempts
  warning as the display-side controls.
