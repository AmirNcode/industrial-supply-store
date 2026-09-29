import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_SESSION_TTL_MS,
  passwordsEqual,
  signAdminSessionToken,
  verifyAdminSessionToken,
} from "./adminSessionToken";

const SECRET = "test-secret-at-least-16";
const NOW = 1_800_000_000_000;

test("a fresh admin token verifies; an expired one does not", () => {
  const token = signAdminSessionToken(1, NOW + ADMIN_SESSION_TTL_MS, SECRET, "pw");
  assert.equal(verifyAdminSessionToken(token, SECRET, "pw", 1, NOW), true);
  assert.equal(verifyAdminSessionToken(token, SECRET, "pw", 1, NOW + ADMIN_SESSION_TTL_MS), false);
});

test("a password change or a sign-out-everywhere revokes every admin token", () => {
  const token = signAdminSessionToken(3, NOW + 1000, SECRET, "old-password");
  assert.equal(verifyAdminSessionToken(token, SECRET, "new-password", 3, NOW), false);
  assert.equal(verifyAdminSessionToken(token, SECRET, "old-password", 4, NOW), false);
  assert.equal(verifyAdminSessionToken(token, "another-secret-16+", "old-password", 3, NOW), false);
});

test("a tampered or legacy admin token is refused", () => {
  const token = signAdminSessionToken(1, NOW + 1000, SECRET, "pw");
  const [, , exp, sig] = token.split(".");
  assert.equal(verifyAdminSessionToken(`a1.1.${Number(exp) + 99999}.${sig}`, SECRET, "pw", 1, NOW), false);
  assert.equal(verifyAdminSessionToken(`a1.2.${exp}.${sig}`, SECRET, "pw", 2, NOW), false);
  // The pre-fix cookie: a bare hex HMAC.
  assert.equal(verifyAdminSessionToken("ab".repeat(32), SECRET, "pw", 1, NOW), false);
  assert.equal(verifyAdminSessionToken("", SECRET, "pw", 1, NOW), false);
});

test("the token does not contain the password or a hash of it alone", () => {
  const token = signAdminSessionToken(1, NOW + 1000, SECRET, "hunter2-password");
  assert.ok(!token.includes("hunter2"));
});

test("password comparison works for any lengths", () => {
  assert.equal(passwordsEqual("same", "same"), true);
  assert.equal(passwordsEqual("same", "different-length"), false);
  assert.equal(passwordsEqual("", "x"), false);
});
