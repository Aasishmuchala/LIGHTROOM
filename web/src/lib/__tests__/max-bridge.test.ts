// 3ds Max bridge — pure-layer tests: wire framing, script generation honesty
// (KNOWN_PROPS only, read-only pull, safe-mode clean), and result mapping.

import { describe, it, expect } from "vitest";
import {
  buildMaxRequest,
  parseMaxResponse,
  buildPullScript,
  mapPullResult,
  splitApplyValues,
  buildApplyScript,
  mapApplyResult,
  SAFE_MODE_BLOCKLIST,
} from "../max-bridge";
import { KNOWN_PROPS } from "../export";
import { PACKS } from "../packs";

describe("wire protocol", () => {
  it("requests are one newline-terminated JSON line with protocolVersion 2", () => {
    const raw = buildMaxRequest("sphere()", "maxscript", "abc123");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      command: "sphere()",
      type: "maxscript",
      requestId: "abc123",
      protocolVersion: 2,
    });
  });

  it("responses parse through BOM, trailing data, and garbage without throwing", () => {
    expect(parseMaxResponse('{"success":true,"result":"ok"}\n')).toMatchObject({
      success: true,
      result: "ok",
    });
    expect(parseMaxResponse("﻿" + '{"success":false,"error":"x"}\n')).toMatchObject({
      success: false,
    });
    expect(parseMaxResponse("not json at all\n").success).toBe(false);
    expect(parseMaxResponse("").success).toBe(false);
    expect(parseMaxResponse(Buffer.from('{"success":true}\nEXTRA')).success).toBe(true);
  });
});

describe("pull script — read-only, safe-mode clean, KNOWN_PROPS only", () => {
  const script = buildPullScript();

  it("never trips the in-Max safe-mode blocklist", () => {
    const lower = script.toLowerCase();
    for (const blocked of SAFE_MODE_BLOCKLIST) expect(lower).not.toContain(blocked);
  });

  it("NEVER creates nodes — pull is a read", () => {
    expect(script).not.toContain("lmFirstOrCreate");
    expect(script).not.toMatch(/VRaySun\s*\(\)/);
    expect(script).not.toMatch(/VRayLight\s*\(\)/);
    expect(script).not.toMatch(/VRayPhysicalCamera\s*\(\)/);
  });

  it("reads every KNOWN_PROPS param and nothing else", () => {
    for (const param of Object.keys(KNOWN_PROPS)) {
      expect(script).toContain(`\\"${param}\\"`);
    }
  });

  it("guards every node read so an empty scene still answers", () => {
    expect(script).toContain("lmSun != undefined");
    expect(script).toContain("lmCam != undefined");
    expect(script).toContain("try (");
  });
});

describe("mapPullResult", () => {
  it("maps params, reverse-maps cm.type ints, and lists what is missing", () => {
    const pulled = mapPullResult(
      JSON.stringify({
        renderer: "V_Ray_7_Hotfix_1",
        counts: { suns: 1, vrayLights: 2, physCams: 1 },
        params: { "sun.turbidity": 3.2, "sun.enabled": "on", "cm.type": 6, "not.a.param": 99 },
      })
    )!;
    expect(pulled.vray).toBe(true);
    expect(pulled.params["sun.turbidity"]).toBe(3.2);
    expect(pulled.params["sun.enabled"]).toBe("on");
    expect(pulled.params["cm.type"]).toBe("Reinhard");
    expect("not.a.param" in pulled.params).toBe(false); // wire keys are never trusted blindly
    expect(pulled.missing).toContain("cam.iso"); // absent from the payload
    expect(pulled.missing).not.toContain("sun.turbidity");
  });

  it("garbage payloads read as null, never throw", () => {
    expect(mapPullResult("not json")).toBeNull();
    expect(mapPullResult(undefined)).toBeNull();
    expect(mapPullResult(42)).toBeNull();
  });

  // C16: the deprecated gamma options (4/5) are real dropdown positions per the pack —
  // a legacy scene sitting on one is a LIVE setting the model must see, not "missing"
  // (pull reports the truth; only APPLY refuses to emit the deprecated pair).
  it("reverse-maps the deprecated gamma cm.type ints (4/5) instead of reporting them missing", () => {
    for (const [idx, label] of [
      [4, "Gamma correction"],
      [5, "Intensity gamma"],
    ] as const) {
      const pulled = mapPullResult(
        JSON.stringify({ renderer: "V_Ray_7", counts: {}, params: { "cm.type": idx } })
      )!;
      expect(pulled.params["cm.type"]).toBe(label);
      expect(pulled.missing).not.toContain("cm.type");
    }
  });

  it("covers the pack's FULL legal cm.type set: every int 0..6 maps to a pack-listed option", () => {
    const notes = PACKS.lookup("vray7max", "cm.type")!.notes;
    for (let idx = 0; idx <= 6; idx++) {
      const pulled = mapPullResult(
        JSON.stringify({ renderer: "V_Ray_7", counts: {}, params: { "cm.type": idx } })
      )!;
      const label = pulled.params["cm.type"];
      expect(typeof label, `cm.type int ${idx} must reverse-map to an option string`).toBe(
        "string"
      );
      expect(notes).toContain(label as string); // the exact option token the pack lists
    }
  });
});

describe("splitApplyValues — same honesty rules as the .ms export", () => {
  it("floats/bools/known-enums are scriptable; strings-on-floats and unmapped go manual", () => {
    const { scriptable, manual } = splitApplyValues(
      [
        { param: "sun.turbidity", set: 6 }, // float -> scriptable
        { param: "sun.enabled", set: "on" }, // bool -> scriptable
        { param: "cm.type", set: "Reinhard" }, // known enum -> scriptable
        { param: "sun.turbidity", set: "very hazy" } as never, // prose on float -> manual
        { param: "vfb.exposure", set: 0.5 }, // no scriptable path -> manual
        { param: "light.vp_wire_color", set: "red" }, // display-only -> DROPPED entirely
        { param: "not.in.pack", set: 1 }, // unknown -> dropped
      ],
      "vray7max"
    );
    expect(scriptable.map((v) => v.param)).toEqual(["sun.turbidity", "sun.enabled", "cm.type"]);
    expect(manual.map((m) => m.param)).toEqual(["sun.turbidity", "vfb.exposure"]);
    expect(manual[1].ui_path).toContain("Exposure layer");
  });

  it("a non-V-Ray target has no scriptable surface — everything is manual", () => {
    const { scriptable, manual } = splitApplyValues(
      [{ param: "post.saturation", set: 0.2 }],
      "vantage33"
    );
    expect(scriptable).toEqual([]);
    expect(manual.length).toBe(1);
  });
});

describe("buildApplyScript", () => {
  const script = buildApplyScript([
    { param: "sun.turbidity", set: 6 },
    { param: "sun.enabled", set: "on" },
    { param: "cam.iso", set: 200 },
    { param: "cm.type", set: "Reinhard" },
  ]);

  it("emits per-value try/catch setters against the verified property names", () => {
    expect(script).toContain("lmSun.turbidity = 6");
    expect(script).toContain("lmSun.enabled = true");
    expect(script).toContain("lmCam.ISO = 200");
    expect(script).toContain("renderers.current.colorMapping_type = 6");
    expect((script.match(/append okArr/g) || []).length).toBe(4);
    expect((script.match(/append failArr/g) || []).length).toBe(4);
  });

  it("only sets up the nodes it actually touches, and ends with the JSON summary", () => {
    expect(script).toContain("lmFirstOrCreate VRaySun");
    expect(script).toContain("lmFirstOrCreate VRayPhysicalCamera");
    // the helper FN is always defined, but no plane/dome locals are set up (and thus
    // no plane/dome light is ever created) when the recipe touches neither:
    expect(script).not.toContain("local lmPlane");
    expect(script).not.toContain("local lmDome");
    expect(script.trimEnd().endsWith(")")).toBe(true);
    expect(script).toContain('\\"applied\\"');
    expect(script).toContain('\\"failed\\"');
  });

  it("stays safe-mode clean", () => {
    const lower = script.toLowerCase();
    for (const blocked of SAFE_MODE_BLOCKLIST) expect(lower).not.toContain(blocked);
  });
});

describe("mapApplyResult", () => {
  it("parses the summary and never throws on junk", () => {
    expect(mapApplyResult('{"applied":["sun.turbidity"],"failed":[]}')).toEqual({
      applied: ["sun.turbidity"],
      failed: [],
    });
    expect(mapApplyResult("garbage")).toEqual({ applied: [], failed: [] });
    expect(mapApplyResult(null)).toEqual({ applied: [], failed: [] });
  });
});
