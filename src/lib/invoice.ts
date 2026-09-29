import type { Locale } from "./i18n";
import { formatAmount, formatPrice, type Currency } from "./money";

/**
 * Invoice arithmetic, kept free of I/O so it can be tested without a database
 * or a renderer.
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

/**
 * True when a line would be invoiced at 0 — a "call for price" product nobody
 * priced. No invoice is issued while one is (`issueInvoice`); a rep, who never
 * changes a price, hands such an order to the admin.
 */
export function hasUnpricedLine(lines: readonly { unitPriceCents: number }[]): boolean {
  return lines.some((line) => line.unitPriceCents <= 0);
}

/**
 * Subtotal, VAT and total in the invoice's own unit: cents for USD, whole
 * rial for IRR. The three always add up — total is subtotal plus VAT, never
 * rounded on its own.
 */
export type InvoiceAmounts = { subtotal: number; vat: number; total: number };

/** Half up, for the non-negative amounts an invoice holds. */
function roundDiv(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

/**
 * VAT is worked out in the currency the invoice is printed in, from the
 * subtotal as printed. Taking it in cents and converting would be off by up to
 * half a cent — about 12,000 rial at today's rate — so an accountant checking
 * "10% of the subtotal" against the VAT line would find it wrong.
 *
 * BigInt because cents × rate × basis points passes 2^53 on a large order,
 * the same reason `repMoney` leaves this multiplication to Postgres.
 */
export function invoiceAmounts(
  subtotalCents: number,
  vatRateBp: number,
  currency: Currency,
  rate: number,
): InvoiceAmounts {
  const subtotal =
    currency === "USD"
      ? BigInt(subtotalCents)
      : roundDiv(BigInt(subtotalCents) * BigInt(rate), 100n);
  const vat = roundDiv(subtotal * BigInt(vatRateBp), 10_000n);
  return { subtotal: Number(subtotal), vat: Number(vat), total: Number(subtotal + vat) };
}

/**
 * The same amounts at the catalog's nearest-1,000 rial, for the order pages
 * and lists that already print rounded rial. Subtotal and total are each
 * rounded and VAT is what lies between them, so the rows still add up; the
 * exact figures are on the invoice.
 */
export function roundedForDisplay(amounts: InvoiceAmounts, currency: Currency): InvoiceAmounts {
  if (currency === "USD") return amounts;
  const round = (n: number) => Math.round(n / 1_000) * 1_000;
  const subtotal = round(amounts.subtotal);
  const total = round(amounts.total);
  return { subtotal, vat: total - subtotal, total };
}

/**
 * An order's total as the lists print it. Before an invoice there is no VAT
 * yet, and an invoice issued before VAT existed has none (`vatRateBp` null) —
 * both keep the plain catalog formatting they always had.
 */
export function formatOrderTotal(
  totalCents: number,
  vatRateBp: number | null,
  currency: Currency,
  locale: Locale,
  rate: number,
): string {
  if (vatRateBp === null) return formatPrice(totalCents, currency, locale, rate);
  const { total } = roundedForDisplay(invoiceAmounts(totalCents, vatRateBp, currency, rate), currency);
  return formatAmount(total, currency, locale);
}
