// toMaxScript RESILIENCE (2026-07-05, real-Max bug): the exported .ms must wrap every
// setter in try/catch so a property this specific renderer/scene lacks is SKIPPED and
// reported, never a fatal FileIn exception. The trigger was V-Ray GPU: it has no
// `colorMapping_type`, and the un-wrapped assignment aborted the whole FileIn so nothing
// applied. Pins the fix (and forbids the crash pattern's return).

import { describe, it, expect } from "vitest";
import { toMaxScript } from "../export";

const recipe = {
  baseline: "factory_defaults",
  hdri_mood: "golden hour",
  values: [
    { param: "sun.turbidity", set: 6, from: 3, step: 2, confidence: "high", why: "hazier" },
    { param: "sun.enabled", set: "on", from: "off", step: 2, confidence: "high", why: "on" },
    { param: "cam.iso", set: 200, from: 100, step: 1, confidence: "high", why: "iso" },
    { param: "cm.type", set: "Reinhard", from: "Linear multiply", step: 5, confidence: "high", why: "tm" },
  ],
  rationale: "x", gi_notes: "y", status: "continue",
} as unknown as Parameters<typeof toMaxScript>[0];

describe("toMaxScript — every setter is crash-isolated (try/catch + lmOk/lmFail)", () => {
  const s = toMaxScript(recipe, "vray7max");

  it("declares the ok/fail tallies and prints a summary listing failures", () => {
    expect(s).toContain("local lmOk = #()");
    expect(s).toContain("local lmFail = #()");
    expect(s).toContain("lmFail as string"); // the "set these by hand" summary
  });

  it("float and bool setters are wrapped in try/catch and tally their param id", () => {
    expect(s).toContain('try ( lmSun.turbidity = 6; append lmOk "sun.turbidity" ) catch ( append lmFail "sun.turbidity" )');
    expect(s).toContain('try ( lmSun.enabled = true; append lmOk "sun.enabled" ) catch ( append lmFail "sun.enabled" )');
    expect(s).toContain('try ( lmCam.ISO = 200; append lmOk "cam.iso" ) catch ( append lmFail "cam.iso" )');
  });

  it("the renderer enum (colorMapping_type) is try/catch'd INSIDE the V-Ray guard", () => {
    expect(s).toContain('try ( renderers.current.colorMapping_type = 6; append lmOk "cm.type" ) catch ( append lmFail "cm.type" )');
    // non-V-Ray current renderer records a miss, not an error
    expect(s).toContain(') else ( append lmFail "cm.type" )');
  });

  it("REGRESSION: no setter is ever emitted BARE (the crash pattern) — every assignment line is inside a try", () => {
    const bareSetters = s
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[A-Za-z].*\.\w+ = /.test(l) || /^renderers\.current\.\w+ = /.test(l))
      // a bare setter line does not begin with "try (" and is not a local decl
      .filter((l) => !l.startsWith("try (") && !l.startsWith("local "));
    expect(bareSetters).toEqual([]);
    // specifically, the colorMapping_type assignment never appears outside a try
    const bareCm = s.split("\n").some((l) => /renderers\.current\.colorMapping_type = 6/.test(l) && !/try \(/.test(l));
    expect(bareCm).toBe(false);
  });

  it("still degrades a non-V-Ray target to a fully-commented (no-exec) script", () => {
    const v = toMaxScript(recipe, "vantage33");
    expect(v).not.toContain("try (");
    expect(v).toContain("SET MANUALLY");
  });
});
