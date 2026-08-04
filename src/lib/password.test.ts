import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./password";

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
