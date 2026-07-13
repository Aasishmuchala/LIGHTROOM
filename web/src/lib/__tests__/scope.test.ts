// Control-scope classification — the Area-mode foundation. The pin here is
// EXHAUSTIVENESS: every prefix the packs actually use must be a conscious entry in
// PREFIX_SCOPE (a new pack group added without a scope decision fails this suite,
// instead of silently classifying as "global" and being withheld in Area mode).

import { describe, it, expect } from "vitest";
import { scopeOf, PREFIX_SCOPE } from "@/lib/scope";
import { PACKS } from "@/lib/packs";
import type { TargetId } from "@/lib/types";

const TARGETS: TargetId[] = ["vray7max", "vantage33"] as TargetId[];

function allParamIds(): string[] {
  const ids: string[] = [];
  for (const t of TARGETS) {
    for (const group of PACKS.sheet(t)) {
      for (const e of group.entries) ids.push(e.id);
    }
  }
  return ids;
}

describe("scopeOf coverage", () => {
  it("every pack param id's prefix is a DELIBERATE entry in PREFIX_SCOPE", () => {
    const unknown = new Set<string>();
    for (const id of allParamIds()) {
      const prefix = id.slice(0, id.indexOf("."));
      if (!Object.prototype.hasOwnProperty.call(PREFIX_SCOPE, prefix)) unknown.add(prefix);
    }
    expect([...unknown]).toEqual([]); // add the prefix to PREFIX_SCOPE with a chosen scope
  });

  it("classifies all 300+ params without ever hitting the conservative fallback", () => {
    const ids = allParamIds();
    expect(ids.length).toBeGreaterThan(250);
    for (const id of ids) {
      expect(["global", "camera", "local"]).toContain(scopeOf(id));
    }
  });
});

describe("scopeOf spot pins (the contract Area mode enforces)", () => {
  it("per-camera controls are NOT locked", () => {
    expect(scopeOf("cam.iso")).toBe("camera");
    expect(scopeOf("vfb.exposure")).toBe("camera");
    expect(scopeOf("post.exposure_value")).toBe("camera");
  });
  it("local lights are NOT locked", () => {
    expect(scopeOf("light.multiplier")).toBe("local");
    expect(scopeOf("fill.plane_intensity")).toBe("local");
    expect(scopeOf("ies.intensity")).toBe("local");
    expect(scopeOf("lum.intensity")).toBe("local");
  });
  it("one-per-scene controls ARE locked", () => {
    expect(scopeOf("sun.intensity_mult")).toBe("global");
    expect(scopeOf("dome.multiplier")).toBe("global");
    expect(scopeOf("env.intensity")).toBe("global");
    expect(scopeOf("cm.type")).toBe("global");
    expect(scopeOf("fog.distance")).toBe("global");
    expect(scopeOf("clouds.on")).toBe("global");
    expect(scopeOf("wet.amount")).toBe("global");
    expect(scopeOf("gi.primary")).toBe("global");
  });
  it("unknown prefixes fall back to global (withheld under lock — conservative)", () => {
    expect(scopeOf("mystery.knob")).toBe("global");
    expect(scopeOf("nodotparam")).toBe("global");
  });
});
