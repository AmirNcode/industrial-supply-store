import "server-only";
import { sql } from "./index";
import { uniqueViolation } from "./pgErrors";
import { recordAudit } from "./audit";
import { randomReferralCode } from "@/lib/repAccount";
import { leadRepSql } from "./accountRepQueries";

export type RepRow = {
  id: string;
  username: string;
  name: string;
  phone: string;
  email: string;
  commissionRateBp: number;
  referralCode: string;
  active: boolean;
  mustChangePassword: boolean;
  sessionVersion: number;
  createdAt: string;
  lastLoginAt: string | null;
};

export type RepInput = {
  username: string;
  name: string;
  phone: string;
  email: string;
  commissionRateBp: number;
};

const COLS = sql`id, username, name, phone, email,
  commission_rate_bp AS "commissionRateBp", referral_code AS "referralCode", active,
  must_change_password AS "mustChangePassword", session_version AS "sessionVersion",
  created_at AS "createdAt", last_login_at AS "lastLoginAt"`;

/** The constraint a unique violation hit, or null for any other error. */
export async function getRepById(id: string): Promise<RepRow | null> {
  const [row] = await sql<RepRow[]>`SELECT ${COLS} FROM sales_reps WHERE id = ${id}`;
  return row ?? null;
}

/** The hash stays out of `RepRow`, which is passed into Server Components. */
export async function findRepForSignIn(
  username: string,
): Promise<(RepRow & { passwordHash: string }) | null> {
  const [row] = await sql<(RepRow & { passwordHash: string })[]>`
    SELECT ${COLS}, password_hash AS "passwordHash" FROM sales_reps WHERE username = ${username}
  `;
  return row ?? null;
}

export async function getRepPasswordHash(id: string): Promise<string | null> {
  const [row] = await sql<{ passwordHash: string }[]>`
    SELECT password_hash AS "passwordHash" FROM sales_reps WHERE id = ${id}
  `;
  return row?.passwordHash ?? null;
}

export async function touchRepLogin(id: string): Promise<void> {
  await sql`UPDATE sales_reps SET last_login_at = now() WHERE id = ${id}`;
}

/**
 * Stores a new hash and ends every open session for this rep, by moving the
 * session version on. Returns the new version so the caller can re-issue its
 * own cookie, or null when there is no such rep.
 */
export async function setRepPassword(
  id: string,
  passwordHash: string,
  mustChange: boolean,
): Promise<number | null> {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ sessionVersion: number }[]>`
      UPDATE sales_reps
      SET password_hash = ${passwordHash}, must_change_password = ${mustChange},
          session_version = session_version + 1
      WHERE id = ${id}
      RETURNING session_version AS "sessionVersion"
    `;
    if (!row) return null;
    // A forced change is the admin's reset; an unforced one is the rep's own.
    await recordAudit(tx, {
      actor: mustChange ? { kind: "admin" } : { kind: "rep", id },
      action: mustChange ? "rep.password-reset" : "rep.password-changed",
      subject: { kind: "rep", id },
    });
    return row.sessionVersion;
  });
}

/** A stronger hash of the same password; see `upgradePasswordHash` in userQueries. */
export async function upgradeRepPasswordHash(repId: string, oldHash: string, newHash: string): Promise<void> {
  await sql`UPDATE sales_reps SET password_hash = ${newHash} WHERE id = ${repId} AND password_hash = ${oldHash}`;
}

/**
 * The unique indexes decide, not a lookup first — two admins creating "sara"
 * at once would both pass a check. A clash on the random referral code is not
 * the admin's problem, so it is retried rather than reported.
 */
export async function createRep(
  input: RepInput & { passwordHash: string },
): Promise<RepRow | "username-taken"> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const [row] = await sql<RepRow[]>`
        INSERT INTO sales_reps (username, password_hash, name, phone, email,
                                commission_rate_bp, referral_code)
        VALUES (${input.username}, ${input.passwordHash}, ${input.name}, ${input.phone},
                ${input.email}, ${input.commissionRateBp}, ${randomReferralCode()})
        RETURNING ${COLS}
      `;
      return row;
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint === "sales_reps_username_key") return "username-taken";
      if (constraint === "sales_reps_referral_code_key") continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique referral code");
}

export async function updateRep(
  id: string,
  input: RepInput,
): Promise<"ok" | "not-found" | "username-taken"> {
  try {
    const result = await sql`
      UPDATE sales_reps
      SET username = ${input.username}, name = ${input.name}, phone = ${input.phone},
          email = ${input.email}, commission_rate_bp = ${input.commissionRateBp}
      WHERE id = ${id}
    `;
    return result.count === 0 ? "not-found" : "ok";
  } catch (err) {
    if (uniqueViolation(err) === "sales_reps_username_key") return "username-taken";
    throw err;
  }
}

export async function listReps(): Promise<(RepRow & { customerCount: number })[]> {
  return sql<(RepRow & { customerCount: number })[]>`
    SELECT ${COLS},
           (SELECT count(*)::int FROM customer_reps cr WHERE cr.rep_id = sales_reps.id) AS "customerCount"
    FROM sales_reps
    ORDER BY active DESC, name
  `;
}

export async function listActiveReps(): Promise<{ id: string; name: string }[]> {
  return sql<{ id: string; name: string }[]>`
    SELECT id, name FROM sales_reps WHERE active ORDER BY name
  `;
}

/**
 * Locks the rep out and moves the accounts that list them to `destination`.
 * One transaction: a rep who is locked out but still on accounts would go on
 * being credited with their orders. Moving the session version on is what ends
 * a session that is open right now.
 *
 * With a destination, in each account listing this rep: if the destination is
 * already listed, the rep's stored share is added to it (only when shares are
 * filled; blank shares need nothing) and the rep's row is deleted; otherwise
 * the row is repointed to the destination, keeping its share and position.
 * Without one the rows stay: the admin attention list shows accounts that
 * still list an inactive rep, and the order split skips them (spec decision
 * 12). `users.rep_id` is kept in step for the release running beside this one.
 *
 * Lock order is the one `setAccountReps` and the claim use: the customer rows
 * first (sorted by id, so two deactivations lock in the same order), then the
 * destination rep row FOR SHARE, then this rep's row. An account added to this
 * rep between the first lock and the rep update is not in the locked set; it
 * keeps the inactive rep and shows on the attention list rather than being
 * touched without its lock.
 */
export async function deactivateRep(
  id: string,
  destination: string | null,
): Promise<"ok" | "not-found" | "bad-destination"> {
  return sql.begin(async (tx) => {
    if (destination === id) return "bad-destination" as const;
    const locked = await tx<{ id: string }[]>`
      SELECT u.id FROM users u
      WHERE u.id IN (SELECT cr.user_id FROM customer_reps cr WHERE cr.rep_id = ${id})
      ORDER BY u.id FOR UPDATE
    `;
    const accounts = locked.map((row) => row.id);
    if (destination !== null) {
      const [dest] = await tx`SELECT 1 FROM sales_reps WHERE id = ${destination} AND active FOR SHARE`;
      if (!dest) return "bad-destination" as const;
    }
    const result = await tx`
      UPDATE sales_reps SET active = false, session_version = session_version + 1
      WHERE id = ${id} AND active
    `;
    if (result.count === 0) return "not-found" as const;

    if (destination !== null && accounts.length > 0) {
      // Merge first, then delete, then repoint: the rows left at the end are
      // exactly those whose account does not list the destination yet.
      await tx`
        UPDATE customer_reps d SET share_bp = COALESCE(d.share_bp, 0) + s.share_bp
        FROM customer_reps s
        WHERE d.rep_id = ${destination} AND s.rep_id = ${id} AND s.user_id = d.user_id
          AND d.user_id = ANY(${accounts}::uuid[]) AND s.share_bp IS NOT NULL
      `;
      await tx`
        DELETE FROM customer_reps s
        WHERE s.rep_id = ${id} AND s.user_id = ANY(${accounts}::uuid[])
          AND EXISTS (SELECT 1 FROM customer_reps d WHERE d.user_id = s.user_id AND d.rep_id = ${destination})
      `;
      await tx`
        UPDATE customer_reps SET rep_id = ${destination}
        WHERE rep_id = ${id} AND user_id = ANY(${accounts}::uuid[])
      `;
      await tx`
        UPDATE users u
        SET rep_id = ${leadRepSql()}, rep_earns_commission = (${leadRepSql()} IS NOT NULL AND u.commission_rate_bp IS DISTINCT FROM 0)
        WHERE u.id = ANY(${accounts}::uuid[])
      `;
    }
    await recordAudit(tx, {
      actor: { kind: "admin" },
      action: "rep.deactivated",
      subject: { kind: "rep", id },
      detail: { movedTo: destination, customers: accounts.length },
    });
    return "ok" as const;
  });
}

export async function reactivateRep(id: string): Promise<void> {
  await sql`UPDATE sales_reps SET active = true WHERE id = ${id}`;
}

export async function getActiveRepByReferralCode(code: string): Promise<{ id: string } | null> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM sales_reps WHERE referral_code = ${code} AND active
  `;
  return row ?? null;
}
