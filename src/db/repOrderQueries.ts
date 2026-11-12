import "server-only";
import { sql } from "./index";
import type { OrderStatus } from "@/lib/orders";
import { listOrderItems, type AccountOrderDetail, type AccountOrderItem } from "./accountQueries";
import { FAMILY_VISIBLE } from "./queries";
import { onMyList } from "./accountRepQueries";

export type RepOrderRow = {
  id: number;
  ref: string;
  status: OrderStatus;
  createdAt: string;
  totalCents: number;
  fxRateToRial: number | null;
  vatRateBp: number | null;
  /** Null on a pish-factor; assigned when payment is confirmed. */
  invoiceNumber: string | null;
  /** Set when the pish-factor is issued: "has a document" is this, not the number. */
  invoicedAt: string | null;
  /** The open order's deadline; null when it has none. */
  expiresAt: string | null;
  /** Set when a deadline cancelled the order. */
  expiredAt: string | null;
  /** Only on orders this rep can act on; null on an order they see because the customer is on their list. */
  payToken: string | null;
  /** I have a share in it, or I placed it and the claim is still open (customer unassigned or already mine) — the orders I may act on. */
  canAct: boolean;
  /** My share of the order in basis points; null when I have no share row. */
  myShareBp: number | null;
  /** I placed it and it has no shares yet: paying it credits me, because the customer is unassigned or already mine. */
  pendingClaim: boolean;
  /** I placed it, it has no shares, and the customer is held by other reps without me: no commission, no rights. */
  lostClaim: boolean;
  company: string;
  customerId: string | null;
  customerCode: string | null;
  placedByRep: boolean;
};

export type RepOrderDetail = AccountOrderDetail &
  RepOrderRow & {
    commissionRateBp: number | null;
    /** I am on the customer's list now — what Reorder requires. */
    customerIsMine: boolean;
  };

/**
 * What a rep may see: orders they hold a share of, orders they placed, and
 * orders of customers on their list. A union of three indexed lookups
 * (`order_rep_shares_rep_idx`, the `placed_by_rep_id` index, `customer_reps_rep_idx`)
 * rather than an OR across a join, which would read every order once the table
 * is large.
 */
function visibleTo(repId: string) {
  return sql`o.id IN (
    SELECT s.order_id FROM order_rep_shares s WHERE s.rep_id = ${repId}
    UNION
    SELECT p.id FROM orders p WHERE p.placed_by_rep_id = ${repId}
    UNION
    SELECT o2.id FROM orders o2 JOIN customer_reps cr ON cr.user_id = o2.user_id WHERE cr.rep_id = ${repId}
  )`;
}

/**
 * SQL fragment: I may act on `o` — I have a share in it, or I placed it and
 * the claim is still open. An order with no share rows credits nobody until
 * its payment is confirmed, and `claimCustomerForOrder` then credits the
 * placing rep when the customer has no reps or the placing rep is already on
 * the customer's list; only a customer held by other reps loses it. Mirror
 * that rule here: once the claim is lost the placing rep keeps only the
 * read-only view, since a pay link or receipt upload for a sale that now pays
 * someone else would be acting on another rep's customer.
 */
function canActOn(repId: string) {
  // IS TRUE: placed_by_rep_id is NULL on most orders, and NULL OR false is NULL, not false.
  return sql`(((o.placed_by_rep_id = ${repId}) IS TRUE
      AND NOT EXISTS (SELECT 1 FROM order_rep_shares s WHERE s.order_id = o.id)
      AND (NOT EXISTS (SELECT 1 FROM customer_reps cr WHERE cr.user_id = o.user_id)
           OR EXISTS (SELECT 1 FROM customer_reps cr WHERE cr.user_id = o.user_id AND cr.rep_id = ${repId})))
    OR EXISTS (SELECT 1 FROM order_rep_shares s WHERE s.order_id = o.id AND s.rep_id = ${repId}))`;
}

/**
 * One row per order holding the facts `rowCols` derives its claim columns
 * from, so each correlated subquery runs once per order rather than once per
 * column. Joined as `claim` by every query that selects `rowCols`.
 */
function claimJoin(repId: string) {
  return sql`LEFT JOIN LATERAL (
    SELECT (SELECT s.share_bp FROM order_rep_shares s WHERE s.order_id = o.id AND s.rep_id = ${repId}) AS share_bp,
           ((o.placed_by_rep_id = ${repId}) IS TRUE
             AND NOT EXISTS (SELECT 1 FROM order_rep_shares x WHERE x.order_id = o.id)) AS unshared_mine,
           EXISTS (SELECT 1 FROM customer_reps cr WHERE cr.user_id = o.user_id) AS has_reps,
           EXISTS (SELECT 1 FROM customer_reps cr WHERE cr.user_id = o.user_id AND cr.rep_id = ${repId}) AS on_list
  ) claim ON TRUE`;
}

/**
 * The columns every rep order read returns; the query must also join
 * `claimJoin`. The pay token — a bearer credential for the order — only where
 * the rep can act on the order: a customer added to their list brings that
 * customer's older orders into view, but not the power to take receipts or
 * send pay links for sales another rep made (review M-17).
 */
function rowCols() {
  // Same rule as canActOn, from the joined facts: the claim is open unless
  // other reps hold the customer and I am not among them.
  const open = sql`(claim.unshared_mine AND (NOT claim.has_reps OR claim.on_list))`;
  return sql`o.id, o.ref, o.status, o.created_at AS "createdAt",
  o.total_cents AS "totalCents", o.fx_rate_to_rial AS "fxRateToRial",
  o.vat_rate_bp AS "vatRateBp",
  o.invoice_number AS "invoiceNumber", o.invoiced_at AS "invoicedAt",
  o.expires_at AS "expiresAt", o.expired_at AS "expiredAt",
  CASE WHEN claim.share_bp IS NOT NULL OR ${open} THEN o.pay_token END AS "payToken",
  (claim.share_bp IS NOT NULL OR ${open}) AS "canAct",
  claim.share_bp AS "myShareBp",
  ${open} AS "pendingClaim",
  (claim.unshared_mine AND claim.has_reps AND NOT claim.on_list) AS "lostClaim",
  COALESCE(u.company, o.company) AS company, o.user_id AS "customerId",
  u.customer_code AS "customerCode", o.placed_by_rep AS "placedByRep"`;
}

/** `totalCount` is every match, so the page can say when 300 is not all (M-15). */
export async function listOrdersForRep(
  repId: string,
  status: OrderStatus | null,
): Promise<(RepOrderRow & { totalCount: number })[]> {
  return sql<(RepOrderRow & { totalCount: number })[]>`
    SELECT ${rowCols()}, count(*) OVER ()::int AS "totalCount"
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    ${claimJoin(repId)}
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
    SELECT ${rowCols()},
           o.courier, o.tracking_number AS "trackingNumber",
           o.po_number AS "poNumber", o.quoted_at AS "quotedAt",
           o.payment_submitted_at AS "paymentSubmittedAt", o.paid_at AS "paidAt",
           o.shipped_at AS "shippedAt", o.delivered_at AS "deliveredAt",
           (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS "itemCount",
           o.commission_rate_bp AS "commissionRateBp",
           EXISTS (SELECT 1 FROM customer_reps cr WHERE cr.user_id = o.user_id AND cr.rep_id = ${repId}) AS "customerIsMine"
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    ${claimJoin(repId)}
    WHERE o.ref = ${ref} AND ${visibleTo(repId)}
    LIMIT 1
  `;
  if (!order) return null;
  return { order, items: await listOrderItems(order.id) };
}

/**
 * Whether this rep may *act* on the order — invoice it, take its receipts,
 * read them: only one they hold a share of or placed. Seeing a customer's
 * older orders is read-only (review M-17).
 */
export async function repCanActOnOrder(repId: string, ref: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM orders o WHERE o.ref = ${ref} AND ${canActOn(repId)} LIMIT 1`;
  return rows.length > 0;
}

/**
 * The lines to copy into a new cart. `customerId` is set only while the
 * customer is still on this rep's list — reordering for someone else's customer is the
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
    SELECT o.id, CASE WHEN ${onMyList(repId)} THEN u.id END AS "customerId"
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
