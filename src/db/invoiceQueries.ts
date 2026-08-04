import "server-only";
import { sql } from "./index";

export type InvoiceOrder = {
  id: number;
  ref: string;
  invoiceNumber: string;
  /** Toman per USD, frozen when the invoice was issued. Never null here. */
  fxRateToToman: number;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  poNumber: string;
  address: string;
  city: string;
  country: string;
  paymentUrl: string;
  totalCents: number;
  status: string;
  invoicedAt: string;
};

export type InvoiceItem = {
  id: number;
  partNumber: string;
  familyName: string;
  qty: number;
  unitPriceCents: number;
};

/**
 * An invoice exists only once a number has been assigned.
 *
 * The `invoice_number IS NOT NULL` predicate is the whole access rule for
 * "is there an invoice here": an order still being priced has no document to
 * show, and rendering an empty one would invite someone to send it. The
 * `fx_rate_to_toman IS NOT NULL` predicate pairs with it — the two are written
 * in the same statement, so a row with one and not the other means something
 * has gone wrong and we would rather 404 than print a total at the wrong rate.
 */
export async function getInvoiceByRef(
  ref: string,
): Promise<{ order: InvoiceOrder; items: InvoiceItem[] } | null> {
  const rows = await sql<InvoiceOrder[]>`
    SELECT id, ref, invoice_number AS "invoiceNumber",
           fx_rate_to_toman AS "fxRateToToman",
           company, contact_name AS "contactName", email, phone,
           po_number AS "poNumber", address, city, country,
           payment_url AS "paymentUrl", total_cents AS "totalCents",
           status, invoiced_at AS "invoicedAt"
    FROM orders
    WHERE ref = ${ref}
      AND invoice_number IS NOT NULL
      AND fx_rate_to_toman IS NOT NULL
    LIMIT 1
  `;
  const order = rows[0];
  if (!order) return null;

  const items = await sql<InvoiceItem[]>`
    SELECT id, part_number AS "partNumber", family_name AS "familyName",
           qty, unit_price_cents AS "unitPriceCents"
    FROM order_items WHERE order_id = ${order.id} ORDER BY id
  `;
  return { order, items };
}
