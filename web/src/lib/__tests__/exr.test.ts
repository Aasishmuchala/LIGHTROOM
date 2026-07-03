import { describe, it, expect } from "vitest";
import {
  isExrMagic,
  hasExrExtension,
  decodeExrBuffer,
  isExrFile,
  EXR_MAGIC,
} from "../exr";
import { acceptsFile, isExrName } from "@/components/lib";

// ===========================================================================
// A minimal, dependency-free OpenEXR *writer* — enough to produce a valid
// UNCOMPRESSED, 32-bit FLOAT, RGBA scanline EXR in-test so the real three.js decoder
// path is exercised (not mocked). Scanline layout per the OpenEXR spec:
//   magic, version, header attributes (terminated by \0), scanline offset table,
//   then per-scanline blocks: [y:int32][dataSize:int32][channel data...].
// Channels are stored ALPHABETICALLY (A,B,G,R); within a scanline the data is laid out
// channel-by-channel (all A samples of the row, then all B, ...). FLOAT = pixelType 2.
// ===========================================================================
function writeUncompressedFloatExr(
  width: number,
  height: number,
  // pixel(x,y) -> [r,g,b,a] linear floats
  pixel: (x: number, y: number) => [number, number, number, number]
): ArrayBuffer {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const push = (u: Uint8Array) => chunks.push(u);
  const u8 = (n: number) => push(Uint8Array.from([n & 0xff]));
  const i32 = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, n, true);
    push(b);
  };
  const u32 = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    push(b);
  };
  const f32 = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, n, true);
    push(b);
  };
  const str0 = (s: string) => {
    push(enc.encode(s));
    u8(0);
  };
  const attr = (name: string, type: string, valueBytes: Uint8Array) => {
    str0(name);
    str0(type);
    u32(valueBytes.length);
    push(valueBytes);
  };
  const bytesOf = (fn: () => void): Uint8Array => {
    const save = chunks.length;
    fn();
    const slice = chunks.splice(save);
    let len = 0;
    for (const c of slice) len += c.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const c of slice) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  };

  // -- magic + version (v2, no flags) --
  push(Uint8Array.from(EXR_MAGIC));
  push(Uint8Array.from([2, 0, 0, 0]));

  // -- channels (chlist): A,B,G,R each FLOAT(2), pLinear 0, xSampling/ySampling 1 --
  const chlist = bytesOf(() => {
    for (const name of ["A", "B", "G", "R"]) {
      str0(name);
      i32(2); // FLOAT
      u8(0); // pLinear
      u8(0);
      u8(0);
      u8(0); // reserved (3) — write 4 bytes total for pLinear+reserved block? spec: 1 pLinear + 3 reserved
      i32(1); // xSampling
      i32(1); // ySampling
    }
    u8(0); // end of channel list
  });
  attr("channels", "chlist", chlist);

  // -- compression: 0 = NO_COMPRESSION --
  attr("compression", "compression", Uint8Array.from([0]));

  // -- dataWindow / displayWindow: box2i (xmin,ymin,xmax,ymax) --
  const box = bytesOf(() => {
    i32(0);
    i32(0);
    i32(width - 1);
    i32(height - 1);
  });
  attr("dataWindow", "box2i", box);
  attr("displayWindow", "box2i", box);

  // -- lineOrder: 0 = INCREASING_Y --
  attr("lineOrder", "lineOrder", Uint8Array.from([0]));

  // -- pixelAspectRatio: float 1.0 --
  attr("pixelAspectRatio", "float", bytesOf(() => f32(1)));

  // -- screenWindowCenter: v2f (0,0) --
  attr("screenWindowCenter", "v2f", bytesOf(() => {
    f32(0);
    f32(0);
  }));

  // -- screenWindowWidth: float 1.0 --
  attr("screenWindowWidth", "float", bytesOf(() => f32(1)));

  // -- end of header --
  u8(0);

  // -- build each scanline block body first so we know sizes for the offset table --
  // block body = [y:int32][dataSize:int32][ A-row floats | B-row | G-row | R-row ]
  const channelsInOrder = ["A", "B", "G", "R"] as const;
  const rowBodies: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const dataSize = width * 4 * 4; // 4 channels * 4 bytes * width
    const body = new Uint8Array(4 + 4 + dataSize);
    const dv = new DataView(body.buffer);
    dv.setInt32(0, y, true);
    dv.setInt32(4, dataSize, true);
    let off = 8;
    for (const ch of channelsInOrder) {
      for (let x = 0; x < width; x++) {
        const rgba = pixel(x, y);
        const v = ch === "A" ? rgba[3] : ch === "B" ? rgba[2] : ch === "G" ? rgba[1] : rgba[0];
        dv.setFloat32(off, v, true);
        off += 4;
      }
    }
    rowBodies.push(body);
  }

  // -- current byte length so far (header end) --
  let headerLen = 0;
  for (const c of chunks) headerLen += c.length;
  // offset table: one uint64 per scanline
  const offsetTableLen = height * 8;
  let cursor = headerLen + offsetTableLen;
  const offsets: number[] = [];
  for (let y = 0; y < height; y++) {
    offsets.push(cursor);
    cursor += rowBodies[y].length;
  }
  // write offset table (uint64 LE; heights are tiny so hi word is 0)
  for (let y = 0; y < height; y++) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setUint32(0, offsets[y] >>> 0, true);
    new DataView(b.buffer).setUint32(4, Math.floor(offsets[y] / 2 ** 32), true);
    push(b);
  }
  // write scanline blocks
  for (const body of rowBodies) push(body);

  // concat everything
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

describe("EXR magic-byte + extension detection", () => {
  it("isExrMagic matches the OpenEXR signature 0x76 0x2f 0x31 0x01", () => {
    expect(isExrMagic(Uint8Array.from([0x76, 0x2f, 0x31, 0x01, 0x02, 0x00]))).toBe(true);
    expect(isExrMagic(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // PNG
    expect(isExrMagic(Uint8Array.from([0x76, 0x2f]))).toBe(false); // too short
    expect(isExrMagic(null)).toBe(false);
  });
  it("isExrMagic accepts a raw ArrayBuffer", () => {
    const buf = Uint8Array.from([0x76, 0x2f, 0x31, 0x01]).buffer;
    expect(isExrMagic(buf)).toBe(true);
  });
  it("hasExrExtension / isExrName is case-insensitive and trims", () => {
    expect(hasExrExtension("render.exr")).toBe(true);
    expect(hasExrExtension("RENDER.EXR")).toBe(true);
    expect(hasExrExtension("  beauty.Exr  ")).toBe(true);
    expect(hasExrExtension("render.png")).toBe(false);
    expect(hasExrExtension("")).toBe(false);
    expect(isExrName("beauty.exr")).toBe(true);
    expect(isExrName("beauty.jpg")).toBe(false);
  });
});

describe("isExrFile — the gate the store uses to route to the develop path", () => {
  it("detects an EXR by magic bytes even with no .exr extension (empty MIME case)", async () => {
    // A Blob whose leading bytes are the EXR magic but named without .exr — the store's
    // ingest still routes this to decode+develop.
    const blob = new Blob([Uint8Array.from([...EXR_MAGIC, 2, 0, 0, 0])]);
    (blob as unknown as { name?: string }).name = "clipboard-image";
    expect(await isExrFile(blob as File)).toBe(true);
  });
  it("detects an EXR by extension without reading bytes", async () => {
    const blob = new Blob([Uint8Array.from([0, 0, 0, 0])]) as File & { name?: string };
    (blob as unknown as { name?: string }).name = "render.exr";
    expect(await isExrFile(blob)).toBe(true);
  });
  it("does NOT flag a PNG (magic + name both non-EXR)", async () => {
    const blob = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])]) as File & { name?: string };
    (blob as unknown as { name?: string }).name = "shot.png";
    expect(await isExrFile(blob)).toBe(false);
  });
});

describe("acceptsFile now accepts EXR", () => {
  it("accepts a fake .exr by name even when MIME is empty (as browsers report)", () => {
    expect(acceptsFile({ name: "vray_beauty.exr", type: "" })).toEqual({ ok: true, reason: "" });
  });
  it("accepts an EXR that reports an x-exr MIME", () => {
    expect(acceptsFile({ name: "beauty", type: "image/x-exr" }).ok).toBe(true);
  });
  it("still accepts png/jpeg/webp", () => {
    expect(acceptsFile({ type: "image/png" }).ok).toBe(true);
    expect(acceptsFile({ type: "image/jpeg" }).ok).toBe(true);
    expect(acceptsFile({ type: "image/webp" }).ok).toBe(true);
  });
  it("rejects a truly-unsupported format with the new message that mentions EXR is auto-developed", () => {
    const r = acceptsFile({ name: "scan.tif", type: "image/tiff" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/EXR/);
    expect(r.reason).toMatch(/developed/i);
    expect(r.reason).toMatch(/TIFF|HEIC|PSD/);
  });
});

describe("decodeExrBuffer — the REAL three.js decoder against a synthetic uncompressed float EXR", () => {
  it("decodes a 4x2 RGBA gradient to a linear Float32Array with the right dimensions & values", () => {
    const W = 4;
    const H = 2;
    // A simple gradient: R ramps across x, G ramps down y (in EXR scanline space), B
    // constant, A = 1.
    const buf = writeUncompressedFloatExr(W, H, (x, y) => [
      x / (W - 1), // R: 0..1 across
      y / (H - 1), // G: 0..1 down the EXR scanlines
      0.25, // B constant
      1, // A
    ]);
    const decoded = decodeExrBuffer(buf);
    expect(decoded.width).toBe(W);
    expect(decoded.height).toBe(H);
    expect(decoded.data).toBeInstanceOf(Float32Array);
    expect(decoded.data.length).toBe(W * H * 4);

    // three.js EXRLoader returns rows BOTTOM-UP relative to EXR scanline numbering: the
    // output buffer's row 0 corresponds to the EXR's last scanline (writer y = H-1).
    // This vertical orientation is irrelevant to LightMatch (all metrics are computed
    // over the whole frame; develop is per-pixel), but the test maps it exactly.
    const at = (x: number, outY: number) => {
      const i = (outY * W + x) * 4;
      return [decoded.data[i], decoded.data[i + 1], decoded.data[i + 2], decoded.data[i + 3]];
    };
    const writerY = (outY: number) => H - 1 - outY;

    // Output row 0 == writer y=1 (G=1); output row 1 == writer y=0 (G=0).
    // Horizontal R ramp holds regardless of the vertical flip.
    const r0 = at(0, 0); // x=0, writer y=1
    expect(r0[0]).toBeCloseTo(0, 5); // R at x=0
    expect(r0[1]).toBeCloseTo(writerY(0) / (H - 1), 5); // G at writer y=1 -> 1
    expect(r0[2]).toBeCloseTo(0.25, 5); // B constant
    expect(r0[3]).toBeCloseTo(1, 5); // A

    const r0Right = at(3, 0); // x=3
    expect(r0Right[0]).toBeCloseTo(1, 5); // R at x=3

    const r1 = at(0, 1); // x=0, writer y=0
    expect(r1[0]).toBeCloseTo(0, 5); // R at x=0
    expect(r1[1]).toBeCloseTo(writerY(1) / (H - 1), 5); // G at writer y=0 -> 0

    // The full set of decoded G-values is exactly {0, 1} (both rows present).
    const gVals = new Set<number>();
    for (let i = 1; i < decoded.data.length; i += 4) gVals.add(Math.round(decoded.data[i]));
    expect([...gVals].sort()).toEqual([0, 1]);
  });

  it("preserves scene-referred HDR values above 1.0 (not clamped by the decoder)", () => {
    const buf = writeUncompressedFloatExr(2, 1, () => [4.5, 2.0, 0.5, 1]);
    const decoded = decodeExrBuffer(buf);
    expect(decoded.data[0]).toBeCloseTo(4.5, 4); // R stays > 1 (HDR)
    expect(decoded.data[1]).toBeCloseTo(2.0, 4);
    expect(decoded.data[2]).toBeCloseTo(0.5, 4);
  });

  it("throws an ExrDecodeError on garbage input", () => {
    const garbage = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    expect(() => decodeExrBuffer(garbage)).toThrow(/EXR/);
    try {
      decodeExrBuffer(garbage);
    } catch (e) {
      expect((e as Error).name).toBe("ExrDecodeError");
    }
  });
});
