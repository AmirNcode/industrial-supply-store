import { test } from "node:test";
import assert from "node:assert/strict";
import { DUMMY_PASSWORD_HASH, hashPassword, needsRehash, verifyPassword, MIN_PASSWORD_LENGTH } from "./password";

test("a hash verifies against the password that made it", async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
});

test("a wrong password does not verify", async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("Correct horse battery staple", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("the same password hashes differently every time", async () => {
  // Without a per-hash salt, identical passwords produce identical rows and a
  // stolen dump tells you which users share one.
  const a = await hashPassword("same password");
  const b = await hashPassword("same password");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same password", a), true);
  assert.equal(await verifyPassword("same password", b), true);
});

test("the stored form records its own parameters", async () => {
  // So raising the cost later does not invalidate existing hashes: an old row
  // verifies with the numbers it was written with.
  const stored = await hashPassword("whatever");
  const parts = stored.split("$");
  assert.equal(parts[0], "scrypt");
  assert.equal(parts.length, 6);
});

test("a malformed stored hash fails rather than throwing", async () => {
  // A truncated or hand-edited column must read as "no match", not crash the
  // sign-in route.
  assert.equal(await verifyPassword("x", ""), false);
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  assert.equal(await verifyPassword("x", "scrypt$16384$8$1$onlyfourparts"), false);
  assert.equal(await verifyPassword("x", "argon2$1$2$3$4$5"), false);
  assert.equal(await verifyPassword("x", "scrypt$notanumber$8$1$c2FsdA==$aGFzaA=="), false);
});

test("the minimum length is stated once, for the form and the action to share", () => {
  assert.equal(typeof MIN_PASSWORD_LENGTH, "number");
  assert.ok(MIN_PASSWORD_LENGTH >= 8);
});

test("new hashes use the current cost; older ones verify and are flagged for rehash", async () => {
  // Review L-12: N raised from 2^14 to 2^17.
  const stored = await hashPassword("pw-now");
  assert.equal(stored.split("$")[1], "131072");
  assert.equal(needsRehash(stored), false);
  // A hash written before the change (N = 2^14) still verifies.
  const { scryptSync } = await import("node:crypto");
  const salt = Buffer.alloc(16, 7);
  const old = ["scrypt", 16384, 8, 1, salt.toString("base64"),
    scryptSync("pw-then", salt, 64, { N: 16384, r: 8, p: 1 }).toString("base64")].join("$");
  assert.equal(await verifyPassword("pw-then", old), true);
  assert.equal(needsRehash(old), true);
  // A planted hash demanding absurd memory is refused, not computed.
  assert.equal(await verifyPassword("x", `scrypt$1048576$8$1$${salt.toString("base64")}$${"A".repeat(88)}`), false);
});

test("a wrong password costs the same against an old hash as against an unknown login", async () => {
  // Security review of L-12: unknown logins verify against the dummy at 2^17,
  // an account not yet rehashed verified at 2^14 — eight times faster, which
  // told anyone timing the form that the account exists. Unpadded the ratio
  // is about 0.13; padded it is about 1. The 0.6 bar leaves room for noise.
  const { scryptSync } = await import("node:crypto");
  const salt = Buffer.alloc(16, 9);
  const old = ["scrypt", 16384, 8, 1, salt.toString("base64"),
    scryptSync("right", salt, 64, { N: 16384, r: 8, p: 1 }).toString("base64")].join("$");
  const time = async (stored: string) => {
    const start = performance.now();
    assert.equal(await verifyPassword("wrong", stored), false);
    return performance.now() - start;
  };
  await time(DUMMY_PASSWORD_HASH); // warm up
  const unknown = Math.min(await time(DUMMY_PASSWORD_HASH), await time(DUMMY_PASSWORD_HASH));
  const oldAccount = Math.min(await time(old), await time(old));
  assert.ok(oldAccount / unknown > 0.6, `old ${oldAccount.toFixed(0)} ms vs unknown ${unknown.toFixed(0)} ms`);
});
