import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRepPassword, repPasswordProblems } from "./repPassword";

test("a password meeting every rule has no problems", () => {
  assert.deepEqual(repPasswordProblems("Abcdef1!"), []);
});

test("each missing rule is reported, all at once", () => {
  assert.deepEqual(repPasswordProblems("abcdef1!"), ["uppercase"]);
  assert.deepEqual(repPasswordProblems("Abcdefg!"), ["digit"]);
  assert.deepEqual(repPasswordProblems("Abcdefg1"), ["special"]);
  assert.deepEqual(repPasswordProblems("Ab1!"), ["short"]);
  assert.deepEqual(repPasswordProblems("abc"), ["short", "uppercase", "digit", "special"]);
});

test("Persian digits count as numbers, and are the same password as ASCII ones", () => {
  assert.deepEqual(repPasswordProblems("Tehran۱۴۰۵!"), []);
  assert.equal(normalizeRepPassword("Tehran۱۴۰۵!"), "Tehran1405!");
});

test("a Persian letter or a space is not a special character", () => {
  assert.deepEqual(repPasswordProblems("Aسلام1234"), ["special"]);
  assert.deepEqual(repPasswordProblems("Abc def12"), ["special"]);
});
