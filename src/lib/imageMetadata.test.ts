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
