import "server-only";
import { sql } from "./index";

/**
 * Internal staff notes. **Never reachable from a customer-facing page.**
 *
 * Nothing here is filtered by customer or order ownership, because there is no
 * customer view of it to filter for: the account order page, the invoice and
 * the guest tracking payload all leave comments out entirely. If a future page
 * needs to show notes to a customer, it needs a different table or a visibility
 * column — not a call to these.
 */
export type OrderComment = {
  id: number;
  orderId: number;
  body: string;
  createdAt: string;
};

/** One query for a whole queue page rather than one per order. */
export async function listCommentsForOrders(
  orderIds: readonly number[],
): Promise<Map<number, OrderComment[]>> {
  const byOrder = new Map<number, OrderComment[]>();
  if (orderIds.length === 0) return byOrder;

  const rows = await sql<OrderComment[]>`
    SELECT id, order_id AS "orderId", body, created_at AS "createdAt"
    FROM order_comments
    WHERE order_id = ANY(${orderIds as number[]}::int[])
    ORDER BY created_at DESC, id DESC
  `;
  for (const r of rows) {
    if (!byOrder.has(r.orderId)) byOrder.set(r.orderId, []);
    byOrder.get(r.orderId)!.push(r);
  }
  return byOrder;
}

/** Append-only: there is no update and no delete, by design. */
export async function addComment(orderId: number, body: string): Promise<void> {
  await sql`
    INSERT INTO order_comments (order_id, body) VALUES (${orderId}, ${body})
  `;
}
