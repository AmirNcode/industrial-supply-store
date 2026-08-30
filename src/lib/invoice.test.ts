import { test } from "node:test";
import assert from "node:assert/strict";
import { lineTotalCents, subtotalCents } from "./invoice";
import { formatPriceExact } from "./money";

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

/** Persian digits back to a plain number, so two rendered figures can be compared. */
function digits(s: string): number {
  const FA = "۰۱۲۳۴۵۶۷۸۹";
  let out = "";
  for (const ch of s) {
    const i = FA.indexOf(ch);
    if (i !== -1) out += String(i);
    else if (ch >= "0" && ch <= "9") out += ch;
  }
  return Number(out);
}

test("on an invoice, the Persian Rial line totals add up to the printed total", () => {
  // The catalog formatter rounds to the nearest thousand Rial. The invoice
  // formatter keeps whole-Rial precision so the printed arithmetic closes.
  const rate = 1_450_000;
  const lines = [
    { qty: 1, unitPriceCents: 33 },
    { qty: 1, unitPriceCents: 33 },
    { qty: 1, unitPriceCents: 33 },
  ];
  const lineSum = lines.reduce(
    (n, l) => n + digits(formatPriceExact(lineTotalCents(l), "IRR", "fa", rate)),
    0,
  );
  assert.equal(
    digits(formatPriceExact(subtotalCents(lines), "IRR", "fa", rate)),
    lineSum,
  );
});
