import { describe, it, expect } from "vitest";
import { PACKS } from "../packs";
import type { TargetId, PackEntry } from "../types";

const REQUIRED_FIELDS: (keyof PackEntry)[] = [
  "id",
  "ui_path",
  "group",
  "kind",
  "unit",
  "range",
  "default",
  "lighting",
  "verified",
  "notes",
];

describe("PACKS load + structure", () => {
  it("exposes both targets", () => {
    expect(PACKS.targets()).toEqual(["vray7max", "vantage33"]);
    expect(PACKS.vray7max).toBeTruthy();
    expect(PACKS.vantage33).toBeTruthy();
  });

  it("entry counts match the source (vray7max=159, vantage33=144)", () => {
    expect(PACKS.vray7max.entries).toHaveLength(159);
    expect(PACKS.vantage33.entries).toHaveLength(144);
  });

  for (const target of ["vray7max", "vantage33"] as TargetId[]) {
    describe(`pack ${target}`, () => {
      const entries = PACKS[target].entries;

      it("has unique ids", () => {
        const ids = entries.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("every entry has all 10 fields, non-empty group, boolean lighting", () => {
        for (const e of entries) {
          for (const f of REQUIRED_FIELDS) {
            expect(e, `${e.id} missing ${String(f)}`).toHaveProperty(f as string);
          }
          expect(typeof e.group).toBe("string");
          expect(e.group.length).toBeGreaterThan(0);
          expect(typeof e.lighting).toBe("boolean");
        }
      });

      it("range[0] <= range[1] for every entry", () => {
        for (const e of entries) {
          expect(e.range[0], `${e.id} range`).toBeLessThanOrEqual(e.range[1]);
        }
      });

      it("numeric defaults lie within a real range", () => {
        for (const e of entries) {
          if (typeof e.default === "number" && e.range[0] < e.range[1]) {
            expect(e.default, `${e.id} default in range`).toBeGreaterThanOrEqual(e.range[0]);
            expect(e.default, `${e.id} default in range`).toBeLessThanOrEqual(e.range[1]);
          }
        }
      });
    });
  }
});

describe("PACKS.lookup", () => {
  it("finds a known entry and returns null for an unknown id / target", () => {
    expect(PACKS.lookup("vray7max", "sun.turbidity")?.id).toBe("sun.turbidity");
    expect(PACKS.lookup("vray7max", "does.not.exist")).toBeNull();
    expect(PACKS.lookup("nope", "sun.turbidity")).toBeNull();
  });
});

describe("PACKS.clamp clamps and flags", () => {
  it("clamps an over-range numeric and sets clamped:true", () => {
    // sun.turbidity range is [2, 20]
    expect(PACKS.clamp("vray7max", "sun.turbidity", 40000)).toEqual({ value: 20, clamped: true });
    expect(PACKS.clamp("vray7max", "sun.turbidity", -5)).toEqual({ value: 2, clamped: true });
  });

  it("leaves an in-range numeric untouched (clamped:false)", () => {
    expect(PACKS.clamp("vray7max", "sun.turbidity", 8)).toEqual({ value: 8, clamped: false });
  });

  it("passes strings and no-range kinds through unflagged", () => {
    // sun.enabled is a checkbox with range [0,0] -> no clamping
    expect(PACKS.clamp("vray7max", "sun.enabled", "off")).toEqual({ value: "off", clamped: false });
    expect(PACKS.clamp("vray7max", "sun.turbidity", "warm")).toEqual({ value: "warm", clamped: false });
  });
});

describe("PACKS.promptFragment filters lighting:true", () => {
  it("emits exactly one line per lighting:true entry, plus a header", () => {
    const frag = PACKS.promptFragment("vray7max");
    const litCount = PACKS.vray7max.entries.filter((e) => e.lighting === true).length;
    const lines = frag.split("\n");
    // header line + one per lighting-true entry
    expect(lines.length).toBe(litCount + 1);
    expect(lines[0]).toContain("TARGET: V-Ray 7 for 3ds Max");
    // no display-only (lighting:false) id should appear
    const seedEntry = PACKS.vray7max.entries.find((e) => e.id === "clouds.seed");
    expect(seedEntry?.lighting).toBe(false);
    expect(frag).not.toContain("clouds.seed —");
  });

  it("returns empty string for an unknown target", () => {
    expect(PACKS.promptFragment("nope")).toBe("");
  });
});

describe("PACKS.sheet covers every control in panel order", () => {
  for (const target of ["vray7max", "vantage33"] as TargetId[]) {
    it(`${target}: every entry appears exactly once, grouped in panel order`, () => {
      const sheet = PACKS.sheet(target);
      const flat = sheet.flatMap((g) => g.entries);
      const packIds = PACKS[target].entries.map((e) => e.id);
      // full coverage: every pack entry appears exactly once (as a SET — the sheet
      // consolidates non-adjacent same-group entries, so flat order need not equal
      // pack order, but the membership must be identical with no drops/dupes).
      expect(flat).toHaveLength(packIds.length);
      expect(new Set(flat.map((e) => e.id))).toEqual(new Set(packIds));
      // groups are unique and returned in first-seen (panel) order.
      const groups = sheet.map((g) => g.group);
      expect(new Set(groups).size).toBe(groups.length);
      const firstSeen: string[] = [];
      for (const e of PACKS[target].entries) if (!firstSeen.includes(e.group)) firstSeen.push(e.group);
      expect(groups).toEqual(firstSeen);
      // within each group, entries keep their relative pack order.
      for (const g of sheet) {
        const expectedOrder = PACKS[target].entries.filter((e) => e.group === g.group).map((e) => e.id);
        expect(g.entries.map((e) => e.id)).toEqual(expectedOrder);
      }
    });
  }

  it("returns [] for an unknown target", () => {
    expect(PACKS.sheet("nope")).toEqual([]);
  });
});

describe("specific corrections hold (regression guards)", () => {
  it("vray sun.turbidity default is 2.5", () => {
    expect(PACKS.lookup("vray7max", "sun.turbidity")?.default).toBe(2.5);
  });
  it("vray light.multiplier default is 30", () => {
    expect(PACKS.lookup("vray7max", "light.multiplier")?.default).toBe(30.0);
  });
  it("vantage sun.intensity default is 0.033", () => {
    expect(PACKS.lookup("vantage33", "sun.intensity")?.default).toBe(0.033);
  });
});
