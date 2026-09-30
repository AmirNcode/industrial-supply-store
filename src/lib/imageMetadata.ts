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
 * chunks are walked and the metadata ones left out. A file whose structure
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

/** APP1 (EXIF, XMP), APP13 (IPTC) and COM segments go; everything else stays. */
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
    at += 2 + length;
  }
  return null;
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
