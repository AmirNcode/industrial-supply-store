import "server-only";
import { sql } from "./index";
import type { OrderStatus } from "@/lib/orders";

/**
 * Deliberately thin.
 *
 * A reference is six characters, so the email is what actually gates this —
 * and an email is guessable in a way a password is not. Everything a guess
 * would reveal is therefore left out: no prices, no line items, no address,
 * no invoice. Status and a tracking number are what someone waiting for a
 * parcel needs, and are the least this can expose while still being useful.
 */
export type TrackedOrder = {
  ref: string;
  status: OrderStatus;
  courier: string;
  trackingNumber: string;
  createdAt: string;
  invoicedAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
};

export async function findOrderForTracking(
  ref: string,
  email: string,
): Promise<TrackedOrder | null> {
  const rows = await sql<TrackedOrder[]>`
    SELECT ref, status, courier, tracking_number AS "trackingNumber",
           created_at AS "createdAt", invoiced_at AS "invoicedAt",
           paid_at AS "paidAt", shipped_at AS "shippedAt",
           delivered_at AS "deliveredAt"
    FROM orders
    WHERE ref = ${ref} AND lower(email) = lower(${email})
    LIMIT 1
  `;
  return rows[0] ?? null;
}
