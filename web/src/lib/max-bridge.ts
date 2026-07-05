// LightMatch ↔ 3ds Max live bridge — PURE protocol + script builders (no sockets, no
// DOM; the network hop lives in app/api/max/route.ts).
//
// Talks to the cl0nazepamm/3dsmax-mcp listener running inside 3ds Max:
//   wire: one JSON line  {"command","type","requestId","protocolVersion":2}\n
//         → one JSON line back {success, result, error?, requestId, ...}
//   transports (route-side): named pipe \\.\pipe\3dsmax-mcp (native bridge / claimed
//         instance pipe from %LOCALAPPDATA%\3dsmax-mcp\active_instance.json) with a
//         TCP 127.0.0.1:8765 fallback (the MAXScript listener's legacy transport).
//
// HONESTY CONTRACT (same as export.ts, whose KNOWN_PROPS this reuses): the bridge
// reads and writes ONLY properties that map has vouched for. Pull NEVER creates
// nodes — a scene without a VRaySun simply reports those params missing. Apply uses
// the same create-or-find semantics as the exported .ms. Values that cannot be
// scripted are returned as `manual` so the UI can hand them to the human.
//
// SAFE-MODE COMPATIBILITY: the in-Max listener (safe_mode=true) blocks scripts
// containing doscommand/shelllaunch/deletefile/python.execute/createfile/
// hiddendoscommand — the builders below emit none of those (pinned by test).

import { KNOWN_PROPS, type MsNode } from "./export";
import { PACKS } from "./packs";
import type { TargetId } from "./types";

// ---------------------------------------------------------------------------------
// wire protocol
// ---------------------------------------------------------------------------------
export interface MaxRequest {
  command: string;
  type: "maxscript" | "ping";
  requestId: string;
  protocolVersion: 2;
}

export function buildMaxRequest(
  command: string,
  type: "maxscript" | "ping",
  requestId: string
): string {
  const req: MaxRequest = { command, type, requestId, protocolVersion: 2 };
  return JSON.stringify(req) + "\n";
}

export interface MaxResponse {
  success: boolean;
  result?: unknown;
  error?: string;
  requestId?: string;
}

// -- parseMaxResponse(raw): first JSON line out of the socket buffer. Never throws —
// a malformed line reads as a failed response with the parse problem as the error. --
// A real reply is one tiny JSON line; anything past this is a buggy/hostile listener
// and we refuse to allocate a second full copy via split() for it (DoS defense; the
// socket-side cap in route.ts sendOnce is the first line of defense, this is the second).
const MAX_RESPONSE_CHARS = 4_000_000;
export function parseMaxResponse(raw: string | Buffer, expectedRequestId?: string): MaxResponse {
  let text = typeof raw === "string" ? raw : raw.toString("utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  if (text.length > MAX_RESPONSE_CHARS) {
    return { success: false, error: "response from 3ds Max exceeded size cap" };
  }
  const line = text.split("\n")[0].trim();
  if (!line) return { success: false, error: "empty response from 3ds Max" };
  try {
    const parsed = JSON.parse(line) as MaxResponse;
    // Reject non-objects AND arrays (typeof []==="object"): an array/`success`-less
    // reply must NOT read as a healthy ping (route.ts checks `success !== false`).
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { success: false, error: "non-object response from 3ds Max" };
    }
    // requestId correlation (the cl0nazepamm reference client verifies this): if the
    // listener echoes an id, it MUST match the one we sent. Lenient when the field is
    // absent so older listeners still answer. Harmless today (one connection per call),
    // but forecloses accepting a replayed/mismatched line on any future reused channel.
    if (
      expectedRequestId &&
      typeof parsed.requestId === "string" &&
      parsed.requestId !== expectedRequestId
    ) {
      return { success: false, error: "requestId mismatch from 3ds Max", requestId: parsed.requestId };
    }
    return parsed;
  } catch {
    return { success: false, error: "unparseable response from 3ds Max: " + line.slice(0, 200) };
  }
}

// ---------------------------------------------------------------------------------
// PULL — read the current scene's lighting state (V-Ray 7 / 3ds Max only).
// The script returns a single JSON STRING as its value: the listener passes it back
// in `result`. Read-only by construction: nodes are FOUND, never created; every
// property read is try/catch'd so one odd node cannot sink the pull.
// ---------------------------------------------------------------------------------
const PULLABLE: { param: string; node: MsNode; prop: string; kind: "bool" | "float" | "enum" }[] =
  Object.entries(KNOWN_PROPS).map(([param, m]) => ({
    param,
    node: m.node,
    prop: m.prop,
    kind: m.type,
  }));

// cm.type int → the pack's dropdown option string (reverse of export.ts's enum map).
const CM_TYPE_BY_INDEX: Record<number, string> = {
  0: "Linear multiply",
  1: "Exponential",
  2: "HSV exponential",
  3: "Intensity exponential",
  6: "Reinhard",
};

export function buildPullScript(): string {
  const reads: string[] = [];
  for (const p of PULLABLE) {
    const src =
      p.node === "renderer"
        ? `renderers.current.${p.prop}`
        : `${nodeLocal(p.node)}.${p.prop}`;
    const guard = p.node === "renderer" ? "true" : `${nodeLocal(p.node)} != undefined`;
    if (p.kind === "bool") {
      reads.push(
        `try ( if ${guard} do append ps ("\\"${p.param}\\":\\"" + (if ${src} then "on" else "off") + "\\"") ) catch ()`
      );
    } else {
      // float and enum both read as a bare number (enum ints are mapped back client-side)
      reads.push(
        `try ( if ${guard} do append ps ("\\"${p.param}\\":" + ((${src}) as string)) ) catch ()`
      );
    }
  }
  return [
    "(",
    "	local ps = #()",
    "	local suns = for o in lights where classOf o == VRaySun collect o",
    "	local vlights = for o in lights where classOf o == VRayLight collect o",
    "	local planes = for o in vlights where (try (o.type == 0) catch (false)) collect o",
    "	local domes = for o in vlights where (try (o.type == 1) catch (false)) collect o",
    "	local cams = for o in cameras where classOf o == VRayPhysicalCamera collect o",
    "	local lmSun = if suns.count > 0 then suns[1] else undefined",
    "	local lmLight = if vlights.count > 0 then vlights[1] else undefined",
    "	local lmPlane = if planes.count > 0 then planes[1] else undefined",
    "	local lmDome = if domes.count > 0 then domes[1] else undefined",
    "	local lmCam = if cams.count > 0 then cams[1] else undefined",
    ...reads.map((r) => "	" + r),
    '	local rendererName = try (MCP_Server.escapeJsonString ((classOf renderers.current) as string)) catch ("unknown")',
    "	local body = \"\"",
    '	for i = 1 to ps.count do body += (if i > 1 then "," else "") + ps[i]',
    '	"{\\"renderer\\":\\"" + rendererName + "\\",\\"counts\\":{\\"suns\\":" + (suns.count as string) + ",\\"vrayLights\\":" + (vlights.count as string) + ",\\"physCams\\":" + (cams.count as string) + "},\\"params\\":{" + body + "}}"',
    ")",
  ].join("\n");
}

function nodeLocal(node: Exclude<MsNode, "renderer">): string {
  return { sun: "lmSun", light: "lmLight", plane: "lmPlane", dome: "lmDome", cam: "lmCam" }[node];
}

/** The pulled scene state, mapped back into pack vocabulary. */
export interface PulledSettings {
  renderer: string;
  vray: boolean;
  counts: { suns: number; vrayLights: number; physCams: number };
  params: Record<string, number | string>;
  missing: string[]; // KNOWN_PROPS params the scene could not provide
}

// -- mapPullResult(result): the listener returns the script's JSON string; parse and
// normalize (cm.type int → option string; anything absent → missing[]). ------------
export function mapPullResult(result: unknown): PulledSettings | null {
  let obj: Record<string, unknown>;
  try {
    obj = typeof result === "string" ? JSON.parse(result) : (result as Record<string, unknown>);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rawParams = (obj.params || {}) as Record<string, unknown>;
  // Object.create(null): no prototype, so a hostile wire key like "constructor" can
  // never collide with an inherited member downstream (defense in depth).
  const params: Record<string, number | string> = Object.create(null);
  for (const [k, v] of Object.entries(rawParams)) {
    // OWN-property gate (NOT `k in KNOWN_PROPS`): `in` walks the prototype chain, so
    // "constructor"/"toString"/"valueOf"/"hasOwnProperty"/"__proto__" would falsely pass
    // and leak attacker-chosen rows into PulledSettings.params → the LLM's authoritative
    // "CURRENT SCENE SETTINGS" block. hasOwnProperty rejects them while accepting every
    // real dotted KNOWN_PROPS id.
    if (!Object.prototype.hasOwnProperty.call(KNOWN_PROPS, k)) continue; // never trust extra keys from the wire
    if (k === "cm.type" && typeof v === "number") {
      const label = CM_TYPE_BY_INDEX[v];
      if (label) params[k] = label;
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) params[k] = v;
    else if (typeof v === "string") params[k] = v;
  }
  const counts = (obj.counts || {}) as Record<string, unknown>;
  const renderer = typeof obj.renderer === "string" ? obj.renderer : "unknown";
  return {
    renderer,
    vray: /v_?ray/i.test(renderer),
    counts: {
      suns: Number(counts.suns) || 0,
      vrayLights: Number(counts.vrayLights) || 0,
      physCams: Number(counts.physCams) || 0,
    },
    params,
    missing: Object.keys(KNOWN_PROPS).filter((k) => !(k in params)),
  };
}

// ---------------------------------------------------------------------------------
// APPLY — set the recipe's scriptable values in the live scene.
// splitApplyValues() decides scriptable vs manual EXACTLY like export.ts does (same
// map, same type rules); buildApplyScript() then emits per-value try/catch setters
// and returns a JSON summary string {"applied":[...],"failed":[...]}.
// ---------------------------------------------------------------------------------
export interface ApplyValue {
  param: string;
  set: number | string;
}
export interface ApplySplit {
  scriptable: ApplyValue[];
  manual: { param: string; ui_path: string; set: number | string }[];
}

function toBool(v: unknown): boolean | null {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "on" || t === "true") return true;
    if (t === "off" || t === "false") return false;
  }
  return null;
}

export function splitApplyValues(
  values: ApplyValue[],
  target: TargetId | string
): ApplySplit {
  const scriptable: ApplyValue[] = [];
  const manual: ApplySplit["manual"] = [];
  for (const v of values || []) {
    if (!v || typeof v.param !== "string") continue;
    const entry = PACKS.lookup(target, v.param);
    if (!entry || entry.lighting !== true) continue; // never apply outside the lighting set
    const m = KNOWN_PROPS[v.param];
    const uiPath = entry.ui_path;
    if (!m || String(target) !== "vray7max") {
      manual.push({ param: v.param, ui_path: uiPath, set: v.set });
      continue;
    }
    if (m.type === "bool" && toBool(v.set) !== null) scriptable.push(v);
    else if (m.type === "float" && typeof v.set === "number" && Number.isFinite(v.set))
      scriptable.push(v);
    else if (
      m.type === "enum" &&
      typeof v.set === "string" &&
      Object.prototype.hasOwnProperty.call(m.options, v.set.trim().toLowerCase())
    )
      scriptable.push(v);
    else manual.push({ param: v.param, ui_path: uiPath, set: v.set });
  }
  return { scriptable, manual };
}

export function buildApplyScript(scriptable: ApplyValue[]): string {
  const usedNodes = new Set<MsNode>();
  const setters: string[] = [];
  for (const v of scriptable) {
    const m = KNOWN_PROPS[v.param];
    if (!m) continue;
    // SELF-DEFENDING (defense-in-depth): buildApplyScript is an EXPORTED pure builder
    // whose only documented precondition is "caller already ran splitApplyValues".
    // Do NOT trust that — re-apply splitApplyValues' exact type/finiteness rules HERE so
    // a direct/forgetful caller can never interpolate an unchecked value into the emitted
    // `${lhs} = ${rhs}` setter. A string on a float branch would otherwise become live
    // MAXScript (RCE-class) that also slips past SAFE_MODE_BLOCKLIST (a substring denylist,
    // not an allowlist). Any value failing its type check is SKIPPED (never emitted), so
    // the wire contract stays byte-identical for valid input.
    let rhs: string;
    if (m.type === "bool") {
      const b = toBool(v.set);
      if (b === null) continue;
      rhs = String(b);
    } else if (m.type === "float") {
      if (typeof v.set !== "number" || !Number.isFinite(v.set)) continue;
      rhs = String(v.set);
      // The RHS must be a PLAIN decimal literal. String() of an astronomically large
      // magnitude yields exponential form ("1e+21") whose `+` may be a MAXScript syntax
      // error — and a syntax error fails the WHOLE apply compile (try/catch only traps
      // runtime errors). Not an injection (no code can hide in String(finiteNumber)),
      // but this keeps the emitted script always-compilable. Unreachable via the route
      // (values are pack-clamped first); this guards a direct/defense-in-depth caller.
      if (!/^-?\d+(\.\d+)?$/.test(rhs)) continue;
    } else {
      // enum: the option key MUST resolve to a known integer (an unknown key would emit
      // `= undefined` today). hasOwnProperty avoids matching inherited names.
      const key = String(v.set).trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(m.options, key)) continue;
      rhs = String(m.options[key]);
    }
    usedNodes.add(m.node);
    const lhs =
      m.node === "renderer" ? `renderers.current.${m.prop}` : `${nodeLocal(m.node)}.${m.prop}`;
    setters.push(
      `try ( ${lhs} = ${rhs}; append okArr "${v.param}" ) catch ( append failArr "${v.param}" )`
    );
  }

  const setup: string[] = [];
  if (usedNodes.has("sun"))
    setup.push("	local lmSun = lmFirstOrCreate VRaySun");
  if (usedNodes.has("light"))
    setup.push("	local lmLight = lmFirstOrCreate VRayLight");
  if (usedNodes.has("plane"))
    setup.push("	local lmPlane = lmVRayLightOfType 0");
  if (usedNodes.has("dome"))
    setup.push("	local lmDome = lmVRayLightOfType 1");
  if (usedNodes.has("cam")) {
    setup.push("	local lmCam = lmFirstOrCreate VRayPhysicalCamera");
    // ISO / f-number / shutter have ZERO brightness effect unless the camera's exposure
    // is ON (docs; audit blocker 2026-07-05). Enable it before the setters run, or the
    // step-1 exposure lock silently no-ops. Guarded — a camera without the property is
    // simply left as-is. NOTE: this targets the VRayPhysicalCamera; a scene whose render
    // camera is the Autodesk Physical Camera is a separate, Max-side limitation the UI
    // surfaces via the pull's physCams count.
    setup.push('	try ( lmCam.exposure = true ) catch ()');
  }

  return [
    "(",
    "	fn lmFirstOrCreate cls = (",
    "		local xs = for o in objects where classOf o == cls collect o",
    "		if xs.count > 0 then xs[1] else (cls())",
    "	)",
    "	fn lmVRayLightOfType t = (",
    "		local xs = for o in objects where classOf o == VRayLight collect o",
    "		local hit = undefined",
    "		for o in xs while hit == undefined do ( if (try (o.type == t) catch (false)) do hit = o )",
    "		if hit != undefined then hit else ( local nl = VRayLight(); try (nl.type = t) catch (); nl )",
    "	)",
    "	local okArr = #()",
    "	local failArr = #()",
    ...setup,
    ...setters.map((s) => "	" + s),
    "	fn lmJoin arr = (",
    "		local s = \"\"",
    '		for i = 1 to arr.count do s += (if i > 1 then "," else "") + "\\"" + arr[i] + "\\""',
    "		s",
    "	)",
    '	"{\\"applied\\":[" + (lmJoin okArr) + "],\\"failed\\":[" + (lmJoin failArr) + "]}"',
    ")",
  ].join("\n");
}

/** the apply summary the route hands back to the UI. */
export interface ApplyResult {
  applied: string[];
  failed: string[];
}
export function mapApplyResult(result: unknown): ApplyResult {
  try {
    const obj = typeof result === "string" ? JSON.parse(result) : (result as Record<string, unknown>);
    return {
      applied: Array.isArray((obj as { applied?: unknown }).applied)
        ? ((obj as { applied: unknown[] }).applied.filter((x) => typeof x === "string") as string[])
        : [],
      failed: Array.isArray((obj as { failed?: unknown }).failed)
        ? ((obj as { failed: unknown[] }).failed.filter((x) => typeof x === "string") as string[])
        : [],
    };
  } catch {
    return { applied: [], failed: [] };
  }
}

// The safe-mode blocklist the in-Max listener enforces — pinned here so a test can
// assert our generated scripts never trip it.
export const SAFE_MODE_BLOCKLIST = [
  "doscommand",
  "shelllaunch",
  "deletefile",
  "python.execute",
  "createfile",
  "hiddendoscommand",
] as const;
