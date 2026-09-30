import "server-only";
import { sql } from "./index";
import { recordAudit } from "./audit";
import { sellHeldStock } from "./inventoryQueries";
import { acceptsPaymentProof, isOrderStatus } from "@/lib/orders";
import { PROOF_MAX_PER_ORDER, type ProofType } from "@/lib/paymentProof";

export type PaymentProof = {
  id: number;
  orderId: number;
  contentType: string;
  byteSize: number;
  uploadedBy: "customer" | "rep";
  /** The uploading rep's name, when a rep uploaded it. */
  repName: string | null;
  /** Postgres text, as every raw timestamp from the shared client. */
  createdAt: string;
};

export type AddProofResult = "added" | "closed" | "full";

/**
 * Record a stored receipt against its order, and move an order awaiting
 * payment to `payment_review` with the first one.
 *
 * The order row is locked for the check and both writes, so a receipt cannot
 * land on an order the admin confirms or cancels in the same instant, and two
 * uploads at once cannot both pass the per-order cap.
 */
export async function addPaymentProof(
  orderId: number,
  file: { path: string; type: ProofType; size: number },
  by: { kind: "customer" } | { kind: "rep"; repId: string },
): Promise<AddProofResult> {
  return sql.begin(async (tx) => {
    const [order] = await tx<{ status: string }[]>`
      SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE
    `;
    if (!order || !isOrderStatus(order.status) || !acceptsPaymentProof(order.status)) return "closed";
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM payment_proofs WHERE order_id = ${orderId}
    `;
    if (n >= PROOF_MAX_PER_ORDER) return "full";
    await tx`
      INSERT INTO payment_proofs (order_id, storage_path, content_type, byte_size, uploaded_by, rep_id)
      VALUES (${orderId}, ${file.path}, ${file.type}, ${file.size}, ${by.kind},
              ${by.kind === "rep" ? by.repId : null})
    `;
    if (order.status === "invoiced") {
      await tx`
        UPDATE orders SET status = 'payment_review', payment_submitted_at = now()
        WHERE id = ${orderId} AND status = 'invoiced'
      `;
    }
    await recordAudit(tx, {
      actor: by.kind === "rep" ? { kind: "rep", id: by.repId } : { kind: "customer", id: null },
      action: "payment.receipt",
      subject: { kind: "order", id: orderId },
      detail: { from: order.status, bytes: file.size },
    });
    return "added";
  });
}

/** Every order's receipts in one query, oldest first — for a page of orders. */
export async function listPaymentProofs(orderIds: readonly number[]): Promise<Map<number, PaymentProof[]>> {
  const byOrder = new Map<number, PaymentProof[]>();
  if (orderIds.length === 0) return byOrder;
  const rows = await sql<PaymentProof[]>`
    SELECT p.id, p.order_id AS "orderId", p.content_type AS "contentType",
           p.byte_size AS "byteSize", p.uploaded_by AS "uploadedBy",
           r.name AS "repName", p.created_at AS "createdAt"
    FROM payment_proofs p LEFT JOIN sales_reps r ON r.id = p.rep_id
    WHERE p.order_id = ANY(${orderIds as number[]}::int[])
    ORDER BY p.created_at, p.id
  `;
  for (const row of rows) {
    if (!byOrder.has(row.orderId)) byOrder.set(row.orderId, []);
    byOrder.get(row.orderId)!.push(row);
  }
  return byOrder;
}

export type ProofAccess = {
  storagePath: string;
  contentType: string;
  orderRef: string;
  userId: string | null;
};

/** What the file route needs to decide who may see a receipt. */
export async function getProofAccess(id: number): Promise<ProofAccess | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [row] = await sql<ProofAccess[]>`
    SELECT p.storage_path AS "storagePath", p.content_type AS "contentType",
           o.ref AS "orderRef", o.user_id AS "userId"
    FROM payment_proofs p JOIN orders o ON o.id = p.order_id
    WHERE p.id = ${id}
  `;
  return row ?? null;
}

/**
 * The money arrived: the order moves to `preparing` and its held stock
 * becomes sold, together or not at all. `from` repeats the status the caller
 * read, so a lost race changes nothing (the same guard every status move
 * uses).
 *
 * The admin's alone. A rep may upload receipts but never confirm one: a rep
 * could otherwise upload any photo as "the receipt" for their own order and
 * mark it paid, and the next step is shipping the goods. There is no rep
 * parameter, so no rep code path can reach this.
 */
export async function confirmPayment(
  orderId: number,
  from: "invoiced" | "payment_review",
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const result = await tx`
      UPDATE orders
      SET status = 'preparing', paid_at = now()
      WHERE id = ${orderId} AND status = ${from}
    `;
    if (result.count === 0) return false;
    await recordAudit(tx, {
      actor: { kind: "admin" },
      action: "payment.confirmed",
      subject: { kind: "order", id: orderId },
      detail: { from },
    });
    await sellHeldStock(tx, orderId);
    return true;
  });
}
