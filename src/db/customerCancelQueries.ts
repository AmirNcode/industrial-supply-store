import "server-only";
import { sql } from "./index";
import { recordAudit, type AuditActor } from "./audit";
import { releaseHeldStock } from "./inventoryQueries";
import { CUSTOMER_CANCELLABLE_STATUSES } from "@/lib/orders";

export type CustomerCancelOutcome = { ok: true; from: string } | { ok: false };

/**
 * A customer withdrawing their own order before any money is in play.
 *
 * Both conditions are checked in the UPDATE itself, not just on the page:
 * between the customer opening the order and pressing cancel, staff may have
 * moved it on or a receipt may have arrived from the pay link on another
 * device. A receipt moves the order to `payment_review`, but the NOT EXISTS
 * also covers a receipt stored a moment before that status change commits —
 * once a receipt exists, staff must look at it before anything is cancelled.
 *
 * Every cancellable status still holds its stock, so it is always released.
 */
export async function cancelOrderByCustomer(
  orderId: number,
  actor: Extract<AuditActor, { kind: "customer" }>,
  reason: string,
): Promise<CustomerCancelOutcome> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ from: string }[]>`
      WITH old AS (
        SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE
      )
      UPDATE orders o SET status = 'cancelled', expires_at = NULL
      FROM old
      WHERE o.id = ${orderId}
        AND old.status = ANY(${[...CUSTOMER_CANCELLABLE_STATUSES]}::text[])
        AND NOT EXISTS (SELECT 1 FROM payment_proofs p WHERE p.order_id = o.id)
      RETURNING old.status AS "from"
    `;
    const row = rows[0];
    if (!row) return { ok: false } as const;
    await releaseHeldStock(tx, orderId);
    await recordAudit(tx, {
      actor,
      action: "order.cancelled",
      subject: { kind: "order", id: orderId },
      detail: { from: row.from, by: "customer", ...(reason ? { reason } : {}) },
    });
    return { ok: true, from: row.from } as const;
  });
}

/** The reps credited on an order, for telling them it was withdrawn. */
export async function orderRepEmails(orderId: number): Promise<string[]> {
  const rows = await sql<{ email: string }[]>`
    SELECT r.email FROM order_rep_shares s
    JOIN sales_reps r ON r.id = s.rep_id
    WHERE s.order_id = ${orderId} AND btrim(r.email) <> ''
  `;
  return rows.map((r) => r.email.trim());
}
