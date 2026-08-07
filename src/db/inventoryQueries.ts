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
 * Order lines asking for more than is on the shelf.
 *
 * Read for the whole queue in one query so the warning costs one round trip
 * rather than one per order.
 */
export async function findShortfalls(
  orderIds: readonly number[],
): Promise<Map<number, ShortfallLine[]>> {
  const byOrder = new Map<number, ShortfallLine[]>();
  if (orderIds.length === 0) return byOrder;

  const rows = await sql<ShortfallLine[]>`
    SELECT i.order_id AS "orderId", i.part_number AS "partNumber", i.qty,
           p.inventory_available AS "available"
    FROM order_items i
    JOIN products p ON p.id = i.product_id
    WHERE i.order_id = ANY(${orderIds as number[]}::int[])
      AND i.qty > p.inventory_available
    ORDER BY i.order_id, i.part_number
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
