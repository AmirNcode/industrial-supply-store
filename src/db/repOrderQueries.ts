import "server-only";
import { sql } from "./index";
import type { OrderStatus } from "@/lib/orders";
import { listOrderItems, type AccountOrderDetail, type AccountOrderItem } from "./accountQueries";
import { FAMILY_VISIBLE } from "./queries";

export type RepOrderRow = {
  id: number;
  ref: string;
  status: OrderStatus;
  createdAt: string;
  totalCents: number;
  fxRateToRial: number | null;
  vatRateBp: number | null;
  invoiceNumber: string | null;
  payToken: string;
  company: string;
  customerId: string | null;
  customerCode: string | null;
  placedByRep: boolean;
};

export type RepOrderDetail = AccountOrderDetail &
  RepOrderRow & {
    commissionRateBp: number | null;
    /** Credited to this rep when it was placed. */
    creditedToMe: boolean;
    /** The customer is this rep's now — what Reorder requires. */
    customerIsMine: boolean;
  };

/**
 * What a rep may see: orders credited to them, and orders of customers who are
 * theirs now. A union of two indexed lookups rather than an OR across a join,
 * which would read every order once the table is large.
 */
function visibleTo(repId: string) {
  return sql`o.id IN (
    SELECT id FROM orders WHERE rep_id = ${repId}
    UNION
    SELECT o2.id FROM orders o2 JOIN users u2 ON u2.id = o2.user_id WHERE u2.rep_id = ${repId}
  )`;
}

const ROW_COLS = sql`o.id, o.ref, o.status, o.created_at AS "createdAt",
  o.total_cents AS "totalCents", o.fx_rate_to_rial AS "fxRateToRial",
  o.vat_rate_bp AS "vatRateBp",
  o.invoice_number AS "invoiceNumber", o.pay_token AS "payToken",
  COALESCE(u.company, o.company) AS company, o.user_id AS "customerId",
  u.customer_code AS "customerCode", o.placed_by_rep AS "placedByRep"`;

/** `totalCount` is every match, so the page can say when 300 is not all (M-15). */
export async function listOrdersForRep(
  repId: string,
  status: OrderStatus | null,
): Promise<(RepOrderRow & { totalCount: number })[]> {
  return sql<(RepOrderRow & { totalCount: number })[]>`
    SELECT ${ROW_COLS}, count(*) OVER ()::int AS "totalCount"
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE ${visibleTo(repId)} AND ${status ? sql`o.status = ${status}` : sql`TRUE`}
    ORDER BY o.created_at DESC
    LIMIT 300
  `;
}

export async function getOrderForRep(
  repId: string,
  ref: string,
): Promise<{ order: RepOrderDetail; items: AccountOrderItem[] } | null> {
  const [order] = await sql<RepOrderDetail[]>`
    SELECT ${ROW_COLS},
           o.courier, o.tracking_number AS "trackingNumber",
           o.po_number AS "poNumber", o.invoiced_at AS "invoicedAt",
           o.payment_submitted_at AS "paymentSubmittedAt", o.paid_at AS "paidAt",
           o.shipped_at AS "shippedAt", o.delivered_at AS "deliveredAt",
           (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS "itemCount",
           o.commission_rate_bp AS "commissionRateBp",
           (o.rep_id = ${repId}) IS TRUE AS "creditedToMe",
           (u.rep_id = ${repId}) IS TRUE AS "customerIsMine"
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.ref = ${ref} AND ${visibleTo(repId)}
    LIMIT 1
  `;
  if (!order) return null;
  return { order, items: await listOrderItems(order.id) };
}

/**
 * Whether this rep may see the order — and so create its invoice. The same
 * rule as every read above, for pages that then load the order another way.
 */
export async function repCanSeeOrder(repId: string, ref: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM orders o WHERE o.ref = ${ref} AND ${visibleTo(repId)} LIMIT 1`;
  return rows.length > 0;
}

/**
 * The lines to copy into a new cart. `customerId` is set only while the
 * customer is still this rep's — reordering for someone else's customer is the
 * one thing visibility does not grant. Lines whose product no longer exists,
 * or now sits in a family or category the admin has hidden, come back as part
 * numbers for the rep to see what was left out: quick order refuses hidden
 * products, and the cart itself does not check, so this must.
 */
export async function getReorderLines(
  repId: string,
  ref: string,
): Promise<{ customerId: string | null; lines: { productId: number; qty: number }[]; missing: string[] } | null> {
  const [order] = await sql<{ id: number; customerId: string | null }[]>`
    SELECT o.id, CASE WHEN u.rep_id = ${repId} THEN u.id END AS "customerId"
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.ref = ${ref} AND ${visibleTo(repId)}
  `;
  if (!order) return null;
  const items = await sql<{ productId: number | null; partNumber: string; qty: number }[]>`
    SELECT CASE WHEN p.id IS NOT NULL AND ${FAMILY_VISIBLE} THEN p.id END AS "productId",
           i.part_number AS "partNumber", i.qty
    FROM order_items i
    LEFT JOIN products p ON p.id = i.product_id
    LEFT JOIN product_families f ON f.id = p.family_id
    LEFT JOIN categories c ON c.id = f.category_id
    WHERE i.order_id = ${order.id}
    ORDER BY i.id
  `;
  return {
    customerId: order.customerId,
    lines: items.flatMap((i) => (i.productId === null ? [] : [{ productId: i.productId, qty: i.qty }])),
    missing: items.filter((i) => i.productId === null).map((i) => i.partNumber),
  };
}
