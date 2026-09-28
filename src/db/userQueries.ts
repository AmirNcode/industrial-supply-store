import "server-only";
import { sql } from "./index";
import { codeFromPhone, randomCustomerCode, type LoginIdentifier } from "@/lib/customerCode";

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
};

const COLS = sql`id, email, customer_code AS "customerCode", company,
                 contact_name AS "contactName", phone,
                 default_po_number AS "defaultPoNumber", locale, address, city,
                 rep_id AS "repId", must_change_password AS "mustChangePassword"`;

export async function getUserById(id: string): Promise<UserRow | null> {
  // Session token verification rejects malformed UUIDs before this query, so
  // keeping both sides as uuid preserves the users primary-key index.
  const rows = await sql<UserRow[]>`
    SELECT ${COLS} FROM users WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ?? null;
}

/** One sign-in field: a seven-digit ID or an email, never both kinds of lookup. */
export async function findUserForSignIn(
  login: LoginIdentifier,
): Promise<(UserRow & { passwordHash: string }) | null> {
  const where =
    login.kind === "code"
      ? sql`customer_code = ${login.code}`
      : sql`lower(email) = lower(${login.email})`;
  const rows = await sql<(UserRow & { passwordHash: string })[]>`
    SELECT ${COLS}, password_hash AS "passwordHash" FROM users WHERE ${where} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/** Which of these addresses have an account — one query, not one per order. */
export async function emailsWithAccounts(emails: readonly string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const lowered = emails.map((e) => e.toLowerCase());
  const rows = await sql<{ email: string }[]>`
    SELECT lower(email) AS email FROM users WHERE lower(email) = ANY(${lowered})
  `;
  return new Set(rows.map((r) => r.email));
}

export type NewUser = {
  email: string;
  passwordHash: string;
  company: string;
  contactName: string;
  phone: string;
  locale: string;
  /** 'referral' only with the rep whose link brought them; that rep earns commission. */
  origin: "self" | "referral";
  repId: string | null;
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
  let code = codeFromPhone(input.phone) ?? randomCustomerCode();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const rows = await sql<UserRow[]>`
        INSERT INTO users (email, password_hash, company, contact_name, phone, locale,
                           customer_code, origin, rep_id, origin_rep_id, rep_earns_commission)
        VALUES (${input.email}, ${input.passwordHash}, ${input.company},
                ${input.contactName}, ${input.phone}, ${input.locale}, ${code},
                ${input.origin}, ${input.repId}, ${input.repId}, ${input.repId !== null})
        RETURNING ${COLS}
      `;
      return rows[0];
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
    address: string;
    city: string;
  },
): Promise<void> {
  await sql`
    UPDATE users
    SET company = ${input.company}, contact_name = ${input.contactName},
        phone = ${input.phone}, default_po_number = ${input.defaultPoNumber},
        locale = ${input.locale}, address = ${input.address}, city = ${input.city}
    WHERE id = ${id}
  `;
}

/** The customer's rep, for "Your sales rep" — only while that rep is active. */
export async function getRepContactForUser(
  userId: string,
): Promise<{ name: string; phone: string } | null> {
  const [row] = await sql<{ name: string; phone: string }[]>`
    SELECT r.name, r.phone
    FROM users u JOIN sales_reps r ON r.id = u.rep_id AND r.active
    WHERE u.id = ${userId}
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
    UPDATE users SET password_hash = ${passwordHash}, must_change_password = ${mustChange}
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
