import "server-only";
import { sql } from "./index";
import type { OrderStatus } from "@/lib/orders";

export type AccountOrderRow = {
  id: number;
  ref: string;
  status: OrderStatus;
  createdAt: string;
  totalCents: number;
  /** Frozen at invoicing; null until then, when the live rate is correct. */
  fxRateToToman: number | null;
  invoiceNumber: string | null;
  itemCount: number;
  /** Selected here so the list can offer Pay directly, without the customer
   *  having to open an order to discover it is waiting on them. */
  paymentUrl: string;
};

export async function listOrdersForUser(userId: string): Promise<AccountOrderRow[]> {
  return sql<AccountOrderRow[]>`
    SELECT o.id, o.ref, o.status, o.created_at AS "createdAt",
           o.total_cents AS "totalCents",
           o.fx_rate_to_toman AS "fxRateToToman",
           o.invoice_number AS "invoiceNumber",
           o.payment_url AS "paymentUrl",
           (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS "itemCount"
    FROM orders o
    WHERE o.user_id = ${userId}
    ORDER BY o.created_at DESC
  `;
}

export type AccountOrderDetail = AccountOrderRow & {
  paymentUrl: string;
  courier: string;
  trackingNumber: string;
  poNumber: string;
  invoicedAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
};

export type AccountOrderItem = {
  id: number;
  partNumber: string;
  familyName: string;
  qty: number;
  unitPriceCents: number;
  requestedUnitPriceCents: number;
};

/**
 * Ownership is a predicate in the query, not a check after it.
 *
 * Fetching by reference and comparing `user_id` afterwards is the same logic
 * with a window in which the wrong row exists in memory — and it is exactly
 * the check a later edit quietly drops. Here there is nothing to drop: a
 * reference belonging to someone else simply returns no rows, and the page
 * turns that into a 404.
 */
export async function getOrderForUser(
  userId: string,
  ref: string,
): Promise<{ order: AccountOrderDetail; items: AccountOrderItem[] } | null> {
  const rows = await sql<AccountOrderDetail[]>`
    SELECT o.id, o.ref, o.status, o.created_at AS "createdAt",
           o.total_cents AS "totalCents",
           o.fx_rate_to_toman AS "fxRateToToman",
           o.invoice_number AS "invoiceNumber",
           o.payment_url AS "paymentUrl", o.courier,
           o.tracking_number AS "trackingNumber", o.po_number AS "poNumber",
           o.invoiced_at AS "invoicedAt", o.paid_at AS "paidAt",
           o.shipped_at AS "shippedAt", o.delivered_at AS "deliveredAt",
           (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS "itemCount"
    FROM orders o
    WHERE o.ref = ${ref} AND o.user_id = ${userId}
    LIMIT 1
  `;
  const order = rows[0];
  if (!order) return null;

  const items = await sql<AccountOrderItem[]>`
    SELECT id, part_number AS "partNumber", family_name AS "familyName", qty,
           unit_price_cents AS "unitPriceCents",
           requested_unit_price_cents AS "requestedUnitPriceCents"
    FROM order_items WHERE order_id = ${order.id} ORDER BY id
  `;
  return { order, items };
}
