// Field-feedback fixes (2026-07-05) — regression pins for the three issues the
// user hit in the first real Vantage session:
//   1. the Vantage Color-corrections sliders are −1..1 (saturation max = 1 was
//      user-confirmed in product) — the pack shipped ±100, a 100x scale mismatch;
//   2. white balance / exposure landed "way too off" — now grounded by MEASURED
//      CCT estimates (McCamy) + a measured EV gap instead of model guesswork;
//   3. the HDRI mood line now resolves to real Poly Haven assets (deterministic
//      keyword match against the live catalogue) + prefilled search links.

import { describe, it, expect } from "vitest";
import { PACKS } from "../packs";
import { validateRecipe, systemPrompt } from "../schemas";
import {
  cctFromLinearRGB,
  tintGMFromLinearRGB,
  wbExposureEvidence,
  sceneEvidence,
  measureFromPixels,
} from "../metrics";
import type { MetricVector } from "../types";
import {
  tokenizeMood,
  scoreHdriAssets,
  polyhavenSearchUrl,
  poliigonSearchUrl,
  type HdriAsset,
} from "../hdri-finder";

// ---------------------------------------------------------------------------------
// 1. Vantage Color-corrections scales. ONLY post.saturation is in-product confirmed
// (-1..1). The 2026-07-05 blocker audit + Chaos docs then corrected the earlier
// over-generalization: post.hue is DEGREES (-180..180), and lightness/balance/tint
// are inferred (range kept, but verified:false — not user-confirmed). The family is
// NOT uniform.
// ---------------------------------------------------------------------------------
describe("Vantage Color-corrections scales (family is NOT uniform)", () => {
  it("post.saturation is the CONFIRMED -1..1 (user checked the live product)", () => {
    const e = PACKS.lookup("vantage33", "post.saturation")!;
    expect(e.range).toEqual([-1, 1]);
    expect(e.verified).toBe("2026-07-05");
  });
  it("post.hue is DEGREES -180..180 (doc-confirmed), not the sibling normalized scale", () => {
    const e = PACKS.lookup("vantage33", "post.hue")!;
    expect(e.range).toEqual([-180, 180]);
    expect(e.unit).toBe("°");
  });
  it.each(["post.lightness", "post.balance_cyan_red", "post.balance_magenta_green", "post.balance_yellow_blue", "post.wb_tint"])(
    "%s keeps the inferred -1..1 but is honestly marked verified:false",
    (id) => {
      const e = PACKS.lookup("vantage33", id)!;
      expect(e.range).toEqual([-1, 1]);
      expect(e.verified).toBe(false);
    }
  );

  it("a model emitting the old ±100-scale value gets clamped into the real range", () => {
    const r = validateRecipe(
      {
        baseline: "factory_defaults", hdri_mood: "x", rationale: "r", gi_notes: "g", status: "continue",
        values: [
          { param: "post.saturation", set: 15, from: 0, step: 5, confidence: "high", why: "old-scale emit" },
          { param: "post.wb_tint", set: -40, from: 0, step: 5, confidence: "medium", why: "old-scale emit" },
        ],
      },
      "vantage33"
    );
    expect(r.ok).toBe(true);
    const [sat, tint] = r.cleaned.values as Record<string, unknown>[];
    expect(sat.set).toBe(1); // clamped to the REAL slider max the user hit
    expect(sat.clamped).toBe(true);
    expect(tint.set).toBe(-1);
    expect(tint.clamped).toBe(true);
  });

  it("the prompt offers the CONFIRMED saturation range -1..1 (not the old ±100 range token)", () => {
    const frag = PACKS.promptFragment("vantage33");
    const satLine = frag.split("\n").find((l) => l.startsWith("post.saturation — "))!;
    expect(satLine).toContain("range:[-1,1]");
    // the emitted RANGE token must not be the old ±100 (the note may still cite -100 as
    // product-comparison context, so assert on the range: token specifically)
    expect(satLine).not.toContain("range:[-100,100]");
  });
});

// ---------------------------------------------------------------------------------
// 2. Measured WB / exposure evidence.
// ---------------------------------------------------------------------------------
describe("cctFromLinearRGB — McCamy fixed points", () => {
  it("equal linear RGB (D65 white point) reads ~6500K", () => {
    const cct = cctFromLinearRGB(1, 1, 1)!;
    expect(cct).toBeGreaterThan(6300);
    expect(cct).toBeLessThan(6700);
  });
  it("a warm tungsten-ish mix reads clearly below 5000K", () => {
    const cct = cctFromLinearRGB(1.0, 0.55, 0.25)!;
    expect(cct).toBeLessThan(5000);
    expect(cct).toBeGreaterThanOrEqual(1000);
  });
  it("a cool blue-sky-ish mix reads clearly above 7000K", () => {
    const cct = cctFromLinearRGB(0.55, 0.75, 1.0)!;
    expect(cct).toBeGreaterThan(7000);
    expect(cct).toBeLessThanOrEqual(25000);
  });
  it("warmer input never reads a higher CCT than cooler input (monotone direction)", () => {
    const warm = cctFromLinearRGB(1.0, 0.7, 0.4)!;
    const neutral = cctFromLinearRGB(1, 1, 1)!;
    const cool = cctFromLinearRGB(0.6, 0.8, 1.0)!;
    expect(warm).toBeLessThan(neutral);
    expect(neutral).toBeLessThan(cool);
  });
  it("black / invalid input returns null, never NaN", () => {
    expect(cctFromLinearRGB(0, 0, 0)).toBeNull();
    expect(cctFromLinearRGB(NaN, 1, 1)).toBeNull();
    expect(cctFromLinearRGB(-1, 1, 1)).toBeNull();
  });
});

describe("tintGMFromLinearRGB — the white point's green–magenta axis", () => {
  it("neutral gray reads ~0 (on the neutral axis)", () => {
    expect(Math.abs(tintGMFromLinearRGB(0.5, 0.5, 0.5)!)).toBeLessThan(1e-9);
  });
  it("a green cast reads positive, a magenta cast negative", () => {
    expect(tintGMFromLinearRGB(0.5, 0.62, 0.5)!).toBeGreaterThan(0.02);
    expect(tintGMFromLinearRGB(0.58, 0.45, 0.58)!).toBeLessThan(-0.02);
  });
  it("is orthogonal to temperature: a pure warm (amber) mix reads ~neutral tint", () => {
    // amber = R up, B down, G in the middle — no green/magenta component.
    const t = tintGMFromLinearRGB(0.8, 0.6, 0.4)!;
    expect(Math.abs(t)).toBeLessThan(0.01);
  });
  it("black / invalid input returns null", () => {
    expect(tintGMFromLinearRGB(0, 0, 0)).toBeNull();
    expect(tintGMFromLinearRGB(NaN, 1, 1)).toBeNull();
  });
});

describe("wbExposureEvidence — the measured step-1 grounding", () => {
  const img = (w: number, h: number, px: () => [number, number, number]) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const [r, g, b] = px();
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
    return measureFromPixels(d, w, h);
  };

  it("a 2-stop brightness gap measures exposure_gap_ev ≈ +2 (positive = render too dark)", () => {
    // display-linear medians differ ~4x -> log2 = 2. Use mid tones away from clip.
    const ref = img(16, 16, () => [188, 188, 188]); // linear ~0.5
    const cur = img(16, 16, () => [99, 99, 99]); //   linear ~0.125
    const ev = wbExposureEvidence(ref, cur).exposure_gap_ev!;
    expect(ev).toBeGreaterThan(1.7);
    expect(ev).toBeLessThan(2.3);
  });

  it("a warm reference vs neutral render: reference highlight CCT reads lower (warmer)", () => {
    const ref = img(16, 16, () => [240, 190, 130]); // warm
    const cur = img(16, 16, () => [200, 200, 200]); // neutral
    const wb = wbExposureEvidence(ref, cur).wb_estimate_k;
    expect(wb.reference_highlights).not.toBeNull();
    expect(wb.current_highlights).not.toBeNull();
    expect(wb.reference_highlights!).toBeLessThan(wb.current_highlights!);
  });

  it("a green-cast render vs neutral reference: current tint_gm reads greener than the reference's", () => {
    const ref = img(16, 16, () => [200, 200, 200]); // neutral
    const cur = img(16, 16, () => [180, 215, 180]); // green cast
    const tint = wbExposureEvidence(ref, cur).tint_gm;
    expect(tint.current_highlights).not.toBeNull();
    expect(tint.current_highlights!).toBeGreaterThan(0.01);
    expect(tint.current_highlights!).toBeGreaterThan(tint.reference_highlights!);
  });

  it("black frames yield nulls, not garbage", () => {
    const black = img(8, 8, () => [0, 0, 0]);
    const ev = wbExposureEvidence(black, black);
    expect(ev.exposure_gap_ev).toBeNull();
    expect(ev.wb_estimate_k.reference_highlights).toBeNull();
    expect(ev.tint_gm.reference_highlights).toBeNull();
  });
});

describe("sceneEvidence — measured light direction, directionality, and absolute anchors", () => {
  const imgXY = (px: (x: number, y: number) => number) => {
    const W = 32, H = 32;
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = Math.max(0, Math.min(255, px(x, y)));
      const p = (y * W + x) * 4;
      d[p] = v; d[p + 1] = v; d[p + 2] = v; d[p + 3] = 255;
    }
    return measureFromPixels(d, W, H);
  };
  const leftBright = imgXY((x) => 230 - (x / 32) * 190);
  const rightBright = imgXY((x) => 40 + (x / 32) * 190);
  const bottomBright = imgXY((_x, y) => 40 + (y / 32) * 190);
  const flat = imgXY(() => 128);
  const black = imgXY(() => 0);

  it("centroid x is negative for a left-lit image, positive for right-lit", () => {
    const ev = sceneEvidence(leftBright, rightBright);
    expect(ev.light_centroid.reference!.x).toBeLessThan(-0.05);
    expect(ev.light_centroid.current!.x).toBeGreaterThan(0.05);
  });
  it("centroid y is positive when the LOWER half is brighter", () => {
    const ev = sceneEvidence(bottomBright, flat);
    expect(ev.light_centroid.reference!.y).toBeGreaterThan(0.05);
    expect(Math.abs(ev.light_centroid.current!.y)).toBeLessThan(0.01);
  });
  it("key_fill_ratio reads ~1 for flat light and clearly higher for a directional key", () => {
    const ev = sceneEvidence(flat, leftBright);
    expect(ev.key_fill_ratio.reference!).toBeGreaterThan(0.95);
    expect(ev.key_fill_ratio.reference!).toBeLessThan(1.05);
    expect(ev.key_fill_ratio.current!).toBeGreaterThan(2);
  });
  it("a black frame yields null centroid/ratio, never NaN", () => {
    const ev = sceneEvidence(black, flat);
    expect(ev.light_centroid.reference).toBeNull();
    expect(ev.key_fill_ratio.reference).toBeNull();
  });
  it("anchors carry the ABSOLUTE per-image levels the diff hides", () => {
    const ev = sceneEvidence(flat, leftBright);
    expect(ev.anchors.reference.p50).toBeGreaterThan(0.1); // mid gray, absolute
    expect(ev.anchors.reference.clip_hi).toBe(0);
    for (const side of [ev.anchors.reference, ev.anchors.current]) {
      for (const v of Object.values(side)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------
// 2b. Sky-region evidence (2026-07-05) — the SKY measured separately from the
// subject, so sun/HDRI/env decisions stop sharing one global measurement. Mask:
// opaque pixels in the top 45% of rows with luminance >= the image's own p60;
// attached only when it covers >= 4% of the opaque pixels.
// ---------------------------------------------------------------------------------
describe("sky-region measurement + sky_estimate evidence", () => {
  // 32x32 RGBA builder with per-pixel color AND alpha (the alpha-exclusion test
  // needs transparent rows — the other helpers in this file are opaque-only).
  const imgRGBA = (px: (x: number, y: number) => [number, number, number, number]) => {
    const W = 32, H = 32;
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [r, g, b, a] = px(x, y);
      const p = (y * W + x) * 4;
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = a;
    }
    return measureFromPixels(d, 32, 32);
  };
  // Bright bluish sky over a dark warm ground — the canonical exterior split.
  const skyTop = imgRGBA((_x, y) =>
    y < 16 ? [170, 200, 240, 255] : [40, 30, 20, 255]
  );
  // The same image upside-down: the bright half is on the BOTTOM — no sky.
  const brightBottom = imgRGBA((_x, y) =>
    y < 16 ? [40, 30, 20, 255] : [170, 200, 240, 255]
  );

  it("bright top half + dark bottom -> a substantial sky region with a sane cool CCT", () => {
    expect(skyTop.sky).toBeDefined();
    // Top 45% of rows are ALL sky-bright here — well past the 4% attach floor.
    expect(skyTop.sky!.frac).toBeGreaterThan(0.25);
    // Linear means carry the SKY's color only (bluish), not the warm dark ground.
    expect(skyTop.sky!.b).toBeGreaterThan(skyTop.sky!.r);
    expect(skyTop.sky!.meanLum).toBeGreaterThan(0.3); // it is the bright region
    const est = sceneEvidence(skyTop, skyTop).sky_estimate;
    expect(est.reference).not.toBeNull();
    // A blue sky reads cool — clearly above daylight-neutral, inside McCamy's clamp.
    expect(est.reference!.cct_k).toBeGreaterThan(7000);
    expect(est.reference!.cct_k).toBeLessThanOrEqual(25000);
    expect(est.reference!.frac).toBeGreaterThan(0.25);
    expect(Number.isFinite(est.reference!.mean_lum)).toBe(true);
  });

  it("a bottom-bright image has no sky -> sky_estimate is null for that side", () => {
    // The bright pixels all sit BELOW the top-45% band, so the mask stays empty.
    expect(brightBottom.sky).toBeUndefined();
    const est = sceneEvidence(brightBottom, skyTop).sky_estimate;
    expect(est.reference).toBeNull();
    expect(est.current).not.toBeNull(); // the sides are independent
  });

  it("transparent top pixels are NOT sky (opaque mask respected)", () => {
    // Bright top rows that are fully transparent (a cut-out beauty PNG): they must
    // not vote — the mask sees only the opaque dark bottom, so no sky attaches.
    const cutout = imgRGBA((_x, y) =>
      y < 16 ? [230, 230, 230, 0] : [90, 90, 90, 255]
    );
    expect(cutout.sky).toBeUndefined();
  });

  it("a FLAT frame yields NO sky (stress fix C12: the p60 cut excluded nothing)", () => {
    // Uniform mid-gray: every pixel TIES the image's own p60 bin, so the relative
    // "bright-for-this-image" test excludes nothing. Before the flatness guard
    // (SKY_MIN_DIM_FRAC) this fabricated a sky_estimate over ~47% of a skyless
    // flat-lit frame and steered the model's HDRI/env knobs off a wall measurement.
    const flat = imgRGBA(() => [128, 128, 128, 255]);
    expect(flat.sky).toBeUndefined();
    const est = sceneEvidence(flat, skyTop).sky_estimate;
    expect(est.reference).toBeNull(); // flat side: honestly absent
    expect(est.current).not.toBeNull(); // real sky split on the other side untouched
  });

  it("a real top-bright GRADIENT still yields sky (the flatness guard is not overzealous)", () => {
    // Smooth vertical falloff — bluish bright sky at the top fading to a dark
    // ground. Real luminance separation: the p60 cut excludes the dim majority,
    // so the bright top band still attaches a substantial sky field.
    const grad = imgRGBA((_x, y) => {
      const v = Math.max(0, Math.min(255, 235 - y * 6));
      return [v, v, Math.min(255, v + 15), 255];
    });
    expect(grad.sky).toBeDefined();
    expect(grad.sky!.frac).toBeGreaterThan(0.25);
    expect(grad.sky!.b).toBeGreaterThan(grad.sky!.r); // it measured the bluish sky
  });

  it("an OLD persisted MetricVector without .sky yields sky_estimate nulls, no throw", () => {
    // Hand-built old-shape vector — exactly what a pre-2026-07-05 session restores.
    const oldVector: MetricVector = {
      lum: { p1: 0.01, p5: 0.02, p25: 0.1, p50: 0.3, p75: 0.5, p95: 0.7, p99: 0.8, mean: 0.32 },
      clip: { hi: 0, lo: 0 },
      contrast: { spread: 0.68, midSlope: 0.8 },
      wb: {
        shadow: { r: 0.05, g: 0.05, b: 0.06 },
        highlight: { r: 0.6, g: 0.6, b: 0.62 },
        warmthShadow: -0.09,
        warmthHighlight: -0.016,
        tint: 0,
      },
      sat: { mean: 0.1, p95: 0.2 },
      grid: new Array(16).fill(0.3),
    };
    let ev!: ReturnType<typeof sceneEvidence>;
    expect(() => { ev = sceneEvidence(oldVector, oldVector); }).not.toThrow();
    expect(ev.sky_estimate.reference).toBeNull();
    expect(ev.sky_estimate.current).toBeNull();
    // ...and the rest of the evidence still computes off the old shape.
    expect(ev.light_centroid.reference).not.toBeNull();
    expect(ev.anchors.reference.p50).toBeCloseTo(0.3, 4);
  });

  it("the prompt and legend name sky_estimate with the sun-vs-sky split directive", () => {
    for (const t of ["vray7max", "vantage33"]) {
      expect(systemPrompt(t, "recipe")).toContain("sky_estimate");
    }
  });
});

describe("the system prompt carries the WB/exposure arithmetic directive", () => {
  it.each(["vray7max", "vantage33"])("%s recipe prompt names wb_estimate_k + tint_gm + exposure_gap_ev", (t) => {
    const p = systemPrompt(t, "recipe");
    expect(p).toContain("wb_estimate_k");
    expect(p).toContain("tint_gm");
    expect(p).toContain("exposure_gap_ev");
    expect(p).toMatch(/higher = warmer image/);
    expect(p).toMatch(/temperature cannot fix a green\/magenta cast/);
    expect(p).toMatch(/Exposure Value is inverse/);
    // spatial/structural evidence is named too, with the honest measured/not-measured split
    expect(p).toContain("light_centroid");
    expect(p).toContain("key_fill_ratio");
    expect(p).toMatch(/anchors/);
    expect(p).toMatch(/those are not measured/);
  });
});

// ---------------------------------------------------------------------------------
// 3. HDRI finder — deterministic matching, no hallucinated names.
// ---------------------------------------------------------------------------------
const CATALOGUE: HdriAsset[] = [
  { slug: "qwantani_dusk_2", name: "Qwantani Dusk 2", categories: ["outdoor", "sunrise-sunset", "clear"], tags: ["sun", "golden hour", "grass", "warm"] },
  { slug: "kloofendal_48d", name: "Kloofendal 48d Partly Cloudy", categories: ["outdoor", "partly cloudy", "morning-afternoon"], tags: ["sun", "field", "puffy clouds"] },
  { slug: "moonless_golf", name: "Moonless Golf", categories: ["outdoor", "night"], tags: ["dark", "stars", "golf course"] },
  { slug: "studio_small_03", name: "Studio Small 03", categories: ["indoor", "studio"], tags: ["softbox", "product"] },
  { slug: "overcast_soil", name: "Overcast Soil Puresky", categories: ["outdoor", "skies", "overcast"], tags: ["grey", "flat light", "clouds"] },
];

describe("tokenizeMood", () => {
  it("drops stopwords, folds synonyms, keeps searchable terms", () => {
    const toks = tokenizeMood("golden hour, low sun, clear rural warm HDRI");
    expect(toks).toContain("golden");
    expect(toks).toContain("sunset"); // synonym of golden/warm
    expect(toks).toContain("clear");
    expect(toks).not.toContain("hdri"); // stopword
  });
  it("empty/garbage mood yields no tokens (and no matches)", () => {
    expect(tokenizeMood("")).toEqual([]);
    expect(scoreHdriAssets(CATALOGUE, [])).toEqual([]);
  });
});

describe("scoreHdriAssets", () => {
  it("'golden hour low sun clear warm' ranks the dusk HDRI first, never the night one", () => {
    const m = scoreHdriAssets(CATALOGUE, tokenizeMood("golden hour low sun clear warm"));
    expect(m.length).toBeGreaterThan(0);
    expect(m[0].slug).toBe("qwantani_dusk_2");
    expect(m.map((x) => x.slug)).not.toContain("moonless_golf");
    expect(m[0].url).toBe("https://polyhaven.com/a/qwantani_dusk_2");
  });
  it("'overcast grey flat sky' finds the overcast asset", () => {
    const m = scoreHdriAssets(CATALOGUE, tokenizeMood("overcast grey flat sky"));
    expect(m[0]?.slug).toBe("overcast_soil");
  });
  it("a single shared word is a coincidence, not a match (needs >= 2 token hits)", () => {
    const m = scoreHdriAssets(CATALOGUE, ["studio"]);
    expect(m).toEqual([]);
  });
});

describe("search links", () => {
  it("prefill both libraries with the tokenized terms, URL-encoded", () => {
    expect(polyhavenSearchUrl("golden hour clear warm")).toMatch(
      /^https:\/\/polyhaven\.com\/hdris\?s=.*golden/
    );
    expect(poliigonSearchUrl("golden hour clear warm")).toMatch(
      /^https:\/\/www\.poliigon\.com\/search\?query=.*golden/
    );
  });
});
