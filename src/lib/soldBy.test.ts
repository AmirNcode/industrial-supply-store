import { test } from "node:test";
import assert from "node:assert/strict";
import { displayPackQty, isSoldBy } from "./soldBy";

test("a unit family shows every product as a single item", () => {
  assert.equal(displayPackQty("unit", 50), 1);
  assert.equal(displayPackQty("package", 50), 50);
  assert.equal(displayPackQty("package", 1), 1);
});

test("only the two stored values are accepted", () => {
  assert.ok(isSoldBy("package"));
  assert.ok(isSoldBy("unit"));
  assert.ok(!isSoldBy("pack"));
  assert.ok(!isSoldBy(""));
});
