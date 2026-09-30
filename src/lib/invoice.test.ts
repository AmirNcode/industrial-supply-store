import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatOrderTotal,
  invoiceAmounts,
  lineTotalCents,
  roundedForDisplay,
  subtotalCents,
  MAX_ORDER_CENTS,
  exceedsOrderLimit,
} from "./invoice";
import { formatPrice, formatPriceExact } from "./money";

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

test("VAT on a dollar invoice is taken in cents, rounded half up", () => {
  assert.deepEqual(invoiceAmounts(1155, 1000, "USD", 1_094_889), {
    subtotal: 1155,
    vat: 116,
    total: 1271,
  });
});

test("VAT on a rial invoice is taken from the rial subtotal as printed", () => {
  // Taking 116 cents of VAT and converting would print 1,270,071 — 10% of
  // the printed subtotal is 1,264,597.
  assert.deepEqual(invoiceAmounts(1155, 1000, "IRR", 1_094_889), {
    subtotal: 12_645_968,
    vat: 1_264_597,
    total: 13_910_565,
  });
});

test("no VAT is a zero line, not a missing one", () => {
  assert.deepEqual(invoiceAmounts(1155, 0, "IRR", 1_094_889), {
    subtotal: 12_645_968,
    vat: 0,
    total: 12_645_968,
  });
});

test("a very large order keeps every rial", () => {
  // subtotal × 1,000 bp passes 2^53 here; floating point would drop digits.
  const amounts = invoiceAmounts(2_000_000_001, 1000, "IRR", 2_346_151);
  assert.deepEqual(amounts, {
    subtotal: 46_923_020_023_462,
    vat: 4_692_302_002_346,
    total: 51_615_322_025_808,
  });
  assert.equal(Number.isSafeInteger(amounts.total), true);
});

test("rounded for the order pages, the rows still add up", () => {
  const rounded = roundedForDisplay(invoiceAmounts(1155, 1000, "IRR", 1_094_889), "IRR");
  assert.deepEqual(rounded, { subtotal: 12_646_000, vat: 1_265_000, total: 13_911_000 });
  assert.equal(rounded.subtotal + rounded.vat, rounded.total);
  const usd = invoiceAmounts(1155, 1000, "USD", 1);
  assert.deepEqual(roundedForDisplay(usd, "USD"), usd);
});

test("a list shows VAT only on invoices that carry a rate", () => {
  // Not invoiced yet, or invoiced before VAT existed: exactly as before.
  assert.equal(formatOrderTotal(1155, null, "IRR", "en", 1_094_889), formatPrice(1155, "IRR", "en", 1_094_889));
  assert.equal(formatOrderTotal(1155, 1000, "IRR", "en", 1_094_889), "13,911,000 IRR");
  assert.equal(formatOrderTotal(1155, 1000, "USD", "en", 1_094_889), "$12.71");
});

test("an order total past a Postgres integer is flagged", () => {
  assert.equal(exceedsOrderLimit(MAX_ORDER_CENTS), false);
  assert.equal(exceedsOrderLimit(MAX_ORDER_CENTS + 1), true);
  assert.equal(exceedsOrderLimit(50_000 * 99_999), true);
  assert.equal(exceedsOrderLimit(Number.NaN), true);
});
