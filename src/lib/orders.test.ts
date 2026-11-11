import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  ORDER_STATUSES,
  isOrderStatus,
  canTransition,
  assertTransition,
  nextStatuses,
  acceptsPaymentProof,
  HELD_STATUSES,
  carriesDeadline,
  PISH_FACTOR_TTL_HOURS,
  QUOTE_TTL_DAYS,
} from "./orders";

test("the vocabulary is exactly the eight agreed statuses", () => {
  assert.deepEqual([...ORDER_STATUSES], [
    "received",
    "quoted",
    "invoiced",
    "payment_review",
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

test("a quote sits between a request and its pish-factor, and a pish-factor may skip it", () => {
  // Checkout (or staff accepting by phone) issues the pish-factor straight
  // from `received`; a priced quote waits for the customer in `quoted`.
  assert.deepEqual([...nextStatuses("received")], ["quoted", "invoiced", "cancelled"]);
  assert.deepEqual([...nextStatuses("quoted")], ["invoiced", "cancelled"]);
  assert.equal(canTransition("received", "quoted"), true);
  assert.equal(canTransition("quoted", "invoiced"), true);
  // A quote is not payable: no receipt, no payment, no going back.
  assert.equal(canTransition("quoted", "payment_review"), false);
  assert.equal(canTransition("quoted", "preparing"), false);
  assert.equal(canTransition("quoted", "received"), false);
  assert.equal(canTransition("invoiced", "quoted"), false);
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

test("cancelling is allowed until payment is confirmed, and not after", () => {
  assert.equal(canTransition("received", "cancelled"), true);
  assert.equal(canTransition("quoted", "cancelled"), true);
  assert.equal(canTransition("invoiced", "cancelled"), true);
  assert.equal(canTransition("payment_review", "cancelled"), true);
  // Paid: no refund flow exists yet, so no cancellation (review M-10).
  assert.equal(canTransition("preparing", "cancelled"), false);
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

test("a receipt moves an invoice to review, and only confirmation leaves review", () => {
  assert.equal(canTransition("invoiced", "payment_review"), true);
  assert.equal(canTransition("payment_review", "preparing"), true);
  // No reject: a receipt that does not match is settled by phone or cancelled.
  assert.equal(canTransition("payment_review", "invoiced"), false);
  assert.equal(canTransition("received", "payment_review"), false);
  assert.equal(canTransition("payment_review", "shipped"), false);
  // The admin may still confirm a payment made without an upload.
  assert.equal(canTransition("invoiced", "preparing"), true);
});

test("receipts are accepted while payment is owed or being checked, and never after", () => {
  assert.deepEqual(
    ORDER_STATUSES.filter(acceptsPaymentProof),
    ["invoiced", "payment_review"],
  );
});

test("held statuses include a quote, and deadlines sit on the open ones", () => {
  assert.deepEqual([...HELD_STATUSES], ["received", "quoted", "invoiced", "payment_review"]);
  assert.deepEqual(ORDER_STATUSES.filter(carriesDeadline), ["received", "quoted", "invoiced"]);
  assert.equal(PISH_FACTOR_TTL_HOURS, 24);
  assert.equal(QUOTE_TTL_DAYS, 5);
});

test("no query spells out the held statuses itself", () => {
  // Review L-23: the list lives in HELD_STATUSES and reaches SQL as a
  // parameter. A literal copy is the one a new held status would miss.
  const dir = "src/db";
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(`${dir}/${name}`, "utf8");
    assert.doesNotMatch(
      source,
      /status IN \('received',\s*('quoted',\s*)?'invoiced',\s*'payment_review'\)/,
      `${name} hard-codes the held statuses`,
    );
  }
});
