import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_STATUSES,
  isOrderStatus,
  canTransition,
  assertTransition,
  nextStatuses,
} from "./orders";

test("the vocabulary is exactly the six agreed statuses", () => {
  assert.deepEqual([...ORDER_STATUSES], [
    "received",
    "invoiced",
    "preparing",
    "shipped",
    "delivered",
    "cancelled",
  ]);
});

test("isOrderStatus narrows only known values", () => {
  assert.equal(isOrderStatus("received"), true);
  assert.equal(isOrderStatus("submitted"), false);
  assert.equal(isOrderStatus(""), false);
});

test("the happy path moves forward one step at a time", () => {
  assert.equal(canTransition("received", "invoiced"), true);
  assert.equal(canTransition("invoiced", "preparing"), true);
  assert.equal(canTransition("preparing", "shipped"), true);
  assert.equal(canTransition("shipped", "delivered"), true);
});

test("skipping a step is refused", () => {
  assert.equal(canTransition("received", "shipped"), false);
  assert.equal(canTransition("received", "delivered"), false);
  assert.equal(canTransition("invoiced", "shipped"), false);
});

test("going backwards is refused", () => {
  assert.equal(canTransition("shipped", "preparing"), false);
  assert.equal(canTransition("delivered", "shipped"), false);
});

test("cancelling is allowed before shipping and not after", () => {
  assert.equal(canTransition("received", "cancelled"), true);
  assert.equal(canTransition("invoiced", "cancelled"), true);
  assert.equal(canTransition("preparing", "cancelled"), true);
  assert.equal(canTransition("shipped", "cancelled"), false);
});

test("terminal statuses cannot move", () => {
  assert.deepEqual([...nextStatuses("delivered")], []);
  assert.deepEqual([...nextStatuses("cancelled")], []);
});

test("a status cannot transition to itself", () => {
  for (const s of ORDER_STATUSES) {
    assert.equal(canTransition(s, s), false, `${s} → ${s} should be refused`);
  }
});

test("assertTransition throws with both statuses named", () => {
  assert.throws(
    () => assertTransition("received", "delivered"),
    /received.*delivered/,
  );
  assert.doesNotThrow(() => assertTransition("received", "invoiced"));
});
