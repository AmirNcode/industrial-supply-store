import "server-only";
import { sql } from "./index";
import { codeFromPhone, randomCustomerCode, type LoginIdentifier } from "@/lib/customerCode";
import { leadRepSql } from "./accountRepQueries";

export type UserRow = {
  id: string;
  /** Null for an account a rep created without one. */
  email: string | null;
  customerCode: string;
  company: string;
  contactName: string;
  phone: string;
  defaultPoNumber: string;
  locale: string;
  address: string;
  city: string;
  repId: string | null;
  mustChangePassword: boolean;
  nationalId: string;
  economicCode: string;
  /**
   * True for an account that has never chosen a password: one made from a
   * guest checkout or a sign-up, which are created without one. It signs in
   * by emailed code and is sent to choose a password before anything else.
   * A rep-created account is never this — it has the rep's temporary password
   * and its own forced-change page (`mustChangePassword`).
   */
  needsPassword: boolean;
  /**
   * Whether a sign-in code may be emailed to this account: it has an address,
   * and that address is either the customer's own typing or already proved.
   * A rep-typed address that nobody has verified is excluded — a typo there
   * would hand the account to a stranger's inbox.
   */
  codeSignIn: boolean;
};

const COLS = sql`id, email, customer_code AS "customerCode", company,
                 contact_name AS "contactName", phone,
                 default_po_number AS "defaultPoNumber", locale, address, city,
                 rep_id AS "repId", must_change_password AS "mustChangePassword",
                 national_id AS "nationalId", economic_code AS "economicCode",
                 (origin <> 'rep' AND NOT chose_own_password) AS "needsPassword",
                 (email IS NOT NULL AND (origin <> 'rep' OR email_verified_at IS NOT NULL)) AS "codeSignIn"`;

export async function getUserById(id: string): Promise<UserRow | null> {
  // Session token verification rejects malformed UUIDs before this query, so
  // keeping both sides as uuid preserves the users primary-key index.
  const rows = await sql<UserRow[]>`
    SELECT ${COLS} FROM users WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * One sign-in field: a seven-digit ID or an email, never both kinds of lookup.
 * Carries the session version the sign-in guard's device mark is checked
 * against (`lib/deviceMark.ts`).
 */
export async function findUserForSignIn(
  login: LoginIdentifier,
): Promise<(UserRow & { passwordHash: string; sessionVersion: number }) | null> {
  const where =
    login.kind === "code"
      ? sql`customer_code = ${login.code}`
      : sql`lower(email) = lower(${login.email})`;
  const rows = await sql<(UserRow & { passwordHash: string; sessionVersion: number })[]>`
    SELECT ${COLS}, password_hash AS "passwordHash", session_version AS "sessionVersion"
    FROM users WHERE ${where} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * A stronger hash of the same password (`needsRehash`). Only the hash moves —
 * no flag, no session version — and only if nobody changed the password in
 * the meantime.
 */
export async function upgradePasswordHash(userId: string, oldHash: string, newHash: string): Promise<void> {
  await sql`UPDATE users SET password_hash = ${newHash} WHERE id = ${userId} AND password_hash = ${oldHash}`;
}

/** The session version a cookie must carry; null for no such account. */
export async function getSessionVersion(userId: string): Promise<number | null> {
  const [row] = await sql<{ version: number }[]>`
    SELECT session_version AS version FROM users WHERE id = ${userId}
  `;
  return row?.version ?? null;
}

export type NewUser = {
  email: string;
  /** A hash of random bytes nobody knows: the account's first password is chosen after a code sign-in. */
  passwordHash: string;
  company: string;
  contactName: string;
  phone: string;
  locale: string;
  /**
   * 'referral' only with the rep whose link brought them; that rep earns
   * commission. 'checkout' is an account made from a guest order.
   */
  origin: "self" | "referral" | "checkout";
  repId: string | null;
  accountNumber: "phone" | "assigned";
};

/**
 * Returns "email-taken" rather than throwing, because a duplicate address is
 * an ordinary thing for a person to do, not an exceptional condition.
 *
 * The unique indexes decide, not a check first — sign-up is exactly where two
 * simultaneous attempts collide. Which index was hit matters: a clash on the
 * email is the person's, reported; a clash on the customer ID is not theirs,
 * and a self sign-up is never shown an error for something it did not choose,
 * so it quietly takes a random ID instead.
 */
export async function createUser(input: NewUser): Promise<UserRow | "email-taken"> {
  // Sign-up lets the customer choose: their phone's digits, or an assigned
  // number. A checkout account was never asked, so it is assigned one.
  let code =
    (input.accountNumber === "phone" ? codeFromPhone(input.phone) : null) ?? randomCustomerCode();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      // The referring rep goes on the account's list in the same transaction
      // as the user row: the list is what gives the rep the customer. The
      // legacy columns are still written for the release running beside this one.
      return await sql.begin(async (tx) => {
        const rows = await tx<UserRow[]>`
          INSERT INTO users (email, password_hash, company, contact_name, phone, locale,
                             customer_code, origin, rep_id, origin_rep_id, rep_earns_commission,
                             chose_own_password)
          VALUES (${input.email}, ${input.passwordHash}, ${input.company},
                  ${input.contactName}, ${input.phone}, ${input.locale}, ${code},
                  ${input.origin}, ${input.repId}, ${input.repId}, ${input.repId !== null},
                  -- No password has been chosen yet (see needsPassword).
                  false)
          RETURNING ${COLS}
        `;
        if (input.repId !== null) {
          await tx`INSERT INTO customer_reps (user_id, rep_id, share_bp) VALUES (${rows[0].id}, ${input.repId}, NULL)`;
        }
        return rows[0];
      });
    } catch (err) {
      const e = err as { code?: string; constraint_name?: string };
      if (e?.code !== "23505") throw err;
      if (e.constraint_name === "users_customer_code_key") {
        code = randomCustomerCode();
        continue;
      }
      return "email-taken";
    }
  }
  throw new Error("Could not allocate a unique customer ID");
}

export async function updateProfile(
  id: string,
  input: {
    company: string;
    contactName: string;
    phone: string;
    defaultPoNumber: string;
    locale: string;
    nationalId: string;
    economicCode: string;
  },
): Promise<void> {
  // `users.address` and `users.city` are no longer written: delivery
  // addresses live in `user_addresses` (db/addressQueries.ts). The columns
  // stay for the reps' customer pages, which still read them.
  await sql`
    UPDATE users
    SET company = ${input.company}, contact_name = ${input.contactName},
        phone = ${input.phone}, default_po_number = ${input.defaultPoNumber},
        locale = ${input.locale}, national_id = ${input.nationalId},
        economic_code = ${input.economicCode}
    WHERE id = ${id}
  `;
}

/**
 * The customer's rep, for "Your sales rep": the lead if active, else the first
 * active rep on the list in the order they were added, else nobody.
 */
export async function getRepContactForUser(
  userId: string,
): Promise<{ name: string; phone: string } | null> {
  const [row] = await sql<{ name: string; phone: string }[]>`
    SELECT r.name, r.phone
    FROM users u
    JOIN customer_reps cr ON cr.user_id = u.id
    JOIN sales_reps r ON r.id = cr.rep_id AND r.active
    WHERE u.id = ${userId}
    ORDER BY (cr.rep_id = ${leadRepSql()}) DESC, cr.added_at, cr.rep_id
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * `mustChange` is true for a password someone else chose — a rep or admin
 * reset — so the customer replaces it at their next sign-in, and false for one
 * the customer chose themselves.
 */
export async function setPassword(
  userId: string,
  passwordHash: string,
  mustChange: boolean,
): Promise<void> {
  await sql`
    UPDATE users
    SET password_hash = ${passwordHash}, must_change_password = ${mustChange},
        -- A password nobody forces them to replace is one they chose.
        chose_own_password = chose_own_password OR ${!mustChange},
        -- Every other open session ends (lib/sessionToken.ts).
        session_version = session_version + 1
    WHERE id = ${userId}
  `;
}

/**
 * Its own query rather than a field on `UserRow`.
 *
 * `UserRow` is passed straight into Server Components, so the hash is left out
 * of it deliberately — a field that exists is a field that eventually gets
 * rendered or serialised into an RSC payload. Only the one caller that has to
 * compare a password reaches for this.
 */
export async function getPasswordHash(userId: string): Promise<string | null> {
  const [row] = await sql<{ passwordHash: string }[]>`
    SELECT password_hash AS "passwordHash" FROM users WHERE id = ${userId}
  `;
  return row?.passwordHash ?? null;
}

export async function touchLastLogin(userId: string): Promise<void> {
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${userId}`;
}

/** The account an email belongs to, for attaching a guest order to it. */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 1
  `;
  return row?.id ?? null;
}

/**
 * After a code sign-in the stored password is no longer trusted — it may be
 * the random one an account is born with, or one the owner has forgotten, or
 * one a stranger set before the owner proved the address. Clearing
 * `chose_own_password` sends the account to choose one (`needsPassword`).
 *
 * Distrusting it has to be real, not a flag: the old password is replaced by
 * an unusable one and every open session ends. Otherwise whoever held the old
 * password or an old session keeps it — and since the choose-a-password form
 * asks for no current password, an old session could set the new one first.
 * The caller reissues only the browser that entered the code.
 */
export async function requireNewPassword(userId: string, unusableHash: string): Promise<void> {
  await sql`
    UPDATE users
    SET chose_own_password = false, password_hash = ${unusableHash},
        session_version = session_version + 1
    WHERE id = ${userId} AND origin <> 'rep'
  `;
}
