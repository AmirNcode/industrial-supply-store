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
