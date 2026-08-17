import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REQUEST_LIMITS,
  RequestBodyTooLargeError,
  boundedString,
  parseQuickOrder,
  readJsonWithin,
  utf8ByteLength,
} from "./requestLimits";

test("boundedString trims and enforces the actual field ceiling", () => {
  assert.equal(boundedString("  valve  ", 5), "valve");
  assert.equal(boundedString("      ", 5), null);
  assert.equal(boundedString("valves", 5), null);
  assert.equal(boundedString("", 5, { allowEmpty: true }), "");
});

test("quick order bounds bytes, lines, part numbers, and quantities", () => {
  assert.deepEqual(parseQuickOrder(" A-1, 2\nB-2\t999999\nC-3"), {
    ok: true,
    lines: [
      { partNumber: "A-1", qty: 2 },
      { partNumber: "B-2", qty: 99_999 },
      { partNumber: "C-3", qty: 1 },
    ],
  });

  const tooMany = Array.from(
    { length: REQUEST_LIMITS.quickOrderLines + 1 },
    (_, index) => `P-${index}`,
  ).join("\n");
  assert.deepEqual(parseQuickOrder(tooMany), { ok: false, reason: "too-large" });

  const tooLarge = "é".repeat(Math.floor(REQUEST_LIMITS.quickOrderBytes / 2) + 1);
  assert.ok(utf8ByteLength(tooLarge) > REQUEST_LIMITS.quickOrderBytes);
  assert.deepEqual(parseQuickOrder(tooLarge), { ok: false, reason: "too-large" });
});

test("readJsonWithin rejects declared and chunked bodies before unbounded buffering", async () => {
  await assert.rejects(
    readJsonWithin(
      new Request("http://local.test", {
        method: "POST",
        headers: { "content-length": "10" },
        body: "{}",
      }),
      2,
    ),
    RequestBodyTooLargeError,
  );

  await assert.rejects(
    readJsonWithin(
      new Request("http://local.test", { method: "POST", body: '{"long":true}' }),
      4,
    ),
    RequestBodyTooLargeError,
  );

  assert.deepEqual(
    await readJsonWithin(
      new Request("http://local.test", { method: "POST", body: '{"ok":true}' }),
      32,
    ),
    { ok: true },
  );
});
