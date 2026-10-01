/**
 * Removes the metadata a phone writes into a photo — EXIF (GPS position,
 * device, time), XMP, IPTC and text comments — keeping every byte of the
 * picture itself.
 *
 * Receipt photos are shrunk in the browser, which drops EXIF as a side effect,
 * but a direct post skips that and the file was stored as sent, location and
 * all (review finding L-15). This runs on the server for every receipt.
 *
 * No re-encoding and no image library: JPEG segments, PNG chunks and WebP
 * chunks are walked and the metadata ones left out. One EXIF value is put
 * back: a JPEG's orientation. A phone stores a portrait photo sideways and
 * says so in EXIF; without the tag the receipt displays rotated (fix review
 * F-3). The browser's shrink step usually bakes the rotation into the pixels,
 * but it keeps the original file when re-encoding would make it larger, and a
 * direct post skips it. PNG and WebP keep none: phones photograph in JPEG. A file whose structure
 * does not parse is returned unchanged rather than refused — it already passed
 * the type check, and a receipt that cannot be uploaded is worse than one that
 * keeps its metadata. PDFs are not touched.
 *
 * Only a type import, so the rules are testable on their own.
 */
import type { ProofType } from "./paymentProof";

export function stripImageMetadata(bytes: Uint8Array, type: ProofType): Uint8Array {
  try {
    if (type === "image/jpeg") return stripJpeg(bytes) ?? bytes;
    if (type === "image/png") return stripPng(bytes) ?? bytes;
    if (type === "image/webp") return stripWebp(bytes) ?? bytes;
  } catch {
    // Fall through: a structure we could not walk is kept as it is.
  }
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * APP1 (EXIF, XMP), APP13 (IPTC) and COM segments go; everything else stays.
 * An EXIF segment that says the picture is rotated is replaced by one that
 * says only that.
 */
function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // Start of scan: the compressed picture and everything after it, verbatim.
    if (marker === 0xda) {
      parts.push(bytes.subarray(at));
      return concat(parts);
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) return null;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) parts.push(bytes.subarray(at, at + 2 + length));
    if (marker === 0xe1) {
      const orientation = exifOrientation(bytes.subarray(at + 4, at + 2 + length));
      if (orientation !== null) parts.push(orientationSegment(orientation));
    }
    at += 2 + length;
  }
  return null;
}

/**
 * The orientation (2–8) an EXIF payload records, or null for upright, absent
 * or unreadable. Read from the first IFD, in the payload's own byte order.
 */
function exifOrientation(payload: Uint8Array): number | null {
  const header = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"
  if (payload.length < 14 || header.some((byte, i) => payload[i] !== byte)) return null;
  const tiff = new DataView(payload.buffer, payload.byteOffset + 6, payload.byteLength - 6);
  const order = tiff.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  if (tiff.getUint16(2, little) !== 42) return null;
  const ifd = tiff.getUint32(4, little);
  if (ifd + 2 > tiff.byteLength) return null;
  const count = tiff.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.byteLength) return null;
    // Tag 0x0112 is Orientation, a SHORT (type 3) held in the entry itself.
    if (tiff.getUint16(entry, little) !== 0x0112) continue;
    if (tiff.getUint16(entry + 2, little) !== 3) return null;
    const value = tiff.getUint16(entry + 8, little);
    return value >= 2 && value <= 8 ? value : null;
  }
  return null;
}

/** A complete APP1 segment holding one EXIF entry: the orientation. */
function orientationSegment(orientation: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xe1, 0x00, 0x22, // APP1, 34 bytes including this length
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, first IFD at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // no further IFD
  ]);
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(bytes: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const end = at + 12 + length;
    if (end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (!PNG_DROP.has(type)) parts.push(bytes.subarray(at, end));
    at = end;
    if (type === "IEND") return concat(parts);
  }
  return null;
}

function stripWebp(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(...bytes.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (size % 2);
    if (at + 8 + size > bytes.length) return null;
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const chunk = bytes.slice(at, Math.min(end, bytes.length));
      // VP8X announces which optional chunks follow; unset EXIF (0x08) and XMP (0x04).
      if (fourcc === "VP8X" && size >= 1) chunk[8] &= ~0x0c;
      chunks.push(chunk);
    }
    at = end;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  return concat([header, body]);
}
