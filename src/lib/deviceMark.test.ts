import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DEVICE_MARK_TTL_MS, signDeviceMark, verifyDeviceMark } from "./deviceMark";

const SECRET = "test-secret-at-least-sixteen-chars";
const NOW = Date.UTC(2026, 8, 30, 12);
const mark = signDeviceMark(SECRET, "customer", "code:1234567", 3, NOW + DEVICE_MARK_TTL_MS);

test("a mark opens the lockout for its own account at its session version, until it expires", () => {
  assert.equal(verifyDeviceMark(mark, SECRET, "customer", "code:1234567", 3, NOW), true);
  assert.equal(verifyDeviceMark(mark, SECRET, "customer", "code:1234567", 3, NOW + DEVICE_MARK_TTL_MS), false);
});

test("a password change or reset — a new session version — retires every earlier mark", () => {
  assert.equal(verifyDeviceMark(mark, SECRET, "customer", "code:1234567", 4, NOW), false);
});

test("a mark is no use for another account, another kind of sign-in, or a login with no account", () => {
  assert.equal(verifyDeviceMark(mark, SECRET, "customer", "code:7654321", 3, NOW), false);
  assert.equal(verifyDeviceMark(mark, SECRET, "rep", "code:1234567", 3, NOW), false);
  assert.equal(verifyDeviceMark(mark, SECRET, "customer", "code:1234567", null, NOW), false);
});

test("an edited expiry, another secret, or the old unversioned mark is refused", () => {
  const [, , sig] = mark.split(".");
  assert.equal(verifyDeviceMark(`d1.${NOW + 10 * DEVICE_MARK_TTL_MS}.${sig}`, SECRET, "customer", "code:1234567", 3, NOW), false);
  assert.equal(verifyDeviceMark(mark, "another-secret-sixteen-chars", "customer", "code:1234567", 3, NOW), false);
  const legacy = createHmac("sha256", SECRET).update("known-device\0customer\0code:1234567").digest("base64url");
  assert.equal(verifyDeviceMark(legacy, SECRET, "customer", "code:1234567", 3, NOW), false);
  assert.equal(verifyDeviceMark("", SECRET, "customer", "code:1234567", 3, NOW), false);
});
