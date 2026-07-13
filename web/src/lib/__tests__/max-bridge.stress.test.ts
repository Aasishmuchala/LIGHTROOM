// 3ds Max bridge — ADVERSARIAL stress tests (2026-07-05 hardening pass). Pins the
// defenses the probe→harden pass added to lib/max-bridge.ts:
//   - buildApplyScript is SELF-DEFENDING (injection cannot survive even a direct call);
//   - parseMaxResponse rejects arrays, caps size, correlates requestId, never throws;
//   - buildPullScript stays read-only + safe-mode-clean;
//   - map*Result resist prototype pollution and junk;
//   - splitApplyValues never lets a non-finite/unmapped/display-only value into scriptable.
// Separate file from max-bridge.test.ts (the happy-path suite) — additive only.

import { describe, it, expect } from "vitest";
import {
  buildApplyScript,
  parseMaxResponse,
  buildPullScript,
  mapPullResult,
  mapApplyResult,
  splitApplyValues,
  SAFE_MODE_BLOCKLIST,
  type ApplyValue,
} from "../max-bridge";
import { KNOWN_PROPS } from "../export";

// seeded PRNG (mulberry32) for reproducible fuzz
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const isClean = (script: string) => {
  const lower = script.toLowerCase();
  return SAFE_MODE_BLOCKLIST.every((b) => !lower.includes(b));
};

describe("buildApplyScript — MAXScript injection is impossible even via a DIRECT call", () => {
  // The probe's headline finding: a string on a float branch would become live script.
  // Harden made the builder re-validate, so every hostile value is SKIPPED, not emitted.
  const HOSTILE: (number | string)[] = [
    "6; deletefile (getDir #temp)",
    "6\n doscommand \"calc\"",
    "0 ) (deletefile x) (",
    "1e9); shellLaunch \"cmd\" \"\"; (",
    "6 -- ",
    "0x10; hiddenDosCommand \"x\"",
    "'; python.execute \"import os\"; '",
    "١٢٣", // arabic-indic digits (NOT parsed as JS number)
    "Infinity",
    "NaN",
    "  6  ", // whitespace-padded numeric string — still a STRING, must be skipped on a float
    true as unknown as string,
    null as unknown as string,
    ({} as unknown) as string,
  ];
  it.each(HOSTILE)("float param with hostile value %o emits NOTHING for that value", (val) => {
    const script = buildApplyScript([{ param: "sun.turbidity", set: val }]);
    // safe-mode-clean AND the value never became an RHS
    expect(isClean(script)).toBe(true);
    expect(script).not.toContain("lmSun.turbidity =");
    // no setter row at all for the rejected value
    expect(script).not.toContain('append okArr "sun.turbidity"');
  });

  it("a hostile ENUM value cannot inject (must resolve to a known integer)", () => {
    const script = buildApplyScript([
      { param: "cm.type", set: "reinhard); deletefile x; (" },
      { param: "cm.type", set: "Reinhard" }, // the only legit one
    ]);
    expect(isClean(script)).toBe(true);
    // exactly one cm.type setter (the GPU/CPU-aware discovery line, 2026-07-13),
    // RHS is the integer 6 — never the hostile string
    const setters = script.split("\n").filter((l) => l.includes("setProperty renderers.current lmRProp"));
    expect(setters.length).toBe(1);
    expect(setters[0]).toContain("lmRProp 6");
    expect(script).not.toContain("deletefile");
  });

  it("an astronomically large finite number (exponential String()) is skipped, not emitted as 1e+21", () => {
    const script = buildApplyScript([{ param: "sun.turbidity", set: 1e21 }]);
    expect(script).not.toContain("1e+21");
    expect(script).not.toContain("lmSun.turbidity =");
    // plain in-range decimals still emit normally
    expect(buildApplyScript([{ param: "sun.turbidity", set: 100000 }])).toContain("lmSun.turbidity = 100000");
  });

  it("valid values still emit byte-identical setters (hardening is transparent to good input)", () => {
    const script = buildApplyScript([
      { param: "sun.turbidity", set: 6 },
      { param: "sun.enabled", set: "on" },
      { param: "cam.iso", set: 200 },
    ]);
    expect(script).toContain("lmSun.turbidity = 6");
    expect(script).toContain("lmSun.enabled = true");
    expect(script).toContain("lmCam.ISO = 200");
    expect((script.match(/append okArr/g) || []).length).toBe(3);
  });

  it("fuzz: 400 random scriptable arrays never emit an unclean script", () => {
    const rand = rng(0xa11ce);
    const params = Object.keys(KNOWN_PROPS);
    const junk: unknown[] = [
      0, 1, -5, 3.14, 1e9, NaN, Infinity, -Infinity, "6", "on", "off", "Reinhard",
      "'; deletefile x", "6)(doscommand", true, false, null, undefined, {}, [1],
    ];
    for (let i = 0; i < 400; i++) {
      const n = Math.floor(rand() * 5);
      const vals: ApplyValue[] = Array.from({ length: n }, () => ({
        param: params[Math.floor(rand() * params.length)],
        set: junk[Math.floor(rand() * junk.length)] as number | string,
      }));
      let script = "";
      expect(() => { script = buildApplyScript(vals); }).not.toThrow();
      expect(isClean(script)).toBe(true);
    }
  });
});

describe("parseMaxResponse — hostile wire input", () => {
  it("rejects a top-level JSON array as non-object (cannot masquerade as success)", () => {
    const res = parseMaxResponse('[1,2,3]\n');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/non-object/);
  });
  it("rejects bare number / null / string JSON", () => {
    expect(parseMaxResponse("42\n").success).toBe(false);
    expect(parseMaxResponse("null\n").success).toBe(false);
    expect(parseMaxResponse('"hi"\n').success).toBe(false);
  });
  it("caps an oversized response instead of parsing it", () => {
    const huge = "{" + '"x":"' + "A".repeat(5_000_000) + '"}\n';
    const res = parseMaxResponse(huge);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/size cap/);
  });
  it("correlates requestId when one is expected and echoed", () => {
    expect(parseMaxResponse('{"success":true,"requestId":"abc"}\n', "abc").success).toBe(true);
    const mismatch = parseMaxResponse('{"success":true,"requestId":"WRONG"}\n', "abc");
    expect(mismatch.success).toBe(false);
    expect(mismatch.error).toMatch(/requestId mismatch/);
    // lenient when the listener omits the id (older listeners)
    expect(parseMaxResponse('{"success":true}\n', "abc").success).toBe(true);
  });
  it("survives CRLF, trailing data, BOM, and pure garbage without throwing", () => {
    expect(parseMaxResponse('{"success":true}\r\nEXTRA').success).toBe(true);
    expect(parseMaxResponse("﻿" + '{"success":false,"error":"x"}\n').success).toBe(false);
    expect(parseMaxResponse("not json\n").success).toBe(false);
    expect(parseMaxResponse("").success).toBe(false);
  });
});

describe("buildPullScript — read-only + safe-mode-clean for the FULL prop set", () => {
  const script = buildPullScript();
  it("never contains a node-creation call for any KNOWN_PROPS node kind", () => {
    expect(script).not.toContain("lmFirstOrCreate");
    expect(script).not.toMatch(/VRaySun\s*\(\)/);
    expect(script).not.toMatch(/VRayLight\s*\(\)/);
    expect(script).not.toMatch(/VRayPhysicalCamera\s*\(\)/);
    // uses collect/find semantics only
    expect(script).toContain("collect o");
  });
  it("is safe-mode-clean and reads every KNOWN_PROPS id under a guard", () => {
    expect(isClean(script)).toBe(true);
    for (const param of Object.keys(KNOWN_PROPS)) expect(script).toContain(`\\"${param}\\"`);
    expect(script).toContain("!= undefined");
    expect(script).toContain("try (");
  });
});

describe("map*Result — prototype pollution + junk resistance", () => {
  it("wire keys constructor/toString/__proto__ are NOT trusted and do NOT pollute", () => {
    const pulled = mapPullResult(
      JSON.stringify({
        renderer: "V_Ray",
        counts: { suns: 1, vrayLights: 1, physCams: 1 },
        params: { constructor: 9, toString: 9, hasOwnProperty: 9, __proto__: 9, "sun.turbidity": 3 },
      })
    )!;
    expect(Object.keys(pulled.params)).toEqual(["sun.turbidity"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as { turbidity?: unknown }).turbidity).toBeUndefined();
  });
  it("NaN/Infinity numeric values and unknown cm.type int are dropped, never NaN'd through", () => {
    const pulled = mapPullResult(
      JSON.stringify({
        renderer: "V_Ray", counts: {},
        params: { "sun.turbidity": "not-a-number", "cm.type": 99, "sun.ozone": 0.35 },
      })
    )!;
    expect(pulled.params["sun.ozone"]).toBe(0.35);
    expect("cm.type" in pulled.params).toBe(false); // 99 has no reverse-map label
    expect(pulled.params["sun.turbidity"]).toBe("not-a-number"); // strings pass (bool params legitimately do)
  });
  it("junk payloads read as null / empty, never throw", () => {
    expect(mapPullResult("nonsense")).toBeNull();
    expect(mapPullResult(undefined)).toBeNull();
    expect(mapApplyResult("nonsense")).toEqual({ applied: [], failed: [] });
    expect(mapApplyResult(null)).toEqual({ applied: [], failed: [] });
  });
});

describe("splitApplyValues — nothing unsafe reaches scriptable, ever (fuzz)", () => {
  it("300 random arrays: scriptable is always finite-number / bool / known-enum only", () => {
    const rand = rng(0x5afe);
    const knownParams = Object.keys(KNOWN_PROPS);
    const pool: unknown[] = [
      "sun.turbidity", "sun.enabled", "cm.type", "light.vp_wire_color", "clouds.seed",
      "vfb.exposure", "not.a.param", "post.saturation",
    ];
    const setPool: unknown[] = [6, NaN, Infinity, "6", "on", "Reinhard", "prose", true, null, {}, [1], -3.2];
    for (let i = 0; i < 300; i++) {
      const n = Math.floor(rand() * 6);
      const values = Array.from({ length: n }, () => ({
        param: (rand() < 0.7 ? knownParams : pool)[Math.floor(rand() * (rand() < 0.7 ? knownParams.length : pool.length))],
        set: setPool[Math.floor(rand() * setPool.length)],
      })) as ApplyValue[];
      let split!: ReturnType<typeof splitApplyValues>;
      expect(() => { split = splitApplyValues(values, "vray7max"); }).not.toThrow();
      for (const s of split.scriptable) {
        const m = KNOWN_PROPS[s.param];
        expect(m).toBeTruthy(); // only KNOWN_PROPS params
        if (m.type === "float") expect(typeof s.set === "number" && Number.isFinite(s.set)).toBe(true);
        if (m.type === "enum") expect(typeof s.set === "string").toBe(true);
      }
    }
  });
  it("a display-only (lighting:false) pack param is never scriptable and never manual — dropped", () => {
    const { scriptable, manual } = splitApplyValues(
      [{ param: "clouds.seed", set: 5 }, { param: "light.vp_wire_color", set: "red" }],
      "vray7max"
    );
    expect(scriptable).toEqual([]);
    expect(manual).toEqual([]);
  });
});
