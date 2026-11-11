import { test } from "node:test";
import assert from "node:assert/strict";
import { hashLoginCode, loginCodeMatches, newLoginCode, normalizeLoginCode } from "./loginCode";

const USER = "8b7f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";

test("a new code is six digits", () => {
  for (let i = 0; i < 50; i++) assert.match(newLoginCode(), /^[0-9]{6}$/);
});

test("codes typed with Persian digits, spaces or a dash are accepted", () => {
  assert.equal(normalizeLoginCode("۴۸۲۹۱۳"), "482913");
  assert.equal(normalizeLoginCode(" 482 913 "), "482913");
  assert.equal(normalizeLoginCode("482-913"), "482913");
  assert.equal(normalizeLoginCode("48291"), null);
  assert.equal(normalizeLoginCode("4829134"), null);
  assert.equal(normalizeLoginCode("48291a"), null);
});

test("a code matches only its own account and secret", () => {
  const hash = hashLoginCode(USER, "482913", "secret");
  assert.equal(loginCodeMatches(USER, "482913", hash, "secret"), true);
  assert.equal(loginCodeMatches(USER, "482914", hash, "secret"), false);
  assert.equal(loginCodeMatches(USER.replace("8b", "9b"), "482913", hash, "secret"), false);
  assert.equal(loginCodeMatches(USER, "482913", hash, "other"), false);
  assert.equal(loginCodeMatches(USER, "482913", "not-a-hash", "secret"), false);
});
