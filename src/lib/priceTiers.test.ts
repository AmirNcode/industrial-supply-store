import { test } from "node:test";
import assert from "node:assert/strict";
import { priceLadder, unitPriceAt } from "./priceTiers";

test("the product's price wins over a stale one-unit rung", () => {
  // Seeded tiers copied price_cents into a minQty-1 rung; the admin has since
  // raised the price from $1.00 to $2.00 and nothing rewrote the copy.
  const line = { priceCents: 200, priceTiers: [{ minQty: 1, priceCents: 100 }, { minQty: 10, priceCents: 90 }] };
  assert.equal(unitPriceAt(line, 1), 200);
  assert.equal(unitPriceAt(line, 9), 200);
  assert.equal(unitPriceAt(line, 10), 90);
  assert.deepEqual(priceLadder(200, line.priceTiers), [
    { minQty: 1, priceCents: 200 },
    { minQty: 10, priceCents: 90 },
  ]);
});

test("the highest break at or below the quantity applies, in any stored order", () => {
  const line = {
    priceCents: 500,
    priceTiers: [{ minQty: 100, priceCents: 300 }, { minQty: 10, priceCents: 400 }],
  };
  assert.equal(unitPriceAt(line, 50), 400);
  assert.equal(unitPriceAt(line, 100), 300);
  assert.equal(unitPriceAt(line, 5000), 300);
  assert.deepEqual(priceLadder(500, line.priceTiers).map((tier) => tier.minQty), [1, 10, 100]);
});

test("no breaks means one price and no ladder", () => {
  assert.equal(unitPriceAt({ priceCents: 750, priceTiers: [] }, 40), 750);
  assert.deepEqual(priceLadder(750, []), []);
  assert.deepEqual(priceLadder(750, [{ minQty: 1, priceCents: 700 }]), []);
});
