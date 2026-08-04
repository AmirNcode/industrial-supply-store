import { test } from "node:test";
import assert from "node:assert/strict";
import { lineTotalCents, subtotalCents } from "./invoice";

test("a line total is unit price times quantity, in cents", () => {
  assert.equal(lineTotalCents({ qty: 5, unitPriceCents: 50 }), 250);
  assert.equal(lineTotalCents({ qty: 1, unitPriceCents: 35 }), 35);
});

test("a zero-priced line is a legitimate zero, not a missing value", () => {
  assert.equal(lineTotalCents({ qty: 10, unitPriceCents: 0 }), 0);
});

test("a subtotal sums every line", () => {
  assert.equal(
    subtotalCents([
      { qty: 5, unitPriceCents: 50 },
      { qty: 2, unitPriceCents: 125 },
    ]),
    500,
  );
});

test("an empty invoice subtotals to zero rather than NaN", () => {
  assert.equal(subtotalCents([]), 0);
});

test("totals stay integers — no floating point creeps in", () => {
  // 3 x 33 cents is where a naive (price/100)*qty*100 round-trips to 98.999…
  const total = subtotalCents([{ qty: 3, unitPriceCents: 33 }]);
  assert.equal(total, 99);
  assert.equal(Number.isInteger(total), true);
});
