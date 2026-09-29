import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { sql } from "./index";
import type { OrderStatus } from "@/lib/orders";
import type { PersianYearMonth } from "@/lib/persianCalendar";
import type { TargetRow } from "@/lib/repStats";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Db = Sql<{}> | TransactionSql<{}>;

/**
 * The one definition of a rep's money.
 *
 * Sales is the invoiced total converted at the rate frozen on that invoice —
 * the whole-rial total the invoice itself prints. Commission applies the rate
 * locked when the order was placed. Both are exact `numeric` arithmetic in
 * Postgres: JavaScript never multiplies these, because cents × rate × basis
 * points passes 2^53 on a large order. Results cross to JavaScript as float8:
 * postgres-js returns bigint as a string, and every rial amount here is an
 * integer far below 2^53, where a double is exact.
 *
 * `live` is today's rate, used only for orders not yet invoiced — an estimate,
 * and always labelled as one.
 */
/**
 * The shared client returns timestamps as text: drizzle, which wraps it in
 * db/index.ts, swaps postgres-js's date parsers for pass-through ones. The
 * rows here promise a Date — the Persian-month bucketing needs one — so they
 * are converted on the way out. Postgres's ISO text output parses exactly.
 */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function rate(live: number | null) {
  return live === null ? sql`o.fx_rate_to_rial` : sql`COALESCE(o.fx_rate_to_rial, ${live})`;
}
function salesRial(live: number | null = null) {
  return sql`ROUND(o.total_cents::numeric * ${rate(live)} / 100)::float8`;
}
function commissionRial(live: number | null = null) {
  return sql`ROUND(o.total_cents::numeric * ${rate(live)} * o.commission_rate_bp / 1000000)::float8`;
}

export type DeliveredRow = {
  deliveredAt: Date;
  /** The customer's id, or the order's company for an order whose customer is gone. */
  customerKey: string;
  company: string;
  salesRial: number;
  commissionRial: number;
};

/** Every sale credited to the rep, oldest first. The dashboard's only large read. */
export async function listDeliveredForRep(repId: string, db: Db = sql): Promise<DeliveredRow[]> {
  const rows = await db<DeliveredRow[]>`
    SELECT o.delivered_at AS "deliveredAt",
           COALESCE(o.user_id::text, 'order:' || o.company) AS "customerKey",
           COALESCE(u.company, o.company) AS company,
           ${salesRial()} AS "salesRial", ${commissionRial()} AS "commissionRial"
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.rep_id = ${repId} AND o.status = 'delivered'
    ORDER BY o.delivered_at
  `;
  return Array.from(rows, (row) => ({ ...row, deliveredAt: toDate(row.deliveredAt) }));
}

export type InProgressRow = {
  ref: string;
  status: OrderStatus;
  company: string;
  createdAt: Date;
  salesRial: number;
  commissionRial: number;
  /** True until the order is invoiced and its rate frozen. */
  estimate: boolean;
};

export async function listInProgressForRep(
  repId: string,
  liveRate: number,
  db: Db = sql,
): Promise<InProgressRow[]> {
  const rows = await db<InProgressRow[]>`
    SELECT o.ref, o.status, COALESCE(u.company, o.company) AS company,
           o.created_at AS "createdAt",
           ${salesRial(liveRate)} AS "salesRial", ${commissionRial(liveRate)} AS "commissionRial",
           (o.fx_rate_to_rial IS NULL) AS estimate
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.rep_id = ${repId} AND o.status IN ('received', 'invoiced', 'payment_review', 'preparing', 'shipped')
    ORDER BY o.created_at DESC
    LIMIT 200
  `;
  return Array.from(rows, (row) => ({ ...row, createdAt: toDate(row.createdAt) }));
}

export async function salesByCustomerForRep(repId: string, db: Db = sql): Promise<Map<string, number>> {
  const rows = await db<{ customerId: string; salesRial: number }[]>`
    SELECT o.user_id AS "customerId", SUM(${salesRial()})::float8 AS "salesRial"
    FROM orders o
    WHERE o.rep_id = ${repId} AND o.status = 'delivered' AND o.user_id IS NOT NULL
    GROUP BY o.user_id
  `;
  return new Map(rows.map((row) => [row.customerId, row.salesRial]));
}

export type RepTotals = { repId: string; earnedRial: number; paidRial: number };

/** All reps, all time: one row each, for the admin's list. */
export async function listRepTotals(db: Db = sql): Promise<Map<string, RepTotals>> {
  const rows = await db<RepTotals[]>`
    SELECT r.id AS "repId",
           COALESCE((SELECT SUM(${commissionRial()}) FROM orders o
                     WHERE o.rep_id = r.id AND o.status = 'delivered'), 0)::float8 AS "earnedRial",
           COALESCE((SELECT SUM(p.amount_rial) FROM rep_payouts p WHERE p.rep_id = r.id), 0)::float8 AS "paidRial"
    FROM sales_reps r
  `;
  return new Map(rows.map((row) => [row.repId, row]));
}

/** Deliveries in the last `days`, for "this month" per rep — bucketed by the caller. */
export async function listRecentDeliveries(
  days: number,
  db: Db = sql,
): Promise<{ repId: string; deliveredAt: Date; salesRial: number }[]> {
  const rows = await db<{ repId: string; deliveredAt: Date; salesRial: number }[]>`
    SELECT o.rep_id AS "repId", o.delivered_at AS "deliveredAt", ${salesRial()} AS "salesRial"
    FROM orders o
    WHERE o.rep_id IS NOT NULL AND o.status = 'delivered'
      AND o.delivered_at >= now() - make_interval(days => ${days})
  `;
  return Array.from(rows, (row) => ({ ...row, deliveredAt: toDate(row.deliveredAt) }));
}

export type Payout = { id: number; amountRial: number; note: string; createdAt: Date };

export async function listPayouts(repId: string, db: Db = sql): Promise<Payout[]> {
  const rows = await db<Payout[]>`
    SELECT id, amount_rial::float8 AS "amountRial", note, created_at AS "createdAt"
    FROM rep_payouts WHERE rep_id = ${repId}
    ORDER BY created_at DESC, id DESC
  `;
  return Array.from(rows, (row) => ({ ...row, createdAt: toDate(row.createdAt) }));
}

export async function addPayout(repId: string, amountRial: number, note: string, db: Db = sql): Promise<void> {
  await db`INSERT INTO rep_payouts (rep_id, amount_rial, note) VALUES (${repId}, ${amountRial}, ${note})`;
}

/** For a payout recorded by mistake. Scoped to the rep, so a posted id cannot reach another's. */
export async function deletePayout(repId: string, payoutId: number, db: Db = sql): Promise<boolean> {
  const result = await db`DELETE FROM rep_payouts WHERE id = ${payoutId} AND rep_id = ${repId}`;
  return result.count === 1;
}

export async function listTargets(repId: string, db: Db = sql): Promise<TargetRow[]> {
  const rows = await db<TargetRow[]>`
    SELECT persian_year AS year, persian_month AS month, amount_rial::float8 AS "amountRial"
    FROM rep_targets WHERE rep_id = ${repId}
    ORDER BY persian_year, persian_month
  `;
  return Array.from(rows);
}

export async function listAllTargets(db: Db = sql): Promise<Map<string, TargetRow[]>> {
  const rows = await db<(TargetRow & { repId: string })[]>`
    SELECT rep_id AS "repId", persian_year AS year, persian_month AS month,
           amount_rial::float8 AS "amountRial"
    FROM rep_targets
  `;
  const byRep = new Map<string, TargetRow[]>();
  for (const { repId, ...target } of rows) byRep.set(repId, [...(byRep.get(repId) ?? []), target]);
  return byRep;
}

/** A target from this month on, until a later one replaces it (lib/repStats.ts `targetFor`). */
export async function setTarget(
  repId: string,
  ym: PersianYearMonth,
  amountRial: number,
  db: Db = sql,
): Promise<void> {
  await db`
    INSERT INTO rep_targets (rep_id, persian_year, persian_month, amount_rial)
    VALUES (${repId}, ${ym.year}, ${ym.month}, ${amountRial})
    ON CONFLICT (rep_id, persian_year, persian_month)
    DO UPDATE SET amount_rial = EXCLUDED.amount_rial, updated_at = now()
  `;
}
