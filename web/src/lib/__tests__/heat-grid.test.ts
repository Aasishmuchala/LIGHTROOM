// Refine-ledger DIFF HEATMAP — pins for the pure gridHeatCells helper that maps the
// attempt-vs-reference 4x4 luminance grids (MetricVector.grid) to signed overlay
// tints. Contract under test (diff = attempt - ref):
//   sign :  1 attempt BRIGHTER than ref, -1 darker, 0 within noise (|diff| <
//           HEAT_NOISE_FLOOR) — the renderer draws sign-0 cells fully transparent;
//   mag  : min(1, |diff| / HEAT_FULL_DELTA) — a 0.15 delta saturates the tint;
//   safety: non-array inputs or mismatched lengths -> [] (older persisted sessions
//           may lack .grid entirely), non-finite entries -> neutral cell. Never throws.

import { describe, it, expect } from "vitest";
import {
  gridHeatCells,
  HEAT_FULL_DELTA,
  HEAT_NOISE_FLOOR,
  HEAT_ALPHA_MAX,
} from "@/components/lib";
import { measureFromPixels } from "../metrics";

// -- synthetic RGBA buffer helper (same pattern as metrics.test.ts) ----------------
/** Solid fill of (r,g,b), w*h pixels, alpha 255. */
function solid(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  }
  return data;
}

// ---------------------------------------------------------------------------------
// Signs: brighter attempt -> 1 (amber), darker -> -1 (blue), identical -> 0.
// ---------------------------------------------------------------------------------
describe("gridHeatCells — signs", () => {
  it("attempt brighter than ref reads sign 1, darker -1, identical 0", () => {
    const ref = [0.5, 0.5, 0.5];
    const att = [0.7, 0.3, 0.5];
    const cells = gridHeatCells(ref, att);
    expect(cells.map((c) => c.sign)).toEqual([1, -1, 0]);
  });

  it("output length mirrors the (equal) input length — one cell per grid cell", () => {
    const ref = new Array(16).fill(0.4);
    const att = new Array(16).fill(0.6);
    const cells = gridHeatCells(ref, att);
    expect(cells).toHaveLength(16);
    for (const c of cells) expect(c.sign).toBe(1);
  });
});

// ---------------------------------------------------------------------------------
// Magnitudes: linear in |diff| up to HEAT_FULL_DELTA (0.15), then clamped to 1.
// ---------------------------------------------------------------------------------
describe("gridHeatCells — magnitudes", () => {
  it("half of HEAT_FULL_DELTA reads mag 0.5; the full delta reads exactly 1", () => {
    const cells = gridHeatCells([0.4, 0.4], [0.4 + HEAT_FULL_DELTA / 2, 0.4 + HEAT_FULL_DELTA]);
    expect(cells[0].mag).toBeCloseTo(0.5, 10);
    expect(cells[1].mag).toBe(1);
  });

  it("deltas past the full-intensity point clamp to 1 (never overshoot the alpha)", () => {
    const cells = gridHeatCells([0.05, 0.95], [0.95, 0.05]); // ±0.9 — way past 0.15
    expect(cells[0]).toEqual({ sign: 1, mag: 1 });
    expect(cells[1]).toEqual({ sign: -1, mag: 1 });
  });

  it("magnitude is symmetric: brighter and darker by the same delta share a mag", () => {
    const cells = gridHeatCells([0.5, 0.5], [0.56, 0.44]); // ±0.06
    expect(cells[0].sign).toBe(1);
    expect(cells[1].sign).toBe(-1);
    expect(cells[0].mag).toBeCloseTo(cells[1].mag, 10);
    expect(cells[0].mag).toBeCloseTo(0.06 / HEAT_FULL_DELTA, 10);
  });

  it("mag * HEAT_ALPHA_MAX (the rendered alpha) stays within [0, HEAT_ALPHA_MAX]", () => {
    const ref = [0, 0.2, 0.5, 1];
    const att = [1, 0.21, 0.5, 0];
    for (const c of gridHeatCells(ref, att)) {
      const alpha = c.mag * HEAT_ALPHA_MAX;
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(HEAT_ALPHA_MAX);
    }
  });
});

// ---------------------------------------------------------------------------------
// Noise gate: |diff| < HEAT_NOISE_FLOOR (0.01) is "the same cell" -> sign 0
// (transparent), so a matched region never shimmers with faint tint.
// ---------------------------------------------------------------------------------
describe("gridHeatCells — noise gate", () => {
  it("|diff| just under the floor reads sign 0", () => {
    const cells = gridHeatCells([0.5, 0.5], [0.5 + 0.009, 0.5 - 0.009]);
    expect(cells[0].sign).toBe(0);
    expect(cells[1].sign).toBe(0);
  });

  it("|diff| exactly at the floor is SIGNED (the gate is strict `<`)", () => {
    const cells = gridHeatCells([0.5, 0.5], [0.5 + HEAT_NOISE_FLOOR, 0.5 - HEAT_NOISE_FLOOR]);
    expect(cells[0].sign).toBe(1);
    expect(cells[1].sign).toBe(-1);
  });

  it("zero diff reads {sign 0, mag 0}", () => {
    expect(gridHeatCells([0.33], [0.33])).toEqual([{ sign: 0, mag: 0 }]);
  });
});

// ---------------------------------------------------------------------------------
// Safety: bad shapes degrade to [] / neutral cells — NEVER throw. Older persisted
// sessions can lack .grid, so the component feeds this helper unguarded values.
// ---------------------------------------------------------------------------------
describe("gridHeatCells — safety on bad input", () => {
  it("mismatched array lengths -> safe empty result", () => {
    expect(gridHeatCells([0.1, 0.2, 0.3], [0.1, 0.2])).toEqual([]);
    expect(gridHeatCells([0.1], new Array(16).fill(0.5))).toEqual([]);
  });

  it("missing grids (null / undefined) -> safe empty result", () => {
    expect(gridHeatCells(null, [0.5])).toEqual([]);
    expect(gridHeatCells([0.5], undefined)).toEqual([]);
    expect(gridHeatCells(null, null)).toEqual([]);
    expect(gridHeatCells(undefined, undefined)).toEqual([]);
  });

  it("non-array junk -> safe empty result", () => {
    expect(gridHeatCells("grid" as unknown as number[], [0.5])).toEqual([]);
    expect(gridHeatCells([0.5], {} as unknown as number[])).toEqual([]);
  });

  it("non-finite entries collapse to a neutral cell (no NaN alpha downstream)", () => {
    const cells = gridHeatCells([0.5, NaN, 0.5], [Infinity, 0.5, 0.7]);
    expect(cells[0]).toEqual({ sign: 0, mag: 0 });
    expect(cells[1]).toEqual({ sign: 0, mag: 0 });
    expect(cells[2].sign).toBe(1); // healthy neighbors unaffected
  });

  it("two empty grids match lengths and yield an empty (non-rendering) result", () => {
    expect(gridHeatCells([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------
// End-to-end shape: grids produced by the REAL metrics pipeline (measureFromPixels)
// flow straight through — 16 cells, all amber when the attempt is uniformly brighter.
// ---------------------------------------------------------------------------------
describe("gridHeatCells — with measureFromPixels grids", () => {
  it("a uniformly brighter attempt lights all 16 cells amber at full intensity", () => {
    const W = 32;
    const H = 32;
    const refM = measureFromPixels(solid(W, H, 60, 60, 60), W, H);
    const attM = measureFromPixels(solid(W, H, 230, 230, 230), W, H);
    const cells = gridHeatCells(refM.grid, attM.grid);
    expect(cells).toHaveLength(16);
    for (const c of cells) expect(c).toEqual({ sign: 1, mag: 1 });
  });

  it("an identical attempt renders fully transparent (all sign 0)", () => {
    const W = 32;
    const H = 32;
    const refM = measureFromPixels(solid(W, H, 128, 128, 128), W, H);
    const attM = measureFromPixels(solid(W, H, 128, 128, 128), W, H);
    const cells = gridHeatCells(refM.grid, attM.grid);
    expect(cells).toHaveLength(16);
    for (const c of cells) expect(c.sign).toBe(0);
  });
});
