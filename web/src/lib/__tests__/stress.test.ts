// STRESS TEST — adversarial fuzz of the 99%-match pipeline.
// Diagnostic only: asserts NOTHING, prints everything. Runs as part of `vitest`.
// Covers: scoreVectors determinism + MATCH_THRESHOLD boundary stability +
// buildUserContent convergence-block resilience + key-drift guard + engine under load.
import { describe, it } from "vitest";
import {
  scoreVectors,
  matchPercent,
  MATCH_THRESHOLD,
  SCORE_SATURATION,
  SCORE_WEIGHTS,
  measureFromPixels,
} from "../metrics";
import type { MetricVector } from "../types";
import { buildUserContent } from "../client-adapter";

// --- PRNG (mulberry32) so the suite is reproducible across runs ---
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x99_FF_57_ED);
const N = 2000; // total random vectors per pass
const VALID_KEYS = Object.keys(SCORE_WEIGHTS);

function randM(seed = 0): MetricVector {
  const r = mulberry32((Date.now() & 0xffff) ^ (seed * 0x9e3779b1));
  const lum = {
    p1: r(), p5: r(), p25: r(), p50: r(), p75: r(), p95: r(), p99: r(), mean: r(),
  };
  const clip = { hi: r() * 0.1, lo: r() * 0.1 };
  const contrast = { spread: r() * 0.9 + 0.1, midSlope: r() * 2 };
  const wb = {
    shadow: { r: r(), g: r(), b: r() },
    highlight: { r: r(), g: r(), b: r() },
    warmthShadow: r() * 0.4 - 0.2,
    warmthHighlight: r() * 0.4 - 0.2,
    tint: r() * 0.1 - 0.05,
  };
  const sat = { mean: r() * 0.6, p95: r() * 0.9 };
  const grid = Array.from({ length: 16 }, () => r());
  return { lum, clip, contrast, wb, sat, grid };
}

// === 1) determinism ==========================================================
describe("stress: determinism under noise", () => {
  it(`${N} random vectors: scoreVectors(m, m) === 0`, () => {
    let zero = 0, nonZero = 0, maxAbs = 0;
    for (let i = 0; i < N; i++) {
      const m = randM(i);
      const s = scoreVectors(m, m);
      if (s === 0) zero++; else nonZero++;
      if (Math.abs(s) > maxAbs) maxAbs = Math.abs(s);
    }
    console.log(`  scoreVectors(m, m): zero=${zero}/${N}, nonZero=${nonZero}, maxAbs=${maxAbs}`);
  });

  it(`${N} reps: identical input => identical float (no Date.now / Math.random leak)`, () => {
    const m = randM(42);
    const first = scoreVectors(m, m);
    let drift = 0;
    for (let i = 0; i < N; i++) {
      const s = scoreVectors(m, m);
      if (s !== first) drift++;
    }
    console.log(`  same input x${N}: drift=${drift} (must be 0)`);
  });

  it(`${N} random vector pairs: score[0..100] invariant (no NaN, no Infinity, monotonic in d)`, () => {
    let nan = 0, inf = 0, sat = 0, inBand = 0;
    let sumScore = 0;
    let minScore = Infinity, maxScore = -Infinity;
    for (let i = 0; i < N; i++) {
      const a = randM(i * 2);
      const b = randM(i * 2 + 1);
      const s = scoreVectors(a, b);
      if (Number.isNaN(s)) nan++;
      if (!Number.isFinite(s)) inf++;
      if (s >= 100) sat++;
      if (s >= 0 && s <= 100) inBand++;
      sumScore += s;
      if (s < minScore) minScore = s;
      if (s > maxScore) maxScore = s;
    }
    console.log(`  scoreVectors random pairs: NaN=${nan} Inf=${inf} saturated(${(SCORE_SATURATION * 100).toFixed(0)})=${sat} in[0..100]=${inBand}/${N}`);
    console.log(`  mean=${(sumScore / N).toFixed(3)} min=${minScore.toFixed(4)} max=${maxScore.toFixed(4)}`);
  });
});

// === 2) MATCH_THRESHOLD boundary stability ====================================
describe("stress: MATCH_THRESHOLD gate stability", () => {
  it("501 floats sweeping the 0..5 gate region: max adjacent % jump <= 1", () => {
    let maxJump = 0, jumpAt = 0;
    const bands = new Map<number, number>();
    for (let i = 0; i <= 500; i++) {
      const s = i * 0.01;
      const p = matchPercent(s);
      bands.set(p, (bands.get(p) ?? 0) + 1);
    }
    let prev = matchPercent(0);
    for (let i = 1; i <= 500; i++) {
      const s = i * 0.01;
      const p = matchPercent(s);
      const jump = prev - p;
      if (jump > maxJump) {
        maxJump = jump;
        jumpAt = s;
      }
      prev = p;
    }
    const matchedBand = bands.get(matchPercent(MATCH_THRESHOLD)) || 0;
    console.log(`  biggest %% jump between adjacent 0.01-floats: ${maxJump}%% (at score=${jumpAt.toFixed(2)})`);
    console.log(`  %% of inputs in matched (>=${matchPercent(MATCH_THRESHOLD)}%%) band: ${matchedBand}/501`);
  });

  it("fuzz 1k random scores: every score returns a number in [0, 100]", () => {
    let neg = 0, over = 0, ok = 0;
    for (let i = 0; i < 1000; i++) {
      const s = rand() * 200 - 50;
      const p = matchPercent(s);
      if (p < 0) neg++;
      else if (p > 100) over++;
      else ok++;
    }
    console.log(`  random scores (-50..150): out-of-band neg=${neg} over=${over} ok=${ok}/1000`);
  });

  it("scoreVectors(ref, attempt) raises score when shifting lum.p50 by +0.05", () => {
    const ref = randM(7);
    let raised = 0;
    for (let i = 0; i < 200; i++) {
      const d = randM(i);
      const s1 = scoreVectors(ref, d);
      const shifted = { ...d, lum: { ...d.lum, p50: d.lum.p50 + 0.05 } } as MetricVector;
      const sShift = scoreVectors(ref, shifted);
      if (sShift > s1) raised++;
    }
    console.log(`  shift-by-lum.p50+0.05 raises score: ${raised}/200 trials`);
  });
});

// === 3) buildUserContent convergence-block resilience =======================
describe("stress: convergence block adversarial inputs", () => {
  const minimalImg = {
    role: "reference",
    dataUrl: "data:image/png;base64,AAAA",
    mediaType: "image/png",
  };

  it("NaN / Infinity / null in prevDiff -> emit skipped, never crash", () => {
    let survived = 0;
    const cases = [
      { prevDiff: { "lum.p5": NaN }, diff: { "lum.p5": 0.01 } },
      { prevDiff: { "lum.p5": Infinity }, diff: { "lum.p5": 0.01 } },
      { prevDiff: { "lum.p5": -Infinity }, diff: { "lum.p5": 0.01 } },
      { prevDiff: null, diff: { "lum.p5": 0.01 } },
      { prevDiff: undefined, diff: { "lum.p5": 0.01 } },
      { prevDiff: "string-not-object" as unknown, diff: { "lum.p5": 0.01 } },
      { prevDiff: 42 as unknown, diff: { "lum.p5": 0.01 } },
      { prevDiff: [], diff: { "lum.p5": 0.01 } },
      { prevDiff: { "lum.p5": 0 }, diff: { "lum.p5": 0 } },
    ];
    for (const c of cases) {
      try {
        const blocks = buildUserContent({
          mode: "correction",
          images: [minimalImg],
          metricsBundle: c,
        } as never);
        survived++;
        const joined = blocks
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("\n");
        if (joined.includes("NaN") || joined.includes("Infinity")) {
          console.log(`    WARN: input leaked NaN/Infinity into CONVERGENCE: ${JSON.stringify(c)}`);
        }
      } catch (e) {
        console.log(`    CRASH on: ${JSON.stringify(c)} -> ${(e as Error).message}`);
      }
    }
    console.log(`  survived ${survived}/${cases.length} adversarial prevDiff cases`);
  });

  it("extra keys in prevDiff not in diff -> silently ignored, no crash", () => {
    const blocks = buildUserContent({
      mode: "correction",
      images: [minimalImg],
      metricsBundle: {
        diff: { "lum.p5": 0.01 },
        prevDiff: { "lum.p5": 0.05, "nonsense.key": 0.5, "another.fake": 0.7 },
      },
    } as never);
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .find((t) => t.startsWith("CONVERGENCE")) || "";
    console.log(`  CONVERGENCE block: ${text.slice(0, 80)}...`);
    console.log(`  extra keys ignored: ${!text.includes("nonsense") && !text.includes("another.fake")}`);
  });

  it("1k random prevDiff/diff pairs: no throw, no NaN in output", () => {
    let throwed = 0, nanLines = 0;
    for (let i = 0; i < 1000; i++) {
      const keys = VALID_KEYS.slice(0, 5 + (i % 15));
      const diff: Record<string, number> = {};
      const prevDiff: Record<string, number> = {};
      for (const k of keys) {
        diff[k] = rand() * 2 - 1;
        prevDiff[k] = rand() * 2 - 1;
      }
      try {
        const blocks = buildUserContent({
          mode: "correction",
          images: [minimalImg],
          metricsBundle: { diff, prevDiff },
        } as never);
        const text = blocks
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("\n");
        if (text.includes("NaN") || text.includes("Infinity")) nanLines++;
      } catch {
        throwed++;
      }
    }
    console.log(`  1k random pairs: throws=${throwed}, NaN/Infinity leakage=${nanLines}`);
  });
});

// === 4) round-trip determinism: full engine ===================================
describe("stress: engine seedReady -> addAttempt chains", () => {
  it("1000 attempted corrections, all scores finite, no engine-state corruption", async () => {
    const { engineStore } = await import("@/store/useEngine");
    const { STORE } = await import("@/lib/store");
    const { vi } = await import("vitest");

    STORE._useDb("lightmatch-stress-" + Math.random().toString(36).slice(2));
    engineStore.getState().reset();
    engineStore.setState({
      _analyze: vi.fn(async () => ({
        baseline: "factory_defaults",
        hdri_mood: "x",
        values: [
          { param: "sun.intensity_mult", set: 1.0 + rand(), from: 1.0, step: 2, confidence: "high", why: "s" },
        ],
        rationale: "r",
        gi_notes: "g",
        status: "continue",
      })) as never,
    });

    const m = measureFromPixels(new Uint8ClampedArray(16 * 16 * 4), 16, 16);
    let scores: number[] = [];
    let threw = 0;

    await engineStore.getState().setImage("ref", { dataUrl: "data:image/png;base64,AAAA", metrics: m });
    await engineStore.getState().setImage("base", { dataUrl: "data:image/png;base64,BBBB", metrics: m });
    await engineStore.getState().analyze();

    // CORRECTION stub: addAttemptImpl iterates `correction.moves`, NOT `values`.
    engineStore.setState({
      _analyze: vi.fn(async () => ({
        moves: [
          { param: "sun.intensity_mult", to: 1.0 + rand() * 0.1, from: 1.1, step: 2, confidence: "high", why: "trim" },
        ],
        rationale: "r",
        status: "continue",
        status_reason: "closer",
        applied_assumed: true,
      })) as never,
    });

    for (let i = 0; i < 1000; i++) {
      try {
        const { score } = await engineStore.getState().addAttempt({
          dataUrl: "data:image/png;base64,CCCC",
          metrics: m,
        });
        if (!Number.isFinite(score)) {
          console.log(`  trial ${i}: non-finite score ${score}`);
        }
        scores.push(score);
      } catch (e) {
        threw++;
      }
    }
    const finite = scores.filter(Number.isFinite).length;
    const minS = Math.min(...scores);
    const maxS = Math.max(...scores);
    console.log(`  1000 attempts: throws=${threw}, finite=${finite}/1000, score range [${minS.toFixed(3)}, ${maxS.toFixed(3)}]`);
  });

  it("FIFO cap at 8 holds under 50 rapid attempts; _attemptCount keeps climbing", async () => {
    const { engineStore } = await import("@/store/useEngine");
    const { STORE } = await import("@/lib/store");
    const { vi } = await import("vitest");

    STORE._useDb("lightmatch-fifo-stress-" + Math.random().toString(36).slice(2));
    engineStore.getState().reset();
    engineStore.setState({
      _analyze: vi
        .fn()
        .mockImplementationOnce(async () => ({
          baseline: "factory_defaults",
          hdri_mood: "x",
          values: [{ param: "sun.intensity_mult", set: 1.1, from: 1.0, step: 2, confidence: "high", why: "s" }],
          rationale: "r",
          gi_notes: "g",
          status: "continue",
        }))
        .mockImplementation(async () => ({
          moves: [{ param: "sun.intensity_mult", to: 1.05, from: 1.1, step: 2, confidence: "high", why: "trim" }],
          rationale: "r",
          status: "continue",
          status_reason: "closer",
          applied_assumed: true,
        })) as never,
    });

    const m = measureFromPixels(new Uint8ClampedArray(16 * 16 * 4), 16, 16);
    await engineStore.getState().setImage("ref", { dataUrl: "data:image/png;base64,AAAA", metrics: m });
    await engineStore.getState().setImage("base", { dataUrl: "data:image/png;base64,BBBB", metrics: m });
    await engineStore.getState().analyze();
    for (let i = 0; i < 50; i++) {
      await engineStore.getState().addAttempt({ dataUrl: "data:image/png;base64,CCCC", metrics: m });
    }
    const chain = engineStore.getState().activeChain()!;
    console.log(`  attempts stored=${chain.attempts.length} (cap=8), _attemptCount=${chain._attemptCount}`);
    console.log(`  evicted scores retained=${chain._evictedScores?.length || 0}`);
  });
});
