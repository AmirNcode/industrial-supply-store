import "server-only";
import { sql } from "./index";
import type { OrderStatus } from "@/lib/orders";
import { FAMILY_VISIBLE } from "./queries";

export type AccountOrderRow = {
  id: number;
  ref: string;
  status: OrderStatus;
  createdAt: string;
  totalCents: number;
  /** Frozen at invoicing; null until then, when the live rate is correct. */
  fxRateToRial: number | null;
  /** Locked at invoicing; null before, and on invoices issued before VAT. */
  vatRateBp: number | null;
  invoiceNumber: string | null;
  itemCount: number;
  /** The open order's deadline (see `orders.expires_at`); null when it has none. */
  expiresAt: string | null;
  /** Set when the order was cancelled by its deadline rather than by staff. */
  expiredAt: string | null;
};

export async function listOrdersForUser(userId: string): Promise<AccountOrderRow[]> {
  return sql<AccountOrderRow[]>`
    SELECT o.id, o.ref, o.status, o.created_at AS "createdAt",
           o.total_cents AS "totalCents",
           o.fx_rate_to_rial AS "fxRateToRial", o.vat_rate_bp AS "vatRateBp",
           o.invoice_number AS "invoiceNumber",
           o.expires_at AS "expiresAt", o.expired_at AS "expiredAt",
           (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS "itemCount"
    FROM orders o
    WHERE o.user_id = ${userId}
    ORDER BY o.created_at DESC
  `;
}

export type AccountOrderDetail = AccountOrderRow & {
  courier: string;
  trackingNumber: string;
  poNumber: string;
  invoicedAt: string | null;
  paymentSubmittedAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  quotedAt: string | null;
  /** The other order of a split checkout, when there is one. */
  siblingRef: string | null;
};

export type AccountOrderItem = {
  id: number;
  partNumber: string;
  familyName: string;
  qty: number;
  unitPriceCents: number;
  requestedUnitPriceCents: number;
  /** Not on the shelf when ordered: supplied to order, no stock held. */
  backorder: boolean;
};

const DETAIL_COLS = sql`o.id, o.ref, o.status, o.created_at AS "createdAt",
  o.total_cents AS "totalCents",
  o.fx_rate_to_rial AS "fxRateToRial", o.vat_rate_bp AS "vatRateBp",
  o.invoice_number AS "invoiceNumber", o.courier,
  o.tracking_number AS "trackingNumber", o.po_number AS "poNumber",
  o.invoiced_at AS "invoicedAt", o.payment_submitted_at AS "paymentSubmittedAt",
  o.paid_at AS "paidAt",
  o.shipped_at AS "shippedAt", o.delivered_at AS "deliveredAt",
  o.quoted_at AS "quotedAt", o.expires_at AS "expiresAt", o.expired_at AS "expiredAt",
  (SELECT s.ref FROM orders s
   WHERE s.group_id = o.group_id AND s.id <> o.id LIMIT 1) AS "siblingRef",
  (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS "itemCount"`;

export async function listOrderItems(orderId: number): Promise<AccountOrderItem[]> {
  return sql<AccountOrderItem[]>`
    SELECT id, part_number AS "partNumber", family_name AS "familyName", qty,
           unit_price_cents AS "unitPriceCents",
           requested_unit_price_cents AS "requestedUnitPriceCents", backorder
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

export type PayOrderDetail = AccountOrderDetail & {
  company: string;
  payToken: string;
  /** The sibling's own pay link key, so a split checkout's two pages link to each other. */
  siblingPayToken: string | null;
};

/**
 * The private pay link's order. The token is the whole authority here —
 * whoever holds the link sees this one order, exactly as whoever holds an
 * emailed invoice PDF does.
 */
export async function getOrderByPayToken(
  token: string,
): Promise<{ order: PayOrderDetail; items: AccountOrderItem[] } | null> {
  const [order] = await sql<PayOrderDetail[]>`
    SELECT ${DETAIL_COLS}, o.company, o.pay_token AS "payToken",
           (SELECT s.pay_token FROM orders s
            WHERE s.group_id = o.group_id AND s.id <> o.id LIMIT 1) AS "siblingPayToken"
    FROM orders o WHERE o.pay_token = ${token} LIMIT 1
  `;
  if (!order) return null;
  return { order, items: await listOrderItems(order.id) };
}

/**
 * A past order's lines for Reorder, ownership in the WHERE like every other
 * read here. Back-order and shelf lines of the same product are one cart line.
 * `missing` names what is no longer sold, so the cart can say so.
 */
export async function getReorderLinesForUser(
  userId: string,
  ref: string,
): Promise<{ lines: { productId: number; qty: number }[]; missing: string[] } | null> {
  const [order] = await sql<{ id: number }[]>`
    SELECT id FROM orders WHERE ref = ${ref} AND user_id = ${userId}
  `;
  if (!order) return null;
  const items = await sql<{ productId: number | null; partNumber: string; qty: number }[]>`
    SELECT CASE WHEN p.id IS NOT NULL AND ${FAMILY_VISIBLE} THEN p.id END AS "productId",
           i.part_number AS "partNumber", sum(i.qty)::int AS qty
    FROM order_items i
    LEFT JOIN products p ON p.id = i.product_id
    LEFT JOIN product_families f ON f.id = p.family_id
    LEFT JOIN categories c ON c.id = f.category_id
    WHERE i.order_id = ${order.id}
    GROUP BY 1, i.part_number
    ORDER BY min(i.id)
  `;
  return {
    lines: items.flatMap((i) => (i.productId === null ? [] : [{ productId: i.productId, qty: Math.min(99_999, i.qty) }])),
    missing: items.filter((i) => i.productId === null).map((i) => i.partNumber),
  };
}
