import "server-only";
import type { TransactionSql } from "postgres";
import { sql } from "./index";

/**
 * Stock movement, driven by the order lifecycle.
 *
 * Three counts, in packs:
 *   available — what is on the shelf and unspoken for
 *   on_hold   — ordered, not yet paid for
 *   sold      — paid for
 *
 * The transitions that move them are the only two that change what is
 * physically committed: an order arriving reserves stock, and a payment turns
 * a reservation into a sale. Shipping and delivery move goods that were
 * already sold, so they move nothing here.
 *
 * Every statement takes a transaction, because a count that moves without the
 * order status that caused it — or the reverse — is worse than either alone.
 *
 * Nothing here refuses to go negative. Stock is advisory by design: pricing and
 * confirmation happen off-platform by phone, so an order beyond the shelf is a
 * conversation, not an error. The admin queue flags the shortfall instead.
 */

/**
 * What `sql.begin()` hands its callback. Every mover below takes one rather
 * than reaching for the module-level `sql`, so a caller physically cannot run
 * a stock move outside the transaction that justifies it.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

/** Order received: reserve what it asks for. */
export async function holdStockForOrder(tx: Tx, orderId: number): Promise<void> {
  await tx`
    UPDATE products p
    SET inventory_available = p.inventory_available - i.qty,
        inventory_on_hold  = p.inventory_on_hold + i.qty
    FROM order_items i
    WHERE i.order_id = ${orderId} AND i.product_id = p.id
  `;
}

/** Payment received: the reservation becomes a sale. */
export async function sellHeldStock(tx: Tx, orderId: number): Promise<void> {
  await tx`
    UPDATE products p
    SET inventory_on_hold = p.inventory_on_hold - i.qty,
        inventory_sold    = p.inventory_sold + i.qty
    FROM order_items i
    WHERE i.order_id = ${orderId} AND i.product_id = p.id
  `;
}

/**
 * Cancelled: put a reservation back on the shelf.
 *
 * Only for an order that was still holding stock — cancelling something already
 * paid for would need a refund path, which does not exist yet, so the caller
 * decides based on the status it is leaving.
 */
export async function releaseHeldStock(tx: Tx, orderId: number): Promise<void> {
  await tx`
    UPDATE products p
    SET inventory_on_hold  = p.inventory_on_hold - i.qty,
        inventory_available = p.inventory_available + i.qty
    FROM order_items i
    WHERE i.order_id = ${orderId} AND i.product_id = p.id
  `;
}

export type ShortfallLine = { orderId: number; partNumber: string; qty: number; available: number };

/**
 * Pending order lines whose turn in the reservation sequence found too little
 * shelf stock.
 *
 * `inventory_available` is already reduced by every pending hold, so comparing
 * an order's quantity with that number double-counts its own reservation. To
 * reconstruct the truthful pre-hold amount, add all current holds back, then
 * allocate them in order creation sequence. Payment and cancellation both
 * remove a hold, so the same calculation naturally reallocates the remainder.
 *
 * Read for the whole queue in one query so the warning costs one round trip
 * rather than one per order.
 */
export async function findShortfalls(
  orderIds: readonly number[],
  query: Tx | typeof sql = sql,
): Promise<Map<number, ShortfallLine[]>> {
  const byOrder = new Map<number, ShortfallLine[]>();
  if (orderIds.length === 0) return byOrder;

  const rows = await query<ShortfallLine[]>`
    WITH pending AS (
      SELECT o.id AS order_id, o.created_at, i.product_id,
             min(i.part_number) AS part_number, sum(i.qty)::int AS qty
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
      WHERE o.status IN ('received', 'invoiced')
        AND i.product_id IS NOT NULL
      GROUP BY o.id, o.created_at, i.product_id
    ), allocated AS (
      SELECT h.order_id, h.part_number, h.qty,
             (
               p.inventory_available + p.inventory_on_hold
               - COALESCE(
                   sum(h.qty) OVER (
                     PARTITION BY h.product_id
                     ORDER BY h.created_at, h.order_id
                     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                   ),
                   0
                 )
             )::int AS available_before_order
      FROM pending h
      JOIN products p ON p.id = h.product_id
    )
    SELECT order_id AS "orderId", part_number AS "partNumber", qty,
           greatest(available_before_order, 0)::int AS "available"
    FROM allocated
    WHERE order_id = ANY(${orderIds as number[]}::int[])
      AND qty > greatest(available_before_order, 0)
    ORDER BY order_id, part_number
  `;
  for (const r of rows) {
    if (!byOrder.has(r.orderId)) byOrder.set(r.orderId, []);
    byOrder.get(r.orderId)!.push(r);
  }
  return byOrder;
}

export type FamilyInventory = {
  familyId: number;
  available: number;
  onHold: number;
  sold: number;
  products: number;
};

/** Per-family totals for the products page. */
export async function getFamilyInventory(): Promise<Map<number, FamilyInventory>> {
  const rows = await sql<FamilyInventory[]>`
    SELECT family_id AS "familyId",
           COALESCE(SUM(inventory_available), 0)::int AS "available",
           COALESCE(SUM(inventory_on_hold), 0)::int   AS "onHold",
           COALESCE(SUM(inventory_sold), 0)::int      AS "sold",
           count(*)::int                              AS "products"
    FROM products GROUP BY family_id
  `;
  return new Map(rows.map((r) => [r.familyId, r]));
}
