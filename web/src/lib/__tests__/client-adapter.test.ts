// Client-adapter tests: pure content-assembly (buildUserContent). Networking is mocked
// at the engine-store layer; this surface exercises the prompt the model actually reads —
// the prompt is the contract, not the JSON we put in front of the wire.
import { describe, it, expect } from "vitest";
import { buildUserContent } from "../client-adapter";
import type { ContentBlock } from "../client-adapter";

// -- tiny predicate helpers -----------------------------------------------------
function textBlocks(blocks: ContentBlock[]): string[] {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text);
}
function hasLine(blocks: ContentBlock[], marker: string): boolean {
  return textBlocks(blocks).some((t) => t.includes(marker));
}

// =============================================================================
// Convergence feedback (the "values feel random" / "can't reach 99%" fix).
// =============================================================================
describe("buildUserContent — convergence feedback", () => {
  const minimalImg = {
    role: "reference",
    dataUrl: "data:image/png;base64,AAAA",
    mediaType: "image/png",
  };
  // Non-zero diffs so the gate "abs(delta) < 1e-4" doesn't suppress them.
  const diff = {
    "lum.p5": 0.02,
    "lum.p50": 0.05,
    "lum.p95": 0.03,
    "wb.tint": -0.01,
    "wb.warmthHighlight": 0.04,
  };

  it("emits a CONVERGENCE block in correction mode when prevDiff is supplied", () => {
    const prevDiff = {
      "lum.p5": 0.1,
      "lum.p50": 0.2,
      "lum.p95": 0.15,
      "wb.tint": -0.05,
      "wb.warmthHighlight": 0.1,
    };
    const blocks = buildUserContent({
      mode: "correction",
      images: [minimalImg],
      metricsBundle: { diff, prevDiff },
    } as never);
    expect(hasLine(blocks, "CONVERGENCE")).toBe(true);
    const text = textBlocks(blocks).find((t) => t.startsWith("CONVERGENCE")) ?? "";
    // delta = prev - curr; for lum.p5: 0.10 - 0.02 = 0.08 (closed the gap)
    expect(text).toMatch(/lum\.p5: 0\.08/);
    expect(text).toMatch(/lum\.p50: 0\.15/);
  });

  it("does NOT emit a CONVERGENCE block in recipe mode (no iteration yet)", () => {
    const blocks = buildUserContent({
      mode: "recipe",
      images: [minimalImg],
      metricsBundle: { diff, prevDiff: diff },
    } as never);
    expect(hasLine(blocks, "CONVERGENCE")).toBe(false);
  });

  it("does NOT emit a CONVERGENCE block on round 1 of correction (no prevDiff)", () => {
    const blocks = buildUserContent({
      mode: "correction",
      images: [minimalImg],
      metricsBundle: { diff },
    } as never);
    expect(hasLine(blocks, "CONVERGENCE")).toBe(false);
  });

  it("suppresses CONVERGENCE when every per-key delta is below numerical noise (1e-4)", () => {
    // A near-99% match: prevDiff ≈ currDiff → deltas all ~0.
    const blocks = buildUserContent({
      mode: "correction",
      images: [minimalImg],
      metricsBundle: { diff, prevDiff: diff }, // identical -> deltas all 0
    } as never);
    expect(hasLine(blocks, "CONVERGENCE")).toBe(false);
  });

  it("skip-but-emit mix: keys with non-zero delta survive, keys at zero are dropped", () => {
    const prevDiff = {
      "lum.p5": 0.1, // closes 0.08
      "lum.p50": 0.050000001, // delta ~1e-9, below 1e-4 -> DROPPED
      "lum.p95": 0.0299, // closes ~0 (below threshold)
      "wb.tint": -0.03, // worsens by 0.02 (negative delta)
    };
    const blocks = buildUserContent({
      mode: "correction",
      images: [minimalImg],
      metricsBundle: { diff, prevDiff },
    } as never);
    const text = textBlocks(blocks).find((t) => t.startsWith("CONVERGENCE")) ?? "";
    expect(text).toMatch(/lum\.p5: 0\.08/);
    expect(text).toMatch(/wb\.tint: -0\.02/); // negative = WORSENED -> model should reverse
    expect(text).not.toMatch(/lum\.p50/); // dropped (subthreshold)
    expect(text).not.toMatch(/lum\.p95/); // dropped (subthreshold)
  });
});
