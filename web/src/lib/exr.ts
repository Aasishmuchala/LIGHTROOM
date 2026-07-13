// LightMatch EXR decoder (client-only) — decodes an OpenEXR (.exr) file into a
// scene-referred LINEAR RGBA Float32Array that develop.ts then tone-maps to a viewable
// sRGB image.
//
// WHY three.js's EXRLoader: it is the battle-tested browser EXR decoder. It handles the
// compressions V-Ray/Vantage actually write — uncompressed, ZIP/ZIPS, RLE, PIZ (wavelet),
// B44/A, and DWA/B — for BOTH half-float and 32-bit float pixel types. We import ONLY the
// loader addon (plus the `three` core symbols it references and the bundled fflate for
// ZIP inflate); no WebGLRenderer/GPU is created — `parse()` is pure CPU. We force
// FloatType so the output is a plain Float32Array (not a packed half Uint16Array), which
// is exactly the linear buffer develop.ts wants.
//
// This module is CLIENT-ONLY (it constructs a canvas-adjacent decoder and is only ever
// reached from the browser ingest path). It has no server import site.

import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { FloatType } from "three";

/** The magic bytes at the start of every OpenEXR file: 0x76 0x2f 0x31 0x01
 *  (little-endian version-field magic 20000630). */
export const EXR_MAGIC = [0x76, 0x2f, 0x31, 0x01] as const;

/** Decoded EXR: linear (scene-referred) RGBA, row-major, 4 floats per pixel.
 *  Rows are TOP-DOWN: row 0 is the image TOP (decodeExrBuffer flips the loader's
 *  bottom-up texture order at the decode boundary — see the comment there). */
export interface DecodedExr {
  width: number;
  height: number;
  /** Linear RGBA, length width*height*4. Values are scene-referred (may exceed 1.0). */
  data: Float32Array;
}

/** True if the first four bytes are the EXR magic. Accepts an ArrayBuffer or a byte view.
 *  Used alongside the filename extension so a VFB save with an empty MIME still routes. */
export function isExrMagic(buf: ArrayBuffer | Uint8Array | null | undefined): boolean {
  if (!buf) return false;
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 4) return false;
  return (
    bytes[0] === EXR_MAGIC[0] &&
    bytes[1] === EXR_MAGIC[1] &&
    bytes[2] === EXR_MAGIC[2] &&
    bytes[3] === EXR_MAGIC[3]
  );
}

/** True if a filename ends in .exr (case-insensitive). */
export function hasExrExtension(name: string | null | undefined): boolean {
  return typeof name === "string" && /\.exr$/i.test(name.trim());
}

/**
 * Decide whether a dropped/pasted/picked file is an EXR. MIME is usually empty for EXR
 * (browsers don't recognize image/x-exr), so we accept it if EITHER the extension is
 * .exr OR the leading bytes are the EXR magic. Reads only the first 4 bytes for the
 * magic check (cheap) — pass the already-read header if you have it.
 */
export async function isExrFile(file: File | Blob & { name?: string }): Promise<boolean> {
  const name = (file as { name?: string }).name;
  if (hasExrExtension(name)) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return isExrMagic(head);
  } catch {
    return false;
  }
}

/**
 * Decode an EXR ArrayBuffer to a linear RGBA Float32Array. Pure CPU (no GPU). Throws a
 * DecodeError-shaped Error (name === "ExrDecodeError") on any parse failure so the caller
 * can surface a clean message.
 *
 * Output contract: { width, height, data } where data is a Float32Array of length
 * width*height*4, linear/scene-referred RGBA, rows TOP-DOWN (row 0 = image top). The
 * loader normalizes 1/2-channel and luminance-chroma EXRs up to RGBA for us, so
 * callers always see 4 channels.
 */
export function decodeExrBuffer(buffer: ArrayBuffer): DecodedExr {
  let parsed: { data: ArrayLike<number>; width: number; height: number };
  try {
    const loader = new EXRLoader();
    loader.setDataType(FloatType); // force Float32Array output (not packed half Uint16Array)
    parsed = loader.parse(buffer) as unknown as {
      data: ArrayLike<number>;
      width: number;
      height: number;
    };
  } catch (e) {
    const err = new Error(
      "Could not decode EXR — the file may be corrupt or use an unsupported compression (DWAA/DWAB and tiled/deep EXRs are not supported): " +
        ((e as Error)?.message || String(e))
    );
    err.name = "ExrDecodeError";
    throw err;
  }
  if (!parsed || !parsed.width || !parsed.height || !parsed.data) {
    const err = new Error("Could not decode EXR — the decoder returned no pixel data.");
    err.name = "ExrDecodeError";
    throw err;
  }
  // parse() with FloatType returns a Float32Array; normalize defensively.
  const data =
    parsed.data instanceof Float32Array ? parsed.data : Float32Array.from(parsed.data);

  // three.js's EXRLoader emits its rows BOTTOM-UP (WebGL texture convention, flipY):
  // output row 0 is the EXR's LAST scanline, i.e. the image BOTTOM (verified against a
  // known top-bright gradient). LightMatch's consumers are spatial — developExr
  // putImageData's this buffer straight onto a canvas (the slot thumbnail and the JPEG
  // the model sees), and metrics' sky mask / light centroid / 4x4 grid all treat row 0
  // as the image TOP — so leaving the texture order in place renders the frame
  // upside-down and inverts every vertical lighting cue (sun elevation read off the
  // floor). Flip rows ONCE here at the decode boundary so row 0 = image top for ALL
  // consumers. In-place pairwise row swap; only complete rows that actually exist are
  // touched (a short buffer must never be indexed past its end).
  const rowFloats = parsed.width * 4;
  const rows = Math.min(parsed.height, Math.floor(data.length / rowFloats));
  const tmp = new Float32Array(rowFloats);
  for (let top = 0, bot = rows - 1; top < bot; top++, bot--) {
    const a = top * rowFloats;
    const b = bot * rowFloats;
    tmp.set(data.subarray(a, a + rowFloats));
    data.copyWithin(a, b, b + rowFloats);
    data.set(tmp, b);
  }

  return { width: parsed.width, height: parsed.height, data };
}

/** Convenience: read a File/Blob fully and decode it. Client-only. */
export async function decodeExrFile(file: File | Blob): Promise<DecodedExr> {
  const buffer = await file.arrayBuffer();
  return decodeExrBuffer(buffer);
}
