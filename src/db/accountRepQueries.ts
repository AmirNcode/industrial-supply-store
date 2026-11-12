import "server-only";
import { sql } from "./index";
import { recordAudit } from "./audit";
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
