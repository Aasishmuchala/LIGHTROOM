// chat-digest — sessionDigest() folds live session state into a deterministic block,
// checkinEvidence() measures a dropped render vs the reference. Both PURE.

import { describe, it, expect } from "vitest";
import { sessionDigest, checkinEvidence, DIGEST_MOVES_CAP } from "@/lib/chat-digest";
import { MATCH_THRESHOLD } from "@/lib/metrics";
import type { MetricVector } from "@/lib/types";

function mv(bias = 0): MetricVector {
  return {
    lum: { p1: 0.01 + bias, p5: 0.05 + bias, p25: 0.25 + bias, p50: 0.5 + bias, p75: 0.75 + bias, p95: 0.95, p99: 0.99, mean: 0.5 + bias },
    clip: { hi: 0.02, lo: 0.02 },
    contrast: { spread: 0.9, midSlope: 1.0 },
    wb: { shadow: { r: 0.1, g: 0.1, b: 0.1 }, highlight: { r: 0.8, g: 0.8, b: 0.8 }, warmthShadow: 0, warmthHighlight: 0, tint: 0 },
    sat: { mean: 0.2, p95: 0.4 },
    grid: new Array(16).fill(0.5),
  };
}

describe("sessionDigest", () => {
  it("reports the no-session case without throwing", () => {
    expect(sessionDigest(null)).toMatch(/no session/i);
    expect(sessionDigest(undefined)).toMatch(/no session/i);
  });

  it("names the target, stage, and context chips", () => {
    const d = sessionDigest({
      activeTarget: "vray7max",
      ref: {},
      base: {},
      context: { scene: "interior", time: "golden hour", rig: "sun" },
      chains: { vray7max: { recipe: null, attempts: [] } },
    });
    expect(d).toMatch(/vray7max/);
    expect(d).toMatch(/ready/i);
    expect(d).toMatch(/interior/);
    expect(d).toMatch(/golden hour/);
  });

  it("lists recipe moves by ui_path and marks skipped ones, capping the list", () => {
    const values = Array.from({ length: DIGEST_MOVES_CAP + 5 }, (_, i) => ({
      param: "sun.intensity_mult",
      from: 1,
      set: 1 + i / 10,
      step: 2,
    }));
    const d = sessionDigest({
      activeTarget: "vray7max",
      ref: {},
      base: {},
      chains: {
        vray7max: {
          recipe: { values, baseline: "factory_defaults" },
          attempts: [],
          recipeApplied: { "sun.intensity_mult": false },
        },
      },
    });
    expect(d).toMatch(/user skipped/);
    expect(d).toMatch(/and \d+ more move/); // cap applied
  });

  it("summarizes attempt scores + the match gate percentage", () => {
    const d = sessionDigest({
      activeTarget: "vray7max",
      ref: {},
      base: {},
      chains: {
        vray7max: {
          recipe: { values: [{ param: "sun.intensity_mult", from: 1, set: 1.2 }] },
          attempts: [{ score: 12 }, { score: 4 }],
          _attemptCount: 2,
        },
      },
    });
    expect(d).toMatch(/attempts:/);
    expect(d).toMatch(/best/);
    expect(d).toMatch(new RegExp(`${100 - MATCH_THRESHOLD}%`)); // gate percentage
  });

  it("never throws on a malformed/older chain missing fields", () => {
    expect(() =>
      sessionDigest({
        activeTarget: "vantage33",
        ref: {},
        base: {},
        chains: { vantage33: undefined },
      })
    ).not.toThrow();
  });
});

describe("checkinEvidence", () => {
  it("identical images score 0 / 100% / matched, with an evidence text block", () => {
    const e = checkinEvidence(mv(0), mv(0));
    expect(e.score).toBe(0);
    expect(e.matchPercent).toBe(100);
    expect(e.matched).toBe(true);
    expect(e.text).toMatch(/CHECK-IN EVIDENCE/);
    expect(e.text).toMatch(/MATCHED/);
  });

  it("a divergent render is not matched and carries the diff evidence", () => {
    const e = checkinEvidence(mv(0), mv(0.3));
    expect(e.score).toBeGreaterThan(MATCH_THRESHOLD);
    expect(e.matched).toBe(false);
    expect(e.matchPercent).toBeLessThan(100);
    expect(e.text).toMatch(/"diff"/);
  });

  it("matchPercent stays within 0..100 for an extreme mismatch", () => {
    const e = checkinEvidence(mv(0), mv(0.9));
    expect(e.matchPercent).toBeGreaterThanOrEqual(0);
    expect(e.matchPercent).toBeLessThanOrEqual(100);
  });
});
