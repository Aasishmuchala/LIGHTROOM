// Export the LightMatch "brain" as data for the 3ds Max plugin repo (lightmatch-max).
// The plugin is a PYTHON port of the measurement core — everything that can drift
// (prompt prose, pack vocabulary, schemas, verified property maps) is exported HERE,
// from the canonical TS implementation, so the two repos share one source of truth:
//   packs.json    — per-target label + full sheet + promptFragment text
//   prompts.json  — systemPrompt for every (target × mode × lockGlobals) combo,
//                   the evidence legend, and the emit_recipe/emit_correction schemas
//   knownprops.json — the verified MAXScript property map + cm.type enum + scopes
//   parity.json   — synthetic RGBA buffers (base64) + the TS core's measured output
//                   for them (metrics/diff/score/evidence), so the numpy port can
//                   prove it computes the SAME numbers.
//
// Run:  npx tsx scripts/export-plugin-data.ts [outDir]   (default ../../lightmatch-max/data)

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { PACKS, promptFragment } from "../src/lib/packs";
import { systemPrompt, EMIT_RECIPE, EMIT_CORRECTION } from "../src/lib/schemas";
import { PREFIX_SCOPE } from "../src/lib/scope";
import { KNOWN_PROPS } from "../src/lib/export";
import { buildUserContent } from "../src/lib/client-adapter";
import {
  measureFromPixels,
  diffVectors,
  scoreVectors,
  wbExposureEvidence,
  sceneEvidence,
  matchPercent,
  MATCH_THRESHOLD,
  SCORE_WEIGHTS,
  HIST_BINS,
} from "../src/lib/metrics";

const OUT = resolve(process.argv[2] || resolve(__dirname, "../../../lightmatch-max/data"));
mkdirSync(OUT, { recursive: true });

const TARGETS = ["vray7max", "vantage33"] as const;

// ---------------------------------------------------------------------------------
// packs.json
// ---------------------------------------------------------------------------------
const packs: Record<string, unknown> = {};
for (const t of TARGETS) {
  const label = (PACKS as unknown as Record<string, { label: string }>)[t].label;
  packs[t] = {
    label,
    sheet: PACKS.sheet(t),
    promptFragment: promptFragment(t),
  };
}
writeFileSync(resolve(OUT, "packs.json"), JSON.stringify(packs, null, 1));

// ---------------------------------------------------------------------------------
// prompts.json — every system prompt combo + the evidence legend + emit schemas.
// The legend lives inline in buildUserContent; extract it with a marker bundle.
// ---------------------------------------------------------------------------------
const marker = "___LM_BUNDLE_MARKER___";
const markerContent = buildUserContent({
  mode: "recipe",
  images: [],
  metricsBundle: marker,
});
const legendBlock = markerContent[0];
if (legendBlock.type !== "text") throw new Error("unexpected buildUserContent shape");
const legend = legendBlock.text.slice(0, legendBlock.text.indexOf(`\n"${marker}"`));
if (!legend.includes("COMPUTED EVIDENCE")) throw new Error("legend extraction failed");

const prompts: Record<string, unknown> = {
  legend,
  emit_recipe_schema: EMIT_RECIPE.input_schema,
  emit_correction_schema: EMIT_CORRECTION.input_schema,
  system: {} as Record<string, string>,
};
for (const t of TARGETS) {
  for (const mode of ["recipe", "correction"] as const) {
    for (const lock of [false, true]) {
      (prompts.system as Record<string, string>)[`${t}.${mode}.${lock ? "locked" : "free"}`] =
        systemPrompt(t, mode, { lockGlobals: lock });
    }
  }
}
writeFileSync(resolve(OUT, "prompts.json"), JSON.stringify(prompts, null, 1));

// ---------------------------------------------------------------------------------
// knownprops.json — verified pymxs surface (same map the bridge + export trust).
// ---------------------------------------------------------------------------------
writeFileSync(
  resolve(OUT, "knownprops.json"),
  JSON.stringify(
    {
      known_props: KNOWN_PROPS,
      prefix_scope: PREFIX_SCOPE,
      match_threshold: MATCH_THRESHOLD,
      score_weights: SCORE_WEIGHTS,
      hist_bins: HIST_BINS,
    },
    null,
    1
  )
);

// ---------------------------------------------------------------------------------
// parity.json — deterministic synthetic images + the TS core's numbers for them.
// Buffers are stored as base64 RGBA so the Python side decodes EXACTLY these bytes.
// ---------------------------------------------------------------------------------
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 0xffffffff);
}
const W = 96;
const H = 64;
function makeCase(name: string, paint: (x: number, y: number, rnd: () => number) => [number, number, number, number]) {
  const rnd = lcg(1234567);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b, a] = paint(x, y, rnd);
      const p = (y * W + x) * 4;
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = a;
    }
  }
  return { name, w: W, h: H, rgba_b64: Buffer.from(data.buffer).toString("base64"), metrics: measureFromPixels(data, W, H) };
}
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const cases = [
  makeCase("warm_radial_topleft", (x, y) => {
    const d = Math.hypot(x - W * 0.25, y - H * 0.25) / (W * 0.9);
    const t = Math.max(0, 1 - d);
    return [clamp255(40 + 215 * t), clamp255(28 + 175 * t), clamp255(18 + 110 * t), 255];
  }),
  makeCase("cool_linear_topright", (x, y) => {
    const t = Math.max(0, 1 - Math.hypot(x - W * 0.8, y - H * 0.2) / (W * 0.95));
    return [clamp255(15 + 160 * t), clamp255(22 + 185 * t), clamp255(35 + 215 * t), 255];
  }),
  makeCase("flat_mid_gray", () => [128, 128, 128, 255]),
  makeCase("clipped_extremes", (x) => (x < W / 3 ? [0, 0, 0, 255] : x > (2 * W) / 3 ? [255, 255, 255, 255] : [128, 140, 120, 255])),
  makeCase("alpha_holed_gradient", (x, y, rnd) => {
    const t = x / W;
    const hole = x > W * 0.4 && x < W * 0.6 && y > H * 0.3 && y < H * 0.7;
    const noise = (rnd() - 0.5) * 12;
    return [clamp255(30 + 200 * t + noise), clamp255(35 + 160 * t + noise), clamp255(50 + 120 * t + noise), hole ? 0 : 255];
  }),
];
const pairs = [
  { ref: 0, cur: 1 },
  { ref: 0, cur: 0 }, // identical → score 0 / 100%
  { ref: 2, cur: 3 },
  { ref: 0, cur: 4 },
].map(({ ref, cur }) => {
  const a = cases[ref].metrics;
  const b = cases[cur].metrics;
  const score = scoreVectors(a, b);
  return {
    ref: cases[ref].name,
    cur: cases[cur].name,
    diff: diffVectors(b, a), // reference − current, the orientation the app ships
    score,
    match_percent: matchPercent(score),
    wb_exposure: wbExposureEvidence(a, b),
    scene: sceneEvidence(a, b),
  };
});
writeFileSync(resolve(OUT, "parity.json"), JSON.stringify({ cases, pairs }, null, 1));

console.log(`exported packs/prompts/knownprops/parity to ${OUT}`);
