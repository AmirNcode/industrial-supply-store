import { test } from "node:test";
import assert from "node:assert/strict";
import { REP_SESSION_TTL_MS, signRepSessionToken, verifyRepSessionToken } from "./repSessionToken";
import { signSessionToken, verifySessionToken } from "./sessionToken";

const SECRET = "test-secret-not-a-real-one";
const REP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = 1_760_000_000_000;

test("a rep token verifies and yields the rep id and session version", () => {
  const token = signRepSessionToken(REP, 3, NOW + REP_SESSION_TTL_MS, SECRET);
  assert.deepEqual(verifyRepSessionToken(token, SECRET, NOW), { repId: REP, version: 3 });
});

test("a token another secret signed does not verify", () => {
  const token = signRepSessionToken(REP, 1, NOW + 1000, "another secret");
  assert.equal(verifyRepSessionToken(token, SECRET, NOW), null);
});

test("raising the version by hand invalidates the signature", () => {
  const parts = signRepSessionToken(REP, 1, NOW + 1000, SECRET).split(".");
  parts[2] = "2";
  assert.equal(verifyRepSessionToken(parts.join("."), SECRET, NOW), null);
});

test("an expired token does not verify", () => {
  assert.equal(verifyRepSessionToken(signRepSessionToken(REP, 1, NOW - 1, SECRET), SECRET, NOW), null);
});

test("a customer session token never verifies as a rep token", () => {
  const customer = signSessionToken(REP, NOW + 1000, SECRET);
  assert.equal(verifyRepSessionToken(customer, SECRET, NOW), null);
});

test("a rep token never verifies as a customer session", () => {
  const rep = signRepSessionToken(REP, 1, NOW + 1000, SECRET);
  assert.equal(verifySessionToken(rep, SECRET, NOW), null);
});

test("garbage does not verify and does not throw", () => {
  for (const junk of [
    "",
    "v1",
    "v1.a.b.c.d",
    `v2.${REP}.1.${NOW + 1000}.x`,
    `v1.${REP}.0.${NOW + 1000}.x`,
    `v1.${REP}.1.5.${NOW + 1000}.x`,
  ]) {
    assert.equal(verifyRepSessionToken(junk, SECRET, NOW), null);
  }
});
