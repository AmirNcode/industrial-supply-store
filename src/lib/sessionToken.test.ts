import { test } from "node:test";
import assert from "node:assert/strict";
import { signSessionToken, verifySessionToken, SESSION_TTL_MS } from "./sessionToken";

const SECRET = "test-secret-not-a-real-one";
const USER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = 1_760_000_000_000;

test("a token this secret signed verifies and yields the user id", () => {
  const token = signSessionToken(USER, NOW + SESSION_TTL_MS, SECRET);
  assert.equal(verifySessionToken(token, SECRET, NOW), USER);
});

test("a token another secret signed does not verify", () => {
  // This is the whole security property: the cookie is unforgeable only
  // because the signature depends on a secret the client never sees.
  const token = signSessionToken(USER, NOW + SESSION_TTL_MS, "a different secret");
  assert.equal(verifySessionToken(token, SECRET, NOW), null);
});

test("editing the user id invalidates the signature", () => {
  const token = signSessionToken(USER, NOW + SESSION_TTL_MS, SECRET);
  const [, exp, sig] = token.split(".");
  const forged = ["11111111-2222-3333-4444-555555555555", exp, sig].join(".");
  assert.equal(verifySessionToken(forged, SECRET, NOW), null);
});

test("extending the expiry invalidates the signature", () => {
  const token = signSessionToken(USER, NOW + 1000, SECRET);
  const [id, , sig] = token.split(".");
  const forged = [id, String(NOW + 99_999_999), sig].join(".");
  assert.equal(verifySessionToken(forged, SECRET, NOW), null);
});

test("an expired token does not verify even though it is correctly signed", () => {
  const token = signSessionToken(USER, NOW - 1, SECRET);
  assert.equal(verifySessionToken(token, SECRET, NOW), null);
});

test("a correctly signed token with a malformed user id does not verify", () => {
  const token = signSessionToken("not-a-uuid", NOW + SESSION_TTL_MS, SECRET);
  assert.equal(verifySessionToken(token, SECRET, NOW), null);
});

test("garbage does not verify and does not throw", () => {
  assert.equal(verifySessionToken("", SECRET, NOW), null);
  assert.equal(verifySessionToken("a.b", SECRET, NOW), null);
  assert.equal(verifySessionToken("a.b.c.d", SECRET, NOW), null);
  assert.equal(verifySessionToken("a.notanumber.c", SECRET, NOW), null);
});
