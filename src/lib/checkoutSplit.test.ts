import { test } from "node:test";
import assert from "node:assert/strict";
import { planOrders, splitCart, splitLine } from "./checkoutSplit";

const line = (over: Partial<Parameters<typeof splitLine>[0]> = {}) => ({
  productId: 1,
  qty: 10,
  unitPriceCents: 500,
  inStock: true,
  available: 100,
  ...over,
});

test("a priced line within the shelf is all payable now", () => {
  const s = splitLine(line());
  assert.deepEqual([s.payNow, s.heldForQuote, s.backorder], [10, 0, 0]);
});

test("more than the shelf holds puts the extra on back order", () => {
  const s = splitLine(line({ qty: 50, available: 3 }));
  assert.deepEqual([s.payNow, s.heldForQuote, s.backorder], [3, 0, 47]);
});

test("an unpriced line on the shelf is held for a quote, never payable", () => {
  const s = splitLine(line({ unitPriceCents: 0, qty: 5, available: 2 }));
  assert.deepEqual([s.payNow, s.heldForQuote, s.backorder], [0, 2, 3]);
});

test("a supplier item is all back order whatever its count says", () => {
  const s = splitLine(line({ inStock: false, available: 999 }));
  assert.deepEqual([s.payNow, s.heldForQuote, s.backorder], [0, 0, 10]);
});

test("a negative shelf count is treated as empty", () => {
  const s = splitLine(line({ available: -4 }));
  assert.deepEqual([s.payNow, s.backorder], [0, 10]);
});

test("cart kinds and totals", () => {
  assert.equal(splitCart([line()]).kind, "instant");
  assert.equal(splitCart([line({ inStock: false })]).kind, "quote");
  const mixed = splitCart([line({ qty: 50, available: 3 }), line({ productId: 2, unitPriceCents: 0, qty: 1 })]);
  assert.equal(mixed.kind, "mixed");
  assert.equal(mixed.payNowCents, 1500);
  assert.equal(mixed.quoteListCents, 47 * 500);
  assert.equal(mixed.quoteHasUnpriced, true);
});

test("an instant cart is one pish-factor order", () => {
  const plan = planOrders(splitCart([line()]), "split", true);
  assert.deepEqual(plan, [{ pishFactor: true, items: [{ productId: 1, qty: 10, unitPriceCents: 500, backorder: false }] }]);
});

test("a mixed cart splits into a pish-factor and a quote order", () => {
  const plan = planOrders(splitCart([line({ qty: 50, available: 3 })]), "split", true);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan[0], { pishFactor: true, items: [{ productId: 1, qty: 3, unitPriceCents: 500, backorder: false }] });
  assert.deepEqual(plan[1], { pishFactor: false, items: [{ productId: 1, qty: 47, unitPriceCents: 500, backorder: true }] });
});

test("waiting for everything is one order holding the shelf part", () => {
  const plan = planOrders(splitCart([line({ qty: 50, available: 3 })]), "together", true);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].pishFactor, false);
  assert.deepEqual(plan[0].items.map((i) => [i.qty, i.backorder]), [[3, false], [47, true]]);
});

test("with no rate to lock, nothing is issued and nothing is split", () => {
  assert.deepEqual(planOrders(splitCart([line()]), "split", false).map((o) => o.pishFactor), [false]);
  assert.equal(planOrders(splitCart([line({ qty: 50, available: 3 })]), "split", false).length, 1);
});
