import "server-only";
import { sql } from "./index";
import { recordAudit } from "./audit";
import type { TransactionSql } from "postgres";
import type { Db } from "./repMoney";
import {
  leadRepId,
  resolveShares,
  splitProblem,
  type SplitProblem,
  type SplitRow,
} from "@/lib/commissionSplit";

/**
 * Who looks after an account: `customer_reps`, up to five reps with optional
 * shares. `users.rep_id` / `rep_earns_commission` are still written here so
 * the release running during a deploy keeps seeing a consistent account, but
 * nothing new reads them.
 */
export type AccountRep = {
  repId: string;
  name: string;
  active: boolean;
  shareBp: number | null; // as stored
  effectiveShareBp: number; // after resolveShares
  isLead: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

type StoredRow = { repId: string; name: string; active: boolean; shareBp: number | null };

// `added_at` then `rep_id`: rows saved together get distinct clock times (see
// setAccountReps), the id only makes the order total if two ever tie.
async function storedRows(customerId: string, db: Db): Promise<StoredRow[]> {
  return db<StoredRow[]>`
    SELECT cr.rep_id AS "repId", r.name, r.active, cr.share_bp AS "shareBp"
    FROM customer_reps cr JOIN sales_reps r ON r.id = cr.rep_id
    WHERE cr.user_id = ${customerId}
    ORDER BY cr.added_at, cr.rep_id
  `;
}

/** Rows in added_at order. */
export async function listAccountReps(customerId: string, db: Db = sql): Promise<AccountRep[]> {
  const rows = await storedRows(customerId, db);
  const split: SplitRow[] = rows.map((row) => ({ repId: row.repId, shareBp: row.shareBp }));
  const effective = new Map(resolveShares(split).map((row) => [row.repId, row.shareBp]));
  const lead = leadRepId(split);
  return rows.map((row) => ({
    ...row,
    effectiveShareBp: effective.get(row.repId) ?? 0,
    isLead: row.repId === lead,
  }));
}

/** SQL fragment: true when `u` (the users alias) has this rep on its list. For WHERE clauses. */
export function onMyList(repId: string) {
  return sql`EXISTS (SELECT 1 FROM customer_reps cr WHERE cr.user_id = u.id AND cr.rep_id = ${repId})`;
}

/**
 * SQL fragment: the id of `u`'s lead rep (biggest share, earliest added on a
 * tie; every share blank means the earliest), the same rule as `leadRepId`.
 * Blank counts as 0 so an all-blank list falls through to `added_at`.
 */
export function leadRepSql() {
  return sql`(SELECT lcr.rep_id FROM customer_reps lcr WHERE lcr.user_id = u.id
              ORDER BY COALESCE(lcr.share_bp, 0) DESC, lcr.added_at, lcr.rep_id LIMIT 1)`;
}

/** SQL fragment: true when `u` has no rep at all. */
export function unassigned() {
  return sql`NOT EXISTS (SELECT 1 FROM customer_reps cr WHERE cr.user_id = u.id)`;
}

export type SaveSplitResult = "ok" | "not-found" | "bad-rep" | SplitProblem; // "empty" never returned: [] unassigns

export async function setAccountReps(
  customerId: string,
  rows: readonly SplitRow[],
  accountRateBp: number | null,
): Promise<SaveSplitResult> {
  // An empty list is allowed here (it unassigns), so only a non-empty one is judged.
  if (rows.length > 0) {
    const problem = splitProblem(rows);
    if (problem !== null) return problem;
  }
  return sql.begin(async (tx) => {
    // The user row lock is what orders and payments serialise on: an order
    // read the list either before this save or after it, never halfway.
    const [user] = await tx<{ rate: number | null }[]>`
      SELECT commission_rate_bp AS rate FROM users WHERE id = ${customerId} FOR UPDATE
    `;
    if (!user) return "not-found" as const;

    const before = await storedRows(customerId, tx);
    const onList = new Set(before.map((row) => row.repId));
    // Only a rep being added must be active: one already listed may stay after
    // being deactivated, or saving any other change to the account would fail.
    const added = rows.map((row) => row.repId).filter((id) => !onList.has(id));
    if (added.length > 0) {
      // FOR SHARE so a rep cannot be deactivated between this check and the
      // write (same trap as assignCustomer, review M-18); sorted so two saves
      // adding the same reps lock them in the same order.
      const active = await tx<{ id: string }[]>`
        SELECT id FROM sales_reps WHERE id = ANY(${added}::uuid[]) AND active ORDER BY id FOR SHARE
      `;
      if (active.length !== added.length) return "bad-rep" as const;
    }

    const keep = rows.map((row) => row.repId);
    await tx`DELETE FROM customer_reps WHERE user_id = ${customerId} AND rep_id <> ALL(${keep}::uuid[])`;
    for (const row of rows) {
      // clock_timestamp(), not the default now(): now() is frozen for the whole
      // transaction, which would give every new row the same added_at and make
      // "the first added" (the lead on a tie) undefined.
      await tx`
        INSERT INTO customer_reps (user_id, rep_id, share_bp, added_at)
        VALUES (${customerId}, ${row.repId}, ${row.shareBp}::int, clock_timestamp())
        ON CONFLICT (user_id, rep_id) DO UPDATE SET share_bp = EXCLUDED.share_bp
      `;
    }

    const rate = rows.length === 0 ? null : accountRateBp;
    const after = await storedRows(customerId, tx);
    const lead = leadRepId(after.map((row) => ({ repId: row.repId, shareBp: row.shareBp })));
    await tx`
      UPDATE users
      SET commission_rate_bp = ${rate}::int, rep_id = ${lead}::uuid,
          rep_earns_commission = ${lead !== null && rate !== 0}
      WHERE id = ${customerId}
    `;
    const plain = (list: StoredRow[]) => list.map((row) => ({ repId: row.repId, shareBp: row.shareBp }));
    await recordAudit(tx, {
      actor: { kind: "admin" },
      action: "customer.reps-changed",
      subject: { kind: "customer", id: customerId },
      detail: { before: plain(before), after: plain(after), rateBefore: user.rate, rateAfter: rate },
    });
    return "ok" as const;
  });
}

export type RepAccess = "mine" | "unassigned" | "taken" | "missing";

export async function repAccess(repId: string, customerId: string, db: Db = sql): Promise<RepAccess> {
  const [row] = await db<{ mine: boolean; any: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM customer_reps cr WHERE cr.user_id = u.id AND cr.rep_id = ${repId}) AS mine,
           EXISTS (SELECT 1 FROM customer_reps cr WHERE cr.user_id = u.id) AS any
    FROM users u WHERE u.id = ${customerId}
  `;
  if (!row) return "missing";
  if (row.mine) return "mine";
  return row.any ? "taken" : "unassigned";
}

/** Accounts that list a deactivated rep, newest first, for the admin attention list. */
export async function listAccountsWithInactiveRep(): Promise<
  { customerId: string; company: string; customerCode: string; inactiveReps: string[] }[]
> {
  return sql`
    SELECT u.id AS "customerId", COALESCE(u.company, '') AS company, u.customer_code AS "customerCode",
           array_agg(r.name ORDER BY cr.added_at, cr.rep_id) AS "inactiveReps"
    FROM customer_reps cr
    JOIN sales_reps r ON r.id = cr.rep_id AND NOT r.active
    JOIN users u ON u.id = cr.user_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `;
}

export type OrderSplit = {
  rateBp: number; // users.commission_rate_bp ?? lead rep's commission_rate_bp
  leadRepId: string; // lead of the whole list, active or not
  shares: { repId: string; shareBp: number }[]; // active reps only; may be empty
};

/**
 * Who is credited, and at what rate — decided once, as the order is written,
 * and copied onto it so a later move or rate change cannot reach back into it.
 * The customer row is locked FOR UPDATE before the list is read, the same lock
 * `setAccountReps` takes first: a save lands wholly before or wholly after this
 * read, never halfway, and the lock is held until the order commits. A
 * deactivated rep is left out (not redistributed to): deactivation moves
 * customers, so this is only the window between the two, and a locked-out rep
 * earning from it would be wrong. The rate still follows the lead of the whole
 * list, so an inactive lead does not change what the others are paid at.
 * Null when the account has no reps.
 */
export async function splitForOrder(tx: Tx, userId: string): Promise<OrderSplit | null> {
  const [user] = await tx<{ rate: number | null }[]>`
    SELECT commission_rate_bp AS rate FROM users WHERE id = ${userId} FOR UPDATE
  `;
  if (!user) return null;
  const rows = await storedRows(userId, tx);
  if (rows.length === 0) return null;

  const split: SplitRow[] = rows.map((row) => ({ repId: row.repId, shareBp: row.shareBp }));
  const lead = leadRepId(split)!;
  let rateBp = user.rate;
  if (rateBp === null) {
    const [leadRep] = await tx<{ rate: number }[]>`
      SELECT commission_rate_bp AS rate FROM sales_reps WHERE id = ${lead}
    `;
    rateBp = leadRep?.rate ?? 0;
  }
  const activeIds = new Set(rows.filter((row) => row.active).map((row) => row.repId));
  return {
    rateBp,
    leadRepId: lead,
    shares: resolveShares(split).filter((share) => activeIds.has(share.repId)),
  };
}

/**
 * Writes the order's copy and the legacy `orders.rep_id` / rate (the biggest
 * active share; the earliest on a tie). A no-op without active reps, which
 * leaves the order uncredited. One UPDATE sets both legacy columns because a
 * credited order must carry its rate.
 */
export async function writeOrderShares(tx: Tx, orderId: number, split: OrderSplit): Promise<void> {
  if (split.shares.length === 0) return;
  await tx`
    INSERT INTO order_rep_shares (order_id, rep_id, share_bp)
    SELECT ${orderId}, s.rep_id, s.share_bp
    FROM unnest(${split.shares.map((share) => share.repId)}::uuid[], ${split.shares.map((share) => share.shareBp)}::int[])
      AS s(rep_id, share_bp)
  `;
  let biggest = split.shares[0];
  for (const share of split.shares) if (share.shareBp > biggest.shareBp) biggest = share;
  await tx`
    UPDATE orders SET rep_id = ${biggest.repId}, commission_rate_bp = ${split.rateBp} WHERE id = ${orderId}
  `;
}

export type ClaimResult = "claimed" | "credited" | "lost" | "not-applicable";

/**
 * A rep who placed an order for a customer nobody looks after wins that
 * customer only when the order is PAID, which is `confirmPayment` (admin) and
 * nothing a rep can do: placing, cancelling, letting it lapse or uploading a
 * receipt all leave the customer unassigned. Called inside confirmPayment's
 * transaction, after the status update, so the order row is already locked.
 * The customer row is then locked FOR UPDATE, the lock `setAccountReps` and
 * `splitForOrder` take: two reps' orders confirmed at once serialise here, the
 * second finds the first on the list and loses, and an admin save lands wholly
 * before or after. A losing order keeps no shares: it is not credited to
 * someone who did not win the customer.
 */
export async function claimCustomerForOrder(tx: Tx, orderId: number): Promise<ClaimResult> {
  const [order] = await tx<{ userId: string | null; repId: string | null; credited: boolean }[]>`
    SELECT user_id AS "userId", placed_by_rep_id AS "repId",
           EXISTS (SELECT 1 FROM order_rep_shares s WHERE s.order_id = orders.id) AS credited
    FROM orders WHERE id = ${orderId}
  `;
  if (!order || !order.userId || !order.repId || order.credited) return "not-applicable";

  const [user] = await tx<{ rate: number | null }[]>`
    SELECT commission_rate_bp AS rate FROM users WHERE id = ${order.userId} FOR UPDATE
  `;
  if (!user) return "not-applicable";
  // FOR SHARE after the customer lock, the order `setAccountReps` and
  // `deactivateRep` use: read unlocked, a rep deactivated mid-claim could
  // still win the customer. No row means inactive (or gone): lost.
  const [rep] = await tx<{ active: boolean; rate: number }[]>`
    SELECT active, commission_rate_bp AS rate FROM sales_reps WHERE id = ${order.repId} AND active FOR SHARE
  `;
  if (!rep) return "lost";

  const rows = await storedRows(order.userId, tx);
  const onList = rows.some((row) => row.repId === order.repId);
  if (rows.length > 0 && !onList) return "lost";

  // The order's own copy is 100% to the placing rep, whatever the account
  // split becomes: only this rep earned this customer.
  await writeOrderShares(tx, orderId, {
    rateBp: user.rate ?? rep.rate,
    leadRepId: order.repId,
    shares: [{ repId: order.repId, shareBp: 10000 }],
  });
  if (onList) return "credited";

  // clock_timestamp() for the same reason as setAccountReps.
  await tx`
    INSERT INTO customer_reps (user_id, rep_id, share_bp, added_at)
    VALUES (${order.userId}, ${order.repId}, NULL, clock_timestamp())
  `;
  await tx`
    UPDATE users SET rep_id = ${order.repId}, rep_earns_commission = true WHERE id = ${order.userId}
  `;
  await recordAudit(tx, {
    actor: { kind: "system" },
    action: "customer.claimed",
    subject: { kind: "customer", id: order.userId },
    detail: { orderId, repId: order.repId },
  });
  return "claimed";
}
