# LightMatch — real-UI capture inventory (2026-07-03)

Ground truth transcribed from the user's **actual** V-Ray 7 for 3ds Max and Chaos Vantage 3.3 UI screenshots. This supersedes doc-grounding for these controls — the captures are the truth. Defaults shown are from a near-default scene, so they double as factory defaults.

## Feature decisions (complete settings sheet)
- **Coverage:** literally every control (1:1 mirror of the real panels).
- **Presentation:** the recipe renders as a complete settings sheet grouped by the real UI structure; controls the match *changes* are emphasized with from → to, the rest show their held/default value ("even the ones without any change").
- **Model stays surgical:** the vision model still emits only the moves it wants to make; the app fills the rest of the sheet from the pack scaffold + defaults. No change to the surgical/degeneracy philosophy.
- **Preserved:** refine loop, look-distance scores, correction cards, REFGRADE handoff. 99% reference-match bar.
- **Pack structure:** each control keyed by a stable id; carries `group` (real UI object/rollout or tab/panel), `ui_path` (verbatim), `kind` (spinner|dropdown|checkbox|color|slot|placement|button), `unit`, `default`, `range`/options, `lighting` flag (true = the model may set it; false = shown at default only, e.g. viewport wire color).

---

# V-Ray 7 for 3ds Max

## VRaySun

### Sun parameters
| id | ui_path | kind | default | notes |
|---|---|---|---|---|
| sun.enabled | VRaySun ▸ Sun parameters ▸ Enabled | checkbox | on | |
| sun.intensity_mult | VRaySun ▸ Sun parameters ▸ Intensity multiplier | spinner | 1.0 | |
| sun.size_mult | VRaySun ▸ Sun parameters ▸ Size multiplier | spinner | 1.0 | shadow softness |
| sun.filter_color | VRaySun ▸ Sun parameters ▸ Filter color | color | white | |
| sun.color_mode | VRaySun ▸ Sun parameters ▸ Color mode | dropdown | Filter | filter \| direct \| override |

### Sky parameters
| id | ui_path | kind | default | notes |
|---|---|---|---|---|
| sun.sky_model | VRaySun ▸ Sky parameters ▸ Sky model | dropdown | PRG Clear Sky | + Hosek/CIE/Preetham options |
| sun.ground_albedo | VRaySun ▸ Sky parameters ▸ Ground Albedo | color | gray | |
| sun.indirect_horiz_illum | VRaySun ▸ Sky parameters ▸ Indirect horiz illum | spinner | 25000.0 | |
| sun.blend_angle | VRaySun ▸ Sky parameters ▸ Blend angle | spinner | 0.1 | |
| sun.horizon_offset | VRaySun ▸ Sky parameters ▸ Horizon offset | spinner | 0.0 | |
| sun.turbidity | VRaySun ▸ Sky parameters ▸ Turbidity | spinner | **2.5** | CORRECTED (pack assumed 3.0) |
| sun.ozone | VRaySun ▸ Sky parameters ▸ Ozone | spinner | 0.35 | |
| sun.altitude | VRaySun ▸ Sky parameters ▸ Altitude | spinner | 0.0 | |
| sun.night_blueness | VRaySun ▸ Sky parameters ▸ Night blueness | spinner | 0.0 | |

### Clouds
| id | ui_path | kind | default | notes |
|---|---|---|---|---|
| clouds.on | VRaySun ▸ Clouds ▸ Clouds on | checkbox | off | |
| clouds.ground_shadows | VRaySun ▸ Clouds ▸ Ground shadows | checkbox | off | |
| clouds.density | VRaySun ▸ Clouds ▸ Density | spinner | 0.5 | |
| clouds.density_mult | VRaySun ▸ Clouds ▸ Density multiplier | spinner | 1.0 | |
| clouds.variety | VRaySun ▸ Clouds ▸ Variety | spinner | 0.3 | |
| clouds.seed | VRaySun ▸ Clouds ▸ Seed | spinner | 0 | keep identical across attempts |
| clouds.cirrus_amount | VRaySun ▸ Clouds ▸ Cirrus amount | spinner | 0.2 | |
| clouds.offset_x | VRaySun ▸ Clouds ▸ Offset X (m) | spinner | 0.0 | |
| clouds.offset_y | VRaySun ▸ Clouds ▸ Offset Y (m) | spinner | 0.0 | |
| clouds.height | VRaySun ▸ Clouds ▸ Height (m) | spinner | 1000.0 | |
| clouds.thickness | VRaySun ▸ Clouds ▸ Thickness (m) | spinner | 300.0 | |
| clouds.phase_x | VRaySun ▸ Clouds ▸ Phase X (%) | spinner | 0.0 | |
| clouds.phase_y | VRaySun ▸ Clouds ▸ Phase Y (%) | spinner | 0.0 | |
| clouds.enable_contrails | VRaySun ▸ Clouds ▸ Enable contrails | checkbox | off | |
| clouds.num_contrails | VRaySun ▸ Clouds ▸ Number of contrails | spinner | 5 | inactive until contrails |
| clouds.contrails_strength | VRaySun ▸ Clouds ▸ Contrails strength | spinner | 0.5 | inactive |
| clouds.contrails_distortion | VRaySun ▸ Clouds ▸ Contrails distortion | spinner | 0.5 | inactive |
| clouds.contrails_offset_x | VRaySun ▸ Clouds ▸ Contrails offset X (m) | spinner | 0.0 | inactive |
| clouds.contrails_offset_y | VRaySun ▸ Clouds ▸ Contrails offset Y (m) | spinner | 0.0 | inactive |
| clouds.contrails_time | VRaySun ▸ Clouds ▸ Contrails time | spinner | 0.0 | inactive |

### Night sky
| id | ui_path | kind | default |
|---|---|---|---|
| night.stars_milkyway | VRaySun ▸ Night sky ▸ Stars & Milky Way | checkbox | off |
| night.size_mult | VRaySun ▸ Night sky ▸ Size multiplier | spinner | 1.0 |
| night.size_difference | VRaySun ▸ Night sky ▸ Size difference | spinner | 0.0 |
| night.brightness | VRaySun ▸ Night sky ▸ Brightness | spinner | 1.0 |
| night.intensity_mult | VRaySun ▸ Night sky ▸ Intensity mult. | spinner | 1.0 |
| night.latitude | VRaySun ▸ Night sky ▸ Latitude | spinner | 42.7 |
| night.longitude | VRaySun ▸ Night sky ▸ Longitude | spinner | 23.333 |
| night.milkyway_mult | VRaySun ▸ Night sky ▸ Milky Way mult. | spinner | 1.0 |

### Night sky → Moon
| id | ui_path | kind | default |
|---|---|---|---|
| moon.size_mult | VRaySun ▸ Night sky ▸ Moon ▸ Size multiplier | spinner | 1.0 |
| moon.brightness | VRaySun ▸ Night sky ▸ Moon ▸ Brightness | spinner | 1.0 |
| moon.intensity_mult | VRaySun ▸ Night sky ▸ Moon ▸ Intensity mult. | spinner | 1.0 |
| moon.glow_mult | VRaySun ▸ Night sky ▸ Moon ▸ Glow mult. | spinner | 0.0 |
| moon.filter_color | VRaySun ▸ Night sky ▸ Moon ▸ Filter color | color | white |
| moon.azimuth | VRaySun ▸ Night sky ▸ Moon ▸ Azimuth | spinner | 0.0 |
| moon.elevation | VRaySun ▸ Night sky ▸ Moon ▸ Elevation | spinner | 0.0 |
| moon.phase | VRaySun ▸ Night sky ▸ Moon ▸ Phase | spinner | 0.0 |
| moon.rotation | VRaySun ▸ Night sky ▸ Moon ▸ Rotation | spinner | 0.0 |

### Options / Sampling
| id | ui_path | kind | default |
|---|---|---|---|
| sun.invisible | VRaySun ▸ Options ▸ Invisible | checkbox | off |
| sun.affect_diffuse | VRaySun ▸ Options ▸ Affect diffuse | checkbox+spinner | on, 1.0 |
| sun.affect_specular | VRaySun ▸ Options ▸ Affect specular | checkbox+spinner | on, 1.0 |
| sun.affect_atmos | VRaySun ▸ Options ▸ Affect atmos. | checkbox+spinner | on, 1.0 |
| sun.cast_atmos_shadows | VRaySun ▸ Options ▸ Cast atmospheric shadows | checkbox | on |
| sun.shadow_bias | VRaySun ▸ Sampling ▸ Shadow bias | spinner | 0.02 |
| sun.photon_emit_radius | VRaySun ▸ Sampling ▸ Photon emit radius | spinner | 50.0 |

## VRayLight (Type = Plane)
Rollouts: General, Plane/disc light, Options, Sampling, Decay, Viewport.
| id | ui_path | kind | default | notes |
|---|---|---|---|---|
| light.on | VRayLight ▸ General ▸ On | checkbox | on | |
| light.type | VRayLight ▸ General ▸ Type | dropdown | Plane | Plane/Disc/Sphere/Dome/Mesh |
| light.length | VRayLight ▸ General ▸ Length | spinner | 20.0 | |
| light.width | VRayLight ▸ General ▸ Width | spinner | 20.0 | |
| light.units | VRayLight ▸ General ▸ Units | dropdown | Default (image) | |
| light.multiplier | VRayLight ▸ General ▸ Multiplier | spinner | **30.0** | CONFIRMED (was verified:false) |
| light.mode | VRayLight ▸ General ▸ Mode | dropdown | Color | Color/Temperature |
| light.color | VRayLight ▸ General ▸ Color | color | white | |
| light.temperature | VRayLight ▸ General ▸ Temperature | spinner | 6500.0 | active only Mode=Temperature |
| light.map | VRayLight ▸ General ▸ Map | checkbox+slot | on, No Map | |
| light.directional | VRayLight ▸ Plane/disc light ▸ Directional | spinner | 0.0 | |
| light.directional_strength | VRayLight ▸ Plane/disc light ▸ Directional strength | spinner | 0.9 | |
| light.preview | VRayLight ▸ Plane/disc light ▸ Preview | dropdown | Never | |
| light.cast_shadows | VRayLight ▸ Options ▸ Cast shadows | checkbox | on | |
| light.double_sided | VRayLight ▸ Options ▸ Double-sided | checkbox | off | |
| light.invisible | VRayLight ▸ Options ▸ Invisible | checkbox | off | |
| light.affect_diffuse | VRayLight ▸ Options ▸ Affect diffuse | checkbox+spinner | on, 1.0 | |
| light.affect_specular | VRayLight ▸ Options ▸ Affect specular | checkbox+spinner | on, 1.0 | |
| light.affect_reflections | VRayLight ▸ Options ▸ Affect reflections | checkbox | on | |
| light.affect_atmos | VRayLight ▸ Options ▸ Affect atmos. | checkbox+spinner | on, 1.0 | |
| light.shadow_bias | VRayLight ▸ Sampling ▸ Shadow bias | spinner | 0.02 | |
| light.tex_resolution | VRayLight ▸ Sampling ▸ Tex resolution | spinner | 512 | |
| light.decay_near_on | VRayLight ▸ Decay ▸ Near on | checkbox | off | |
| light.decay_far_on | VRayLight ▸ Decay ▸ Far on | checkbox | off | |
| light.vp_wire_color | VRayLight ▸ Viewport ▸ Viewport wire color | checkbox+color | off, yellow | lighting:false |

## VRayIES
| id | ui_path | kind | default | notes |
|---|---|---|---|---|
| ies.enabled | VRayIES ▸ General ▸ Enabled | checkbox | on | |
| ies.targeted | VRayIES ▸ General ▸ Targeted | checkbox | on | |
| ies.file | VRayIES ▸ General ▸ IES file | slot | none | |
| ies.intensity_value | VRayIES ▸ Intensity and color ▸ Intensity value | spinner | 1700.0 | |
| ies.intensity_type | VRayIES ▸ Intensity and color ▸ Intensity type | dropdown | power (lm) | |
| ies.override_intensity | VRayIES ▸ Intensity and color ▸ Override intensity | dropdown | rescale | |
| ies.color_mode | VRayIES ▸ Intensity and color ▸ Color mode | dropdown | Color | |
| ies.color | VRayIES ▸ Intensity and color ▸ Color | color | magenta | |
| ies.color_temp | VRayIES ▸ Intensity and color ▸ Color temperature | spinner | 6500.0 | active only Color mode=Temperature |
| ies.shadow_bias | VRayIES ▸ Sampling ▸ Shadow bias | spinner | 0.02 | |
| ies.cast_shadows | VRayIES ▸ Options ▸ Cast shadows | checkbox | on | |
| ies.affect_diffuse | VRayIES ▸ Options ▸ Affect diffuse | checkbox+spinner | on, 1.0 | |
| ies.affect_specular | VRayIES ▸ Options ▸ Affect specular | checkbox+spinner | on, 1.0 | |
| ies.affect_atmos | VRayIES ▸ Options ▸ Affect atmos. | checkbox+spinner | on, 1.0 | |
| ies.use_light_shape | VRayIES ▸ Options ▸ Use light shape | dropdown | For shadow | |
| ies.show_distribution | VRayIES ▸ Viewport ▸ Show distribution | checkbox | on | lighting:false |
| ies.override_shape | VRayIES ▸ IES override ▸ Override shape | checkbox | off | + Shape/Height/Width/Length/Diameter (inactive) |

## VRayLuminaire
| id | ui_path | kind | default |
|---|---|---|---|
| lum.enabled | VRayLuminaire ▸ General ▸ Enabled | checkbox | on |
| lum.file | VRayLuminaire ▸ General ▸ Luminaire file | slot | none |
| lum.scale | VRayLuminaire ▸ General ▸ Scale | spinner | 1.0 |
| lum.intensity | VRayLuminaire ▸ Intensity and color ▸ Intensity | spinner | 1.0 |
| lum.color_mode | VRayLuminaire ▸ Intensity and color ▸ Color mode | dropdown | Color |
| lum.color | VRayLuminaire ▸ Intensity and color ▸ Color | color | white |
| lum.color_temp | VRayLuminaire ▸ Intensity and color ▸ Color temperature | spinner | 6500.0 (inactive) |
| lum.affect_diffuse | VRayLuminaire ▸ Options ▸ Affect diffuse | spinner | 1.0 |
| lum.affect_specular | VRayLuminaire ▸ Options ▸ Affect specular | spinner | 1.0 |
| lum.affect_atmos | VRayLuminaire ▸ Options ▸ Affect atmosph. | spinner | 1.0 |
| lum.cast_shadows | VRayLuminaire ▸ Options ▸ Cast shadows | checkbox | on |
| lum.filtering | VRayLuminaire ▸ Sampling ▸ Filtering | checkbox+spinner | on, 3.0 |
| lum.shadow_bias | VRayLuminaire ▸ Sampling ▸ Shadow bias | spinner | 0.02 |

## VRayAmbientLight
| id | ui_path | kind | default |
|---|---|---|---|
| amb.enabled | VRayAmbientLight ▸ Enabled | checkbox | on |
| amb.mode | VRayAmbientLight ▸ Mode | dropdown | Direct + GI |
| amb.gi_min_distance | VRayAmbientLight ▸ GI min distance | spinner | 0.0 |
| amb.color | VRayAmbientLight ▸ Color | color | black |
| amb.intensity | VRayAmbientLight ▸ Intensity | spinner | 1.0 |
| amb.light_map | VRayAmbientLight ▸ Light map | checkbox+spinner | on, 100.0 |
| amb.compensate_exposure | VRayAmbientLight ▸ Compensate exposure | checkbox | off |

## Keep from existing pack (already verified, not in these captures)
VRayPhysicalCamera (ISO/F-Number/Shutter/WB/EV), VFB layers (Exposure/Contrast/Saturation/White Balance), Render Setup ▸ Color mapping (Type/Burn value), Render Setup ▸ GI (Primary/Secondary engine), VRayEnvironmentFog, VRayAerialPerspective. Confirm Turbidity default → **2.5**; light.multiplier → **30.0**.

---

# Chaos Vantage 3.3

## Camera → Current camera options
resolution preset, resolution (w×h), display:render ratio, camera type, lens mode, field of view, exposure mode, F-Number, vignetting, motion blur (post), depth of field (+ focus distance, aperture size, center bias, anisotropy, blades, optical vignetting), automatic vertical tilt correction (+ tilt V/H, shift V/H), lens distortion, camera clipping. *(Full defaults in the conversation table; most `lighting:false` except exposure mode / F-Number.)*

## Color correction (each panel has an on/off toggle)
- **Exposure corrections:** exposure bias (0.0), highlight burn (1.0), contrast (0.0)
- **Filmic tonemap:** type (Hable), gamma (1.0), shoulder strength (0.15), linear strength (0.15), linear angle (0.1), toe strength (0.2), white point (11.2)
- **LUT:** amount (1.0), LUT file, color space (sRGB)
- **Lens Effects → General:** recalculate after X samples (5), size (30.0), intensity (1.0), bloom (0.4), threshold (1.0), rotation (0.0), saturation (1.0)
- **Bloom:** intensity (0.3), threshold (1.0), iterations/spread (5)
- **Blur / Sharpen:** blur radius (1.0), sharpen radius (1.0), sharpen amount (0.0)
- **Hue / Saturation:** hue (0.0), saturation (0.0), lightness (0.0) — centered/symmetric sliders
- **Color mixer:** 12 channel swatches; per-channel hue/saturation/lightness (0.0); show color affected area (off)
- **Color balance:** range tabs (All/Highlights/Midtones/Shadows); cyan–red (0.0), magenta–green (0.0), yellow–blue (0.0)
- **White balance:** temperature (6500.0), magenta-green tint (0.0), color
- **Chromatic aberration:** value (0.0)
- **Overlay:** blend mode (Normal), opacity (75%), source (Color/Image), color

## Environment
- **Sky:** environment mode (Texture), settings file, RGB color space (sRGB), flip horizontally (off), clamp to 1 (off), rotation (0.0°), intensity (1.0)
- **Sun and Moon → Sun:** enabled (on), [Sun Light] link (off), intensity (0.033), sun size (1.0), color mode (Filter), sun position mode (Altitude/Azimuth), altitude (45.0°), azimuth (135.0°), invisible (off). *(Sun default intensity 0.033 CONFIRMED.)*
- **Wetting:** ⚠️ GAP — panel not expanded in captures. Known from docs: Enable wetting (Beta), Wet cover (0–100%). Full panel (Size/Puddles/Occlusion, Drops and Ripples, Advanced) needs a capture.
- **Wind:** ⚠️ GAP — not captured at all.
- **Fog:** Enable simple fog 1 (on): visibility range (10 km), height (500 m), start distance (0 m), max opacity (1.0), color. Enable simple fog 2 (off). Enable scattering fog (on): color, distance (10 m), transparency, emission, height (10 m), start (0 m), end (0 m), light boost (1.0), max opacity (1.0), affect secondary rays (off), scatter only infinite direct lights (off), texture mode (Off).
- **Ambient settings:** ambient light color, ambient light intensity (0.0), ambient occlusion (off)
- **Background:** mode (Same as environment)

## Not captured (Vantage top tabs): Lights, Objects, Materials, Scene states — out of scope (per-object, not environment lighting).

## Gaps to close
1. Vantage **Wetting** full panel — expand + capture, or use docs.
2. Vantage **Wind** panel — expand + capture, or use docs.
3. The ±100 vs −1..1 range on Vantage Hue/Sat/Color-balance sliders — drag a slider to an extreme to read the bound.
