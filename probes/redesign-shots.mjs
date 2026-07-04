// Redesign verification harness (playwright-core drives the SYSTEM Chrome, no download).
// Loads lightmatch.html from file://, and for the populated states injects a stub
// ENGINE._adapter that returns a valid multi-move recipe (validated through the real
// validate() callback, exactly like the in-file selftest stub does) + seeds fake ref/base
// images, then drives ENGINE.analyze() and screenshots. Presentation-only: the stub only
// feeds the seam the app already exposes (ENGINE._adapter); no app logic is changed.
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HTML = "file:///C:/Users/aasis/lightmatch/lightmatch.html";
const OUT = "C:/Users/aasis/lightmatch/probes";

// A 2x2 grey PNG (valid image/png data URL) — enough for a thumb; matches DATAURL_RE.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGNkYGD4z8DAwMgAAwAI/AH+3v2mUgAAAABJRU5ErkJggg==";

// A richer stub recipe: 6 changed moves spanning several real panel bands so the
// changes-summary hero and the (opt-in) full panel both render representatively.
const STUB = `
(function(){
  const REF = ${JSON.stringify(PNG)};
  const RECIPE = {
    baseline: "factory_defaults",
    hdri_mood: "warm low-sun overcast, soft key from camera-left",
    gi_notes: "Brute force + light cache is fine at this scale; no denoiser needed.",
    status: "continue", status_reason: "",
    values: [
      { param: "cam.iso",        set: 200,  from: 100, step: 1, confidence: "high",   why: "Reference sits about a stop brighter; lift ISO to match mid-tones." },
      { param: "cam.fnumber",    set: 5.6,  from: 8.0, step: 1, confidence: "high",   why: "Open up 2/3 stop for the shallower depth in the reference." },
      { param: "cam.wb_kelvin",  set: 5200, from: 6500, step: 4, confidence: "medium", why: "Reference is warmer; drop white balance toward tungsten." },
      { param: "sun.intensity_mult", set: 1.4, from: 1.0, step: 2, confidence: "high", why: "Key light reads stronger in the reference." },
      { param: "dome.intensity", set: 0.7,  from: 1.0, step: 3, confidence: "medium", why: "Pull the dome down so the sun carries the shaping." },
      { param: "cm.contrast",    set: 0.15, from: 0,   step: 5, confidence: "low",    why: "A touch more contrast to seat the blacks like the reference." }
    ],
    rationale: "The reference is a warm, low-sun interior with a strong single key. Match exposure first (ISO + f-number), warm the white balance, then let the sun carry the shaping while the dome recedes, and finish with a light contrast seat."
  };
  const orig = ENGINE._adapter;
  ENGINE._adapter = {
    async call({ validate }) {
      const obj = JSON.parse(JSON.stringify(RECIPE));
      const result = typeof validate === "function" ? validate(obj) : { ok: true, errors: [], cleaned: obj };
      if (!result.ok) throw new Error("stub validate failed: " + JSON.stringify(result.errors));
      return result.cleaned;
    }
  };
  window.__seedImages = async function(){
    // Build genuinely-decodable images from an in-page canvas (guaranteed to satisfy
    // createImageBitmap in _decodeSource) and feed them through the SAME ENGINE.setImage
    // path the real UI uses — so the state advances legitimately (empty -> ready).
    function makeCanvas(hueShift){
      const c = document.createElement("canvas"); c.width = 320; c.height = 200;
      const x = c.getContext("2d");
      const g = x.createLinearGradient(0,0,320,200);
      g.addColorStop(0, "hsl(" + (30+hueShift) + ",45%,42%)");
      g.addColorStop(1, "hsl(" + (200+hueShift) + ",30%,20%)");
      x.fillStyle = g; x.fillRect(0,0,320,200);
      x.fillStyle = "rgba(255,240,210,0.85)"; x.beginPath(); x.arc(90,70,42,0,7); x.fill();
      return c;
    }
    // setImage accepts a canvas-like source directly (isCanvasLike branch), no File needed.
    await ENGINE.setImage("ref",  makeCanvas(0));
    await ENGINE.setImage("base", makeCanvas(40));
    UI.render();
  };
})();
`;

async function shoot() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--force-color-profile=srgb"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("PAGE ERROR:", e.message));
  page.on("console", m => { if (m.type() === "error") console.log("CONSOLE ERROR:", m.text()); });

  // ---------- 1) EMPTY / first-run ----------
  await page.goto(HTML, { waitUntil: "load" });
  await page.waitForSelector("#topbar .brand", { timeout: 8000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, "redesign-empty.png"), fullPage: true });
  console.log("shot: redesign-empty.png");

  // ---------- 2) RECIPE (panel collapsed = the hero leads) ----------
  await page.evaluate(STUB);
  await page.evaluate(() => window.__seedImages());
  await page.waitForTimeout(150);
  await page.evaluate(() => UI.doAnalyze());
  await page.waitForSelector(".changes-list .value-row", { timeout: 8000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, "redesign-recipe.png"), fullPage: true });
  console.log("shot: redesign-recipe.png");

  // ---------- 3) FULL PANEL expanded ----------
  await page.evaluate(() => { const d = document.querySelector("details.full-panel"); if (d) d.open = true; });
  await page.waitForSelector(".full-panel[open] .sheet .sheet-band", { timeout: 8000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, "redesign-fullpanel.png"), fullPage: true });
  console.log("shot: redesign-fullpanel.png");

  // ---------- 4) NARROW (1000px) ----------
  await page.evaluate(() => { const d = document.querySelector("details.full-panel"); if (d) d.open = false; });
  await page.setViewportSize({ width: 1000, height: 1100 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "redesign-narrow.png"), fullPage: true });
  console.log("shot: redesign-narrow.png");

  await browser.close();
  console.log("DONE");
}
shoot().catch(e => { console.error("HARNESS FAIL:", e); process.exit(1); });
