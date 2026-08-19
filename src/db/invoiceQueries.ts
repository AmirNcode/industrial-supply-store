import "server-only";
import type { TransactionSql } from "postgres";
import { sql } from "./index";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

export type OrderItemPrice = { id: number; cents: number };

/** Apply all prices from one submitted invoice form in one guarded update. */
export async function updateOrderItemPrices(
  tx: Tx,
  orderId: number,
  prices: readonly OrderItemPrice[],
): Promise<number> {
  if (prices.length === 0) return 0;
  const result = await tx`
    UPDATE order_items i
    SET unit_price_cents = submitted.cents
    FROM unnest(
      ${prices.map((item) => item.id)}::int[],
      ${prices.map((item) => item.cents)}::int[]
    ) AS submitted(id, cents)
    WHERE i.id = submitted.id AND i.order_id = ${orderId}
  `;
  return result.count;
}

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
  /** Null for a guest order — nobody but staff may read that invoice. */
  userId: string | null;
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
           status, invoiced_at AS "invoicedAt", user_id AS "userId"
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
