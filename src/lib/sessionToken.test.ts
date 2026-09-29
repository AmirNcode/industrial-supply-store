import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signSessionToken, verifySessionToken, SESSION_TTL_MS } from "./sessionToken";

const SECRET = "test-secret-not-a-real-one";
const USER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = 1_760_000_000_000;

test("a token this secret signed verifies and yields the user id", () => {
  const token = signSessionToken(USER, NOW + SESSION_TTL_MS, SECRET, 3);
  assert.deepEqual(verifySessionToken(token, SECRET, NOW), { userId: USER, version: 3 });
});

test("a token another secret signed does not verify", () => {
  // This is the whole security property: the cookie is unforgeable only
  // because the signature depends on a secret the client never sees.
  const token = signSessionToken(USER, NOW + SESSION_TTL_MS, "a different secret");
  assert.equal(verifySessionToken(token, SECRET, NOW), null);
});

test("editing the user id invalidates the signature", () => {
  const token = signSessionToken(USER, NOW + SESSION_TTL_MS, SECRET);
  const [, version, exp, sig] = token.split(".");
  const forged = ["11111111-2222-3333-4444-555555555555", version, exp, sig].join(".");
  assert.equal(verifySessionToken(forged, SECRET, NOW), null);
});

test("extending the expiry invalidates the signature", () => {
  const token = signSessionToken(USER, NOW + 1000, SECRET);
  const [id, version, , sig] = token.split(".");
  const forged = [id, version, String(NOW + 99_999_999), sig].join(".");
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
  assert.equal(verifySessionToken("a.b.c.d.e", SECRET, NOW), null);
  assert.equal(verifySessionToken("a.notanumber.c", SECRET, NOW), null);
});

test("raising the version in a signed token invalidates it", () => {
  const token = signSessionToken(USER, NOW + SESSION_TTL_MS, SECRET, 1);
  const [id, , exp, sig] = token.split(".");
  assert.equal(verifySessionToken([id, "2", exp, sig].join("."), SECRET, NOW), null);
});

test("a cookie from before versions existed reads as version 1", () => {
  // The pre-M-2 shape: userId.expiry.signature over "userId.expiry".
  const payload = `${USER}.${NOW + 1000}`;
  const legacy = `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
  assert.deepEqual(verifySessionToken(legacy, SECRET, NOW), { userId: USER, version: 1 });
});
