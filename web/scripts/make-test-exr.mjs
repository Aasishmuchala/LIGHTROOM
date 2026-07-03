// Generates a real, valid OpenEXR fixture at web/shots/test.exr:
// uncompressed, 32-bit FLOAT, RGBA scanline. A colorful gradient with an HDR hotspot
// (values > 1) so the develop/tone-map + exposure slider have something visible to do.
// Run: node scripts/make-test-exr.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const EXR_MAGIC = [0x76, 0x2f, 0x31, 0x01];

function writeUncompressedFloatExr(width, height, pixel) {
  const enc = new TextEncoder();
  const chunks = [];
  const push = (u) => chunks.push(u);
  const u8 = (n) => push(Uint8Array.from([n & 0xff]));
  const i32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, true); push(b); };
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); push(b); };
  const f32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, n, true); push(b); };
  const str0 = (s) => { push(enc.encode(s)); u8(0); };
  const attr = (name, type, v) => { str0(name); str0(type); u32(v.length); push(v); };
  const bytesOf = (fn) => {
    const s = chunks.length; fn(); const sl = chunks.splice(s);
    let L = 0; for (const c of sl) L += c.length;
    const o = new Uint8Array(L); let k = 0; for (const c of sl) { o.set(c, k); k += c.length; } return o;
  };

  push(Uint8Array.from(EXR_MAGIC));
  push(Uint8Array.from([2, 0, 0, 0]));

  const chlist = bytesOf(() => {
    for (const nm of ["A", "B", "G", "R"]) { str0(nm); i32(2); u8(0); u8(0); u8(0); u8(0); i32(1); i32(1); }
    u8(0);
  });
  attr("channels", "chlist", chlist);
  attr("compression", "compression", Uint8Array.from([0]));
  const box = bytesOf(() => { i32(0); i32(0); i32(width - 1); i32(height - 1); });
  attr("dataWindow", "box2i", box);
  attr("displayWindow", "box2i", box);
  attr("lineOrder", "lineOrder", Uint8Array.from([0]));
  attr("pixelAspectRatio", "float", bytesOf(() => f32(1)));
  attr("screenWindowCenter", "v2f", bytesOf(() => { f32(0); f32(0); }));
  attr("screenWindowWidth", "float", bytesOf(() => f32(1)));
  u8(0);

  const rows = [];
  for (let y = 0; y < height; y++) {
    const ds = width * 4 * 4;
    const body = new Uint8Array(8 + ds);
    const dv = new DataView(body.buffer);
    dv.setInt32(0, y, true);
    dv.setInt32(4, ds, true);
    let off = 8;
    for (const ch of ["A", "B", "G", "R"]) {
      for (let x = 0; x < width; x++) {
        const rgba = pixel(x, y);
        const v = ch === "A" ? rgba[3] : ch === "B" ? rgba[2] : ch === "G" ? rgba[1] : rgba[0];
        dv.setFloat32(off, v, true);
        off += 4;
      }
    }
    rows.push(body);
  }
  let hl = 0; for (const c of chunks) hl += c.length;
  let cur = hl + height * 8;
  const offs = [];
  for (let y = 0; y < height; y++) { offs.push(cur); cur += rows[y].length; }
  for (let y = 0; y < height; y++) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setUint32(0, offs[y] >>> 0, true);
    new DataView(b.buffer).setUint32(4, Math.floor(offs[y] / 2 ** 32), true);
    push(b);
  }
  for (const r of rows) push(r);

  let T = 0; for (const c of chunks) T += c.length;
  const out = new Uint8Array(T);
  let k = 0; for (const c of chunks) { out.set(c, k); k += c.length; }
  return out;
}

const W = 96, H = 64;
// A warm→cool gradient in LOW physical scale (values ~0.02..0.08) so the auto-exposure
// has to push it up to be viewable (mimics a V-Ray render on an arbitrary scale), plus a
// bright HDR sun hotspot (values up to ~6.0) in the upper-left that the tone-map rolls off.
const bytes = writeUncompressedFloatExr(W, H, (x, y) => {
  const u = x / (W - 1);
  const v = y / (H - 1);
  // base scene: dim, warm at left (sunrise) to cool at right (blue hour)
  let r = 0.06 * (1 - u) + 0.02 * u;
  let g = 0.045 * (1 - u) + 0.035 * u;
  let b = 0.02 * (1 - u) + 0.07 * u;
  // vertical falloff (darker toward the bottom, like a floor in shadow)
  const fall = 0.4 + 0.6 * (1 - v);
  r *= fall; g *= fall; b *= fall;
  // HDR sun hotspot near upper-left
  const dx = x - W * 0.28, dy = y - H * 0.30;
  const d2 = (dx * dx + dy * dy) / (W * 0.10 * (W * 0.10));
  const sun = Math.exp(-d2) * 6.0; // peak ~6.0 linear (well into HDR)
  r += sun; g += sun * 0.92; b += sun * 0.7;
  return [r, g, b, 1];
});

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "shots", "test.exr");
writeFileSync(outPath, bytes);
console.log(`wrote ${outPath} (${bytes.length} bytes, ${W}x${H} uncompressed float RGBA)`);
