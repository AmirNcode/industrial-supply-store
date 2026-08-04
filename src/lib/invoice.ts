/**
 * Invoice arithmetic, kept free of imports so it can be tested without a
 * database or a renderer.
 *
 * Everything is integer cents. The invoice is the one document in this system
 * a customer may hold us to, so its totals are computed the same way twice —
 * here, and by the SQL that set `orders.total_cents` when the invoice was
 * issued. If those two ever disagree, the page is wrong and the disagreement
 * should be visible rather than rounded away.
 */

/**
 * Both fields are integers by construction, not by assertion: they come from
 * `order_items.qty` and `order_items.unit_price_cents`, which are `integer`
 * columns. Multiplying two integers cannot produce a fraction, so there is
 * nothing here to round and no failure mode to handle.
 *
 * A runtime guard was considered and rejected — it would give a function that
 * currently cannot fail a way to fail, in exchange for defending against a
 * caller the schema does not permit. If either column ever becomes numeric,
 * this comment is the thing that has to change with it.
 */
export type InvoiceLine = {
  qty: number;
  unitPriceCents: number;
};

export function lineTotalCents(line: InvoiceLine): number {
  return line.unitPriceCents * line.qty;
}

export function subtotalCents(lines: readonly InvoiceLine[]): number {
  return lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
}
