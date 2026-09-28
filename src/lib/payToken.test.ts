import { test } from "node:test";
import assert from "node:assert/strict";
import { isPayToken, payTokensEqual } from "./payToken";

const TOKEN = "a".repeat(32) + "0123456789abcdef".repeat(2);

test("only the exact shape the database stores is a pay token", () => {
  assert.equal(isPayToken(TOKEN), true);
  assert.equal(isPayToken(TOKEN.toUpperCase()), false);
  assert.equal(isPayToken(TOKEN.slice(1)), false);
  assert.equal(isPayToken(`${TOKEN}0`), false);
  assert.equal(isPayToken("../../etc/passwd"), false);
});

test("comparison is exact and never throws on different lengths", () => {
  assert.equal(payTokensEqual(TOKEN, TOKEN), true);
  assert.equal(payTokensEqual(TOKEN, `${TOKEN.slice(0, -1)}0`), false);
  assert.equal(payTokensEqual(TOKEN, "short"), false);
});
