import { test } from "node:test";
import assert from "node:assert/strict";
import { draftLinePrices, draftQuery, parsePriceDollars, priceParamValue } from "./invoiceDraft";

test("a typed price becomes whole cents, rounded once", () => {
  assert.equal(parsePriceDollars("12.50"), 1250);
  assert.equal(parsePriceDollars(" 0 "), 0);
  assert.equal(parsePriceDollars("0.333"), 33);
  assert.equal(parsePriceDollars("19.99"), 1999);
});

test("a price that cannot be a price is refused", () => {
  assert.equal(parsePriceDollars(""), null);
  assert.equal(parsePriceDollars("-1"), null);
  assert.equal(parsePriceDollars("abc"), null);
  assert.equal(parsePriceDollars("Infinity"), null);
  assert.equal(parsePriceDollars("30000000"), null);
  assert.equal(parsePriceDollars(["1", "2"]), null);
  assert.equal(parsePriceDollars(undefined), null);
});

test("the draft takes the typed price where there is one and the line's own price otherwise", () => {
  const lines = [
    { id: 7, unitPriceCents: 500 },
    { id: 8, unitPriceCents: 900 },
  ];
  assert.deepEqual([...draftLinePrices({ price_7: "4.25" }, lines)!], [[7, 425], [8, 900]]);
  assert.deepEqual([...draftLinePrices({}, lines)!], [[7, 500], [8, 900]]);
  assert.equal(draftLinePrices({ price_8: "-3" }, lines), null);
});

test("prices round-trip through the draft's URL unchanged", () => {
  const prices = new Map([[7, 425], [8, 1999]]);
  const query = Object.fromEntries(new URLSearchParams(draftQuery(prices, { statusFilter: "", cur: "USD" })));
  assert.deepEqual(query, { price_7: "4.25", price_8: "19.99", cur: "USD" });
  const lines = [{ id: 7, unitPriceCents: 0 }, { id: 8, unitPriceCents: 0 }];
  assert.deepEqual(draftLinePrices(query, lines), prices);
  assert.equal(priceParamValue(1), "0.01");
});
