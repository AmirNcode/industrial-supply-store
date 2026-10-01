import { test } from "node:test";
import assert from "node:assert/strict";
import { stripImageMetadata } from "./imageMetadata";

const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const has = (bytes: Uint8Array, s: string) => Buffer.from(bytes).includes(Buffer.from(s));

test("a JPEG loses its EXIF and comments and keeps the picture", () => {
  const segment = (marker: number, payload: number[]) => [0xff, marker, 0, payload.length + 2, ...payload];
  const jpeg = Uint8Array.from([
    0xff, 0xd8,
    ...segment(0xe0, text("JFIF\0")),
    ...segment(0xe1, text("Exif\0\0GPS-35.7N")),
    ...segment(0xfe, text("taken at home")),
    ...segment(0xdb, [1, 2, 3]),
    0xff, 0xda, 0, 4, 9, 9, 0xaa, 0xbb, 0xff, 0xd9,
  ]);
  const out = stripImageMetadata(jpeg, "image/jpeg");
  assert.ok(!has(out, "GPS-35.7N") && !has(out, "taken at home"));
  assert.ok(has(out, "JFIF"));
  assert.deepEqual([...out.subarray(-6)], [9, 9, 0xaa, 0xbb, 0xff, 0xd9]);
});

/** An EXIF payload, little-endian like most phones: camera make, orientation, GPS pointer. */
function exif(orientation: number): number[] {
  const u16 = (n: number) => [n & 0xff, n >> 8];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
  const entry = (tag: number, type: number, count: number, value: number[]) => [
    ...u16(tag), ...u16(type), ...u32(count), ...value,
  ];
  return [
    ...text("Exif\0\0"),
    ...text("II"), ...u16(42), ...u32(8),
    ...u16(3),
    ...entry(0x010f, 2, 4, text("ACME")), // camera make, inline
    ...entry(0x0112, 3, 1, [...u16(orientation), 0, 0]),
    ...entry(0x8825, 4, 1, u32(50)), // GPS IFD pointer
    ...u32(0),
    ...text("GPS-35.7N"),
  ];
}

const jpegWith = (app1: number[]) => {
  const segment = (marker: number, payload: number[]) => [0xff, marker, 0, payload.length + 2, ...payload];
  return Uint8Array.from([
    0xff, 0xd8,
    ...segment(0xe0, text("JFIF\0")),
    ...segment(0xe1, app1),
    0xff, 0xda, 0, 4, 9, 9, 0xff, 0xd9,
  ]);
};

/** The orientation a JPEG's first EXIF segment records, reading it back as a viewer would. */
function orientationOf(jpeg: Uint8Array): number | null {
  const at = Buffer.from(jpeg).indexOf(Buffer.from("Exif\0\0"));
  if (at < 0) return null;
  const tiff = new DataView(jpeg.buffer, jpeg.byteOffset + at + 6);
  const little = tiff.getUint16(0) === 0x4949;
  const ifd = tiff.getUint32(4, little);
  for (let i = 0; i < tiff.getUint16(ifd, little); i++) {
    const entry = ifd + 2 + i * 12;
    if (tiff.getUint16(entry, little) === 0x0112) return tiff.getUint16(entry + 8, little);
  }
  return null;
}

test("a rotated phone photo keeps its orientation and nothing else from EXIF", () => {
  const out = stripImageMetadata(jpegWith(exif(6)), "image/jpeg");
  assert.equal(orientationOf(out), 6);
  assert.ok(!has(out, "ACME") && !has(out, "GPS-35.7N"));
  assert.deepEqual([...out.subarray(-6)], [0, 4, 9, 9, 0xff, 0xd9]);
});

test("an upright photo, or an EXIF block that does not parse, keeps no EXIF at all", () => {
  for (const app1 of [exif(1), text("Exif\0\0junk-GPS"), text("http://ns.adobe.com/xap/1.0/\0<x/>")]) {
    const out = stripImageMetadata(jpegWith(app1), "image/jpeg");
    assert.ok(!has(out, "Exif") && !has(out, "GPS") && !has(out, "<x/>"));
    assert.ok(has(out, "JFIF"));
  }
});

test("a PNG loses its text and EXIF chunks", () => {
  const chunk = (type: string, data: number[]) => {
    const length = [0, 0, 0, data.length];
    return [...length, ...text(type), ...data, 0, 0, 0, 0];
  };
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [1, 2, 3]),
    ...chunk("tEXt", text("Location\0Tehran")),
    ...chunk("eXIf", text("GPS")),
    ...chunk("IDAT", [7, 7]),
    ...chunk("IEND", []),
  ]);
  const out = stripImageMetadata(png, "image/png");
  assert.ok(!has(out, "Tehran") && !has(out, "eXIf"));
  assert.ok(has(out, "IHDR") && has(out, "IDAT") && has(out, "IEND"));
});

test("a WebP loses EXIF and XMP and its header still adds up", () => {
  const chunk = (fourcc: string, data: number[]) => {
    const padded = data.length % 2 ? [...data, 0] : data;
    return [...text(fourcc), data.length, 0, 0, 0, ...padded];
  };
  const body = [
    ...text("WEBP"),
    ...chunk("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...chunk("VP8 ", [5, 5, 5, 5]),
    ...chunk("EXIF", text("GPS-51.4E")),
    ...chunk("XMP ", text("<x/>")),
  ];
  const webp = Uint8Array.from([...text("RIFF"), body.length, 0, 0, 0, ...body]);
  const out = stripImageMetadata(webp, "image/webp");
  assert.ok(!has(out, "GPS-51.4E") && !has(out, "<x/>"));
  assert.equal(new DataView(out.buffer).getUint32(4, true), out.length - 8);
  assert.equal(out[20] & 0x0c, 0, "VP8X no longer announces EXIF or XMP");
});

test("anything that does not parse is kept as it is", () => {
  const broken = Uint8Array.from([0xff, 0xd8, 0x00, 0x01]);
  assert.equal(stripImageMetadata(broken, "image/jpeg"), broken);
  const pdf = Uint8Array.from(text("%PDF-1.7"));
  assert.equal(stripImageMetadata(pdf, "application/pdf"), pdf);
});
