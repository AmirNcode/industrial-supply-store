/**
 * What a cart turns into at checkout, in one place.
 *
 * Each line is cut three ways by the shelf and the price:
 *   payNow       — priced and on the shelf: goes on a pish-factor at once
 *   heldForQuote — on the shelf but with no list price: stock is held while
 *                  staff price it
 *   backorder    — more than the shelf holds, or a product bought from a
 *                  supplier after the sale: no stock to hold, staff confirm
 *                  price and lead time
 *
 * The checkout page draws this split and signs it into the submission token;
 * the order transaction recomputes it under row locks and refuses to write if
 * it moved, so a customer never gets a pish-factor for stock someone else took
 * in between. No database imports, so the rules are testable here.
 */

export type SplitInput = {
  productId: number;
  qty: number;
  /** Unit price at the line's full quantity; 0 is "call for price". */
  unitPriceCents: number;
  /** `products.in_stock`: kept on the shelf at all, as opposed to bought to order. */
  inStock: boolean;
  /** `products.inventory_available`, which can be negative; never trusted below 0. */
  available: number;
};

export type LineSplit = SplitInput & { payNow: number; heldForQuote: number; backorder: number };

export function splitLine(line: SplitInput): LineSplit {
  const onShelf = line.inStock ? Math.max(0, Math.min(line.qty, Math.trunc(line.available))) : 0;
  const priced = line.unitPriceCents > 0;
  return {
    ...line,
    payNow: priced ? onShelf : 0,
    heldForQuote: priced ? 0 : onShelf,
    backorder: line.qty - onShelf,
  };
}

/**
 * instant — every unit is payable now: one order, pish-factor at once.
 * quote   — nothing is payable now: one order waiting for staff.
 * mixed   — some of each: the customer chooses to split or to wait.
 */
export type CartKind = "instant" | "quote" | "mixed";

export type CartSplit = {
  kind: CartKind;
  lines: LineSplit[];
  /** Pre-VAT total of the units payable now. */
  payNowCents: number;
  /** Pre-VAT list total of the priced units waiting on a quote; unpriced units add nothing. */
  quoteListCents: number;
  /** True when a waiting unit has no price at all, so `quoteListCents` is not the whole story. */
  quoteHasUnpriced: boolean;
};

export function splitCart(input: readonly SplitInput[]): CartSplit {
  const lines = input.map(splitLine);
  let payNowCents = 0;
  let quoteListCents = 0;
  let waiting = 0;
  let payable = 0;
  let quoteHasUnpriced = false;
  for (const line of lines) {
    payable += line.payNow;
    waiting += line.heldForQuote + line.backorder;
    payNowCents += line.payNow * line.unitPriceCents;
    quoteListCents += (line.heldForQuote + line.backorder) * line.unitPriceCents;
    if (line.unitPriceCents <= 0 && line.heldForQuote + line.backorder > 0) quoteHasUnpriced = true;
  }
  const kind: CartKind = waiting === 0 ? "instant" : payable === 0 ? "quote" : "mixed";
  return { kind, lines, payNowCents, quoteListCents, quoteHasUnpriced };
}

/** How a mixed cart is placed: two orders (pay now + quote), or one that waits. */
export type CheckoutMode = "split" | "together";

export function parseCheckoutMode(value: unknown): CheckoutMode {
  return value === "together" ? "together" : "split";
}

export type PlannedItem = { productId: number; qty: number; unitPriceCents: number; backorder: boolean };
export type PlannedOrder = { pishFactor: boolean; items: PlannedItem[] };

/**
 * The orders to write. `canIssue` is false when no pish-factor may be issued
 * at all (no exchange rate or seller details configured): everything then
 * waits for staff as one order, as it did before instant checkout.
 */
export function planOrders(split: CartSplit, mode: CheckoutMode, canIssue: boolean): PlannedOrder[] {
  const now: PlannedItem[] = [];
  const later: PlannedItem[] = [];
  for (const line of split.lines) {
    const base = { productId: line.productId, unitPriceCents: line.unitPriceCents };
    if (line.payNow > 0) now.push({ ...base, qty: line.payNow, backorder: false });
    if (line.heldForQuote > 0) later.push({ ...base, qty: line.heldForQuote, backorder: false });
    if (line.backorder > 0) later.push({ ...base, qty: line.backorder, backorder: true });
  }
  if (later.length === 0) return [{ pishFactor: canIssue, items: now }];
  if (now.length === 0) return [{ pishFactor: false, items: later }];
  if (mode === "split" && canIssue) {
    return [
      { pishFactor: true, items: now },
      { pishFactor: false, items: later },
    ];
  }
  return [{ pishFactor: false, items: [...now, ...later] }];
}
