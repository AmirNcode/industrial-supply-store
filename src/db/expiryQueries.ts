import "server-only";
import { sql } from "./index";
import { recordAudit } from "./audit";
import { releaseHeldStock } from "./inventoryQueries";

/**
 * Deadlines, enforced when someone looks rather than by a timer.
 *
 * `orders.expires_at` is the one deadline an open order has. The hosting plan
 * runs scheduled jobs once a day, so nothing can fire at the minute a
 * pish-factor lapses; instead every place that reads stock or an open order
 * sweeps first (checkout submit, the cart and checkout pages, order pages, the
 * admin queue), and the daily job sweeps for the days nobody looks. The effect
 * a customer can observe is the same: stock behind a lapsed order is back on
 * sale before anyone else is told how much there is.
 *
 *   invoiced  past its deadline → cancelled, stock released (the 24 hours)
 *   quoted    past its deadline → cancelled, stock released (the quote lapsed)
 *   received  past its deadline → stays open, but its held lines become
 *             back-order lines and their stock is released (staff ran out of
 *             time to quote; the request is still theirs to answer)
 *
 * A receipt clears the deadline (`addPaymentProof`), so an order whose
 * customer has paid is never swept while the admin checks the bank.
 */

export type ExpiredOrder = { id: number; ref: string; was: "invoiced" | "quoted" };

export type SweepResult = { cancelled: ExpiredOrder[]; released: number };

const BATCH = 50;

/** Per server instance: page views share one sweep a minute; submit forces one. */
let lastSweepMs = 0;
const PAGE_SWEEP_INTERVAL_MS = 60_000;

export async function sweepExpiredOrders(options: { force?: boolean } = {}): Promise<SweepResult> {
  const nowMs = Date.now();
  if (!options.force && nowMs - lastSweepMs < PAGE_SWEEP_INTERVAL_MS) return { cancelled: [], released: 0 };
  lastSweepMs = nowMs;

  // One indexed read; almost always empty, and then this is the whole cost.
  const due = await sql<{ id: number }[]>`
    SELECT id FROM orders
    WHERE expires_at IS NOT NULL AND expires_at < now()
    ORDER BY expires_at
    LIMIT ${BATCH}
  `;
  const result: SweepResult = { cancelled: [], released: 0 };
  for (const { id } of due) {
    // One order per transaction: a failure on one leaves the rest swept, and
    // no transaction holds product locks for more than one order's lines.
    const outcome = await sql.begin(async (tx) => {
      // Locked and re-read: a receipt, a payment or a staff cancel may have
      // landed since the list above was read.
      const [order] = await tx<{ ref: string; status: string }[]>`
        SELECT ref, status FROM orders
        WHERE id = ${id} AND expires_at IS NOT NULL AND expires_at < now()
        FOR UPDATE
      `;
      if (!order) return null;
      if (order.status === "invoiced" || order.status === "quoted") {
        await tx`
          UPDATE orders SET status = 'cancelled', expired_at = now(), expires_at = NULL
          WHERE id = ${id}
        `;
        await releaseHeldStock(tx, id);
        await recordAudit(tx, {
          actor: { kind: "system" },
          action: "order.expired",
          subject: { kind: "order", id },
          detail: { from: order.status },
        });
        return { kind: "cancelled" as const, ref: order.ref, was: order.status as "invoiced" | "quoted" };
      }
      if (order.status === "received") {
        await releaseHeldStock(tx, id);
        // After the release, so the release still saw the lines as held.
        await tx`UPDATE order_items SET backorder = true WHERE order_id = ${id} AND NOT backorder`;
        await tx`UPDATE orders SET expires_at = NULL WHERE id = ${id}`;
        await recordAudit(tx, {
          actor: { kind: "system" },
          action: "order.hold-released",
          subject: { kind: "order", id },
        });
        return { kind: "released" as const };
      }
      // Any other status should carry no deadline (`orders_expiry_check`).
      return null;
    });
    if (outcome?.kind === "cancelled") result.cancelled.push({ id, ref: outcome.ref, was: outcome.was });
    if (outcome?.kind === "released") result.released += 1;
  }
  return result;
}
