// Control SCOPE classification — the big-project layer. Every pack control affects
// one of three blast radii in the host scene:
//
//   "global"  — one-per-scene: sun, sky/dome/environment, GI, color mapping, fog/
//               aerial, clouds, wetting, wind, moon/night, ambient. Change it for one
//               shot and EVERY area of the project inherits it.
//   "camera"  — per-shot: the physical camera's exposure triad + WB, and the VFB /
//               post display corrections. Safe to tune per area.
//   "local"   — lights that live IN an area (fill lights, fill planes, IES fixtures,
//               Vantage luminaires). They only touch what they illuminate.
//
// scopeOf() drives "Area mode" (session.lockGlobals): per-area sessions on a big
// project keep the globals frozen — matched once on the hero shot — and solve each
// area with camera + local moves only. The map is keyed on the id PREFIX (the segment
// before the first dot), which is how the packs are organized; prefixes are PINNED
// exhaustively (scope.test.ts fails on any pack prefix this map doesn't know), so a
// future pack addition forces a conscious scope decision instead of a silent default.

export type ControlScope = "global" | "camera" | "local";

export const PREFIX_SCOPE: Record<string, ControlScope> = {
  // per-shot camera + display
  cam: "camera",
  vfb: "camera",
  post: "camera",
  // per-area light sources
  light: "local",
  fill: "local",
  ies: "local",
  lum: "local",
  // one-per-scene
  sun: "global",
  dome: "global",
  env: "global",
  gi: "global",
  cm: "global",
  fog: "global",
  aerial: "global",
  clouds: "global",
  wet: "global",
  wind: "global",
  moon: "global",
  night: "global",
  amb: "global",
};

// -- scopeOf(paramId): classify one pack param id. Unknown prefixes classify as
// "global" — the CONSERVATIVE end for Area mode (an unknown control is withheld
// rather than silently applied scene-wide); the test pin keeps this branch dead
// for every param the packs actually contain. -------------------------------------
export function scopeOf(paramId: string): ControlScope {
  const dot = paramId.indexOf(".");
  const prefix = dot > 0 ? paramId.slice(0, dot) : paramId;
  return Object.prototype.hasOwnProperty.call(PREFIX_SCOPE, prefix)
    ? PREFIX_SCOPE[prefix]
    : "global";
}

// Human-readable group lists for the Area-mode prompt constraint (kept here beside
// the map so prose and behavior can't drift apart).
export const LOCKED_GROUPS_PROSE =
  "sun, sky/dome/environment, GI, color mapping, fog/aerial perspective, clouds, wetting, wind, moon/night sky, and ambient";
export const ALLOWED_GROUPS_PROSE =
  "the physical camera's exposure and white balance (cam.*), per-shot VFB/post display corrections (vfb.*, post.*), and local area lights (light.*, fill.*, ies.*, lum.*)";

const scope = { scopeOf, PREFIX_SCOPE, LOCKED_GROUPS_PROSE, ALLOWED_GROUPS_PROSE };
export default scope;
