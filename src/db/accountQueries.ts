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
  fxRateToRial: number | null;
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
           o.fx_rate_to_rial AS "fxRateToRial",
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

const DETAIL_COLS = sql`o.id, o.ref, o.status, o.created_at AS "createdAt",
  o.total_cents AS "totalCents",
  o.fx_rate_to_rial AS "fxRateToRial",
  o.invoice_number AS "invoiceNumber",
  o.payment_url AS "paymentUrl", o.courier,
  o.tracking_number AS "trackingNumber", o.po_number AS "poNumber",
  o.invoiced_at AS "invoicedAt", o.paid_at AS "paidAt",
  o.shipped_at AS "shippedAt", o.delivered_at AS "deliveredAt",
  (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS "itemCount"`;

export async function listOrderItems(orderId: number): Promise<AccountOrderItem[]> {
  return sql<AccountOrderItem[]>`
    SELECT id, part_number AS "partNumber", family_name AS "familyName", qty,
           unit_price_cents AS "unitPriceCents",
           requested_unit_price_cents AS "requestedUnitPriceCents"
    FROM order_items WHERE order_id = ${orderId} ORDER BY id
  `;
}

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
    SELECT ${DETAIL_COLS}
    FROM orders o
    WHERE o.ref = ${ref} AND o.user_id = ${userId}
    LIMIT 1
  `;
  const order = rows[0];
  if (!order) return null;
  return { order, items: await listOrderItems(order.id) };
}

export type PayOrderDetail = AccountOrderDetail & { company: string; payToken: string };

/**
 * The private pay link's order. The token is the whole authority here —
 * whoever holds the link sees this one order, exactly as whoever holds an
 * emailed invoice PDF does.
 */
export async function getOrderByPayToken(
  token: string,
): Promise<{ order: PayOrderDetail; items: AccountOrderItem[] } | null> {
  const [order] = await sql<PayOrderDetail[]>`
    SELECT ${DETAIL_COLS}, o.company, o.pay_token AS "payToken"
    FROM orders o WHERE o.pay_token = ${token} LIMIT 1
  `;
  if (!order) return null;
  return { order, items: await listOrderItems(order.id) };
}
