import "server-only";
import { sql } from "./index";

export type UserRow = {
  id: string;
  email: string;
  company: string;
  contactName: string;
  phone: string;
  defaultPoNumber: string;
  locale: string;
};

const COLS = sql`id, email, company, contact_name AS "contactName", phone,
                 default_po_number AS "defaultPoNumber", locale`;

export async function getUserById(id: string): Promise<UserRow | null> {
  // Compared as text, not cast to uuid: this value comes from a cookie, and a
  // malformed uuid makes Postgres raise rather than return no rows.
  const rows = await sql<UserRow[]>`
    SELECT ${COLS} FROM users WHERE id::text = ${id} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findUserByEmail(
  email: string,
): Promise<(UserRow & { passwordHash: string }) | null> {
  const rows = await sql<(UserRow & { passwordHash: string })[]>`
    SELECT ${COLS}, password_hash AS "passwordHash"
    FROM users WHERE lower(email) = lower(${email}) LIMIT 1
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
};

/**
 * Returns "email-taken" rather than throwing, because a duplicate address is
 * an ordinary thing for a person to do, not an exceptional condition.
 *
 * The unique index is what actually decides. Checking first and inserting
 * second is a race, and sign-up is exactly where two simultaneous attempts
 * collide.
 */
export async function createUser(input: NewUser): Promise<UserRow | "email-taken"> {
  try {
    const rows = await sql<UserRow[]>`
      INSERT INTO users (email, password_hash, company, contact_name, phone, locale)
      VALUES (${input.email}, ${input.passwordHash}, ${input.company},
              ${input.contactName}, ${input.phone}, ${input.locale})
      RETURNING ${COLS}
    `;
    return rows[0];
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") return "email-taken";
    throw err;
  }
}

export async function updateProfile(
  id: string,
  input: {
    company: string;
    contactName: string;
    phone: string;
    defaultPoNumber: string;
    locale: string;
  },
): Promise<void> {
  await sql`
    UPDATE users
    SET company = ${input.company}, contact_name = ${input.contactName},
        phone = ${input.phone}, default_po_number = ${input.defaultPoNumber},
        locale = ${input.locale}
    WHERE id::text = ${id}
  `;
}

export async function setPassword(userId: string, passwordHash: string): Promise<void> {
  await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id::text = ${userId}`;
}

export async function touchLastLogin(userId: string): Promise<void> {
  await sql`UPDATE users SET last_login_at = now() WHERE id::text = ${userId}`;
}
