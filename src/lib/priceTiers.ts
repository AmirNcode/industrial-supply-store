/**
 * Quantity breaks, read against the product's own price.
 *
 * `products.price_cents` is the price. It is what the CSV import, the admin
 * product table and "Add a product" write, and what the admin sees. The
 * seeded `price_tiers` start with a `minQty: 1` rung that merely copied it,
 * and nothing ever rewrote that copy — so a price edit showed in admin while
 * the storefront, cart, checkout and invoices kept charging the stale rung
 * (review finding H-1). A rung at 1 is therefore never read: the price is
 * `price_cents`, and only breaks above one unit come from the tiers. Writes
 * that change the price also clear the tiers (`writeImport`), so a stale bulk
 * price cannot outlive the price it was a discount on.
 *
 * No database imports, so the rules are testable here.
 */
import type { PriceTier } from "@/db/schema";

/** The breaks above one unit, in quantity order, whatever order they were stored in. */
function breaks(tiers: readonly PriceTier[]): PriceTier[] {
  return tiers.filter((tier) => tier.minQty > 1).sort((a, b) => a.minQty - b.minQty);
}

/**
 * Unit price at a quantity: the break with the highest `minQty` at or below
 * it, else the product's price.
 */
export function unitPriceAt(line: { priceCents: number; priceTiers: readonly PriceTier[] }, qty: number): number {
  let price = line.priceCents;
  for (const tier of breaks(line.priceTiers)) {
    if (qty >= tier.minQty) price = tier.priceCents;
  }
  return price;
}

/**
 * The ladder to print: the price from one unit, then each break. Empty when
 * there are no breaks, so a single price is not dressed up as a table.
 */
export function priceLadder(priceCents: number, tiers: readonly PriceTier[]): PriceTier[] {
  const above = breaks(tiers);
  return above.length > 0 ? [{ minQty: 1, priceCents }, ...above] : [];
}
