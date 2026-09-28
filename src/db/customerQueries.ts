import "server-only";
import { sql } from "./index";
import { codeFromPhone, randomCustomerCode } from "@/lib/customerCode";
import { latinDigits } from "@/lib/digits";

export type CustomerOrigin = "self" | "rep" | "referral";

export type CustomerRow = {
  id: string;
  customerCode: string;
  company: string;
  contactName: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
  defaultPoNumber: string;
  locale: string;
  repId: string | null;
  repEarnsCommission: boolean;
  origin: CustomerOrigin;
  nextFollowUpOn: string | null;
  createdAt: string;
};

export type CustomerInput = {
  company: string;
  contactName: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
};

export type CreateCustomerResult =
  | { kind: "created"; id: string; customerCode: string }
  | { kind: "code-taken" }
  | { kind: "email-taken" }
  | { kind: "no-phone-code" };

const COLS = sql`u.id, u.customer_code AS "customerCode", u.company,
  u.contact_name AS "contactName", u.phone, u.email, u.address, u.city,
  u.default_po_number AS "defaultPoNumber", u.locale, u.rep_id AS "repId",
  u.rep_earns_commission AS "repEarnsCommission", u.origin,
  u.next_follow_up_on::text AS "nextFollowUpOn", u.created_at AS "createdAt"`;

function uniqueViolation(err: unknown): string | null {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === "23505" ? (e.constraint_name ?? "") : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The ID exactly; the company, contact or email by substring; or the phone's
 * digits by substring. Persian digits in the search box or in a stored phone
 * both count.
 */
function matches(search: string) {
  const text = latinDigits(search.trim());
  if (text === "") return sql`TRUE`;
  const like = `%${escapeLike(text)}%`;
  const digits = text.replace(/\D/g, "");
  const phone =
    digits.length >= 3
      ? sql`OR regexp_replace(translate(u.phone, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
                              '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`
      : sql`OR FALSE`;
  return sql`(u.customer_code = ${text} OR u.company ILIKE ${like}
              OR u.contact_name ILIKE ${like} OR u.email ILIKE ${like} ${phone})`;
}

// ── Rep-scoped. Every statement carries `rep_id = $rep` in its own WHERE, so
// a customer id posted for someone else's customer matches nothing — the
// ownership rule is in the query, not a check before it that a later edit
// could drop.

export async function listCustomersForRep(
  repId: string,
  search: string,
): Promise<(CustomerRow & { lastOrderAt: string | null })[]> {
  return sql<(CustomerRow & { lastOrderAt: string | null })[]>`
    SELECT ${COLS},
           (SELECT max(o.created_at) FROM orders o WHERE o.user_id = u.id) AS "lastOrderAt"
    FROM users u
    WHERE u.rep_id = ${repId} AND ${matches(search)}
    ORDER BY u.company, u.customer_code
    LIMIT 500
  `;
}

export async function getCustomerForRep(repId: string, customerId: string): Promise<CustomerRow | null> {
  const [row] = await sql<CustomerRow[]>`
    SELECT ${COLS} FROM users u WHERE u.id = ${customerId} AND u.rep_id = ${repId}
  `;
  return row ?? null;
}

/**
 * A rep-created customer starts with commission on and a temporary password
 * they must replace. The unique indexes decide clashes. A clash on the
 * phone-derived ID is reported rather than quietly replaced with a random one:
 * those digits usually mean this customer already has an account, and saying
 * so is the only thing that stops a duplicate.
 */
export async function createCustomerForRep(
  repId: string,
  input: CustomerInput & { codeChoice: "phone" | "random"; passwordHash: string; locale: string },
): Promise<CreateCustomerResult> {
  const fromPhone = input.codeChoice === "phone" ? codeFromPhone(input.phone) : null;
  if (input.codeChoice === "phone" && fromPhone === null) return { kind: "no-phone-code" };
  let code = fromPhone ?? randomCustomerCode();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const [row] = await sql<{ id: string; customerCode: string }[]>`
        INSERT INTO users (email, password_hash, company, contact_name, phone, address, city,
                           locale, customer_code, rep_id, origin, origin_rep_id,
                           rep_earns_commission, must_change_password)
        VALUES (${input.email}, ${input.passwordHash}, ${input.company}, ${input.contactName},
                ${input.phone}, ${input.address}, ${input.city}, ${input.locale}, ${code},
                ${repId}, 'rep', ${repId}, true, true)
        RETURNING id, customer_code AS "customerCode"
      `;
      return { kind: "created", id: row.id, customerCode: row.customerCode };
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint === null) throw err;
      if (constraint === "users_email_lower_key") return { kind: "email-taken" };
      if (fromPhone !== null && code === fromPhone) return { kind: "code-taken" };
      code = randomCustomerCode();
    }
  }
  throw new Error("Could not allocate a unique customer ID");
}

export async function updateCustomerForRep(
  repId: string,
  customerId: string,
  input: CustomerInput,
): Promise<"ok" | "not-found" | "email-taken"> {
  try {
    const result = await sql`
      UPDATE users
      SET company = ${input.company}, contact_name = ${input.contactName}, phone = ${input.phone},
          email = ${input.email}, address = ${input.address}, city = ${input.city}
      WHERE id = ${customerId} AND rep_id = ${repId}
    `;
    return result.count === 0 ? "not-found" : "ok";
  } catch (err) {
    if (uniqueViolation(err) === "users_email_lower_key") return "email-taken";
    throw err;
  }
}

export async function resetCustomerPasswordForRep(
  repId: string,
  customerId: string,
  passwordHash: string,
): Promise<CustomerRow | null> {
  const [row] = await sql<CustomerRow[]>`
    UPDATE users u SET password_hash = ${passwordHash}, must_change_password = true
    WHERE u.id = ${customerId} AND u.rep_id = ${repId}
    RETURNING ${COLS}
  `;
  return row ?? null;
}

export async function setFollowUpForRep(
  repId: string,
  customerId: string,
  date: string | null,
): Promise<boolean> {
  const result = await sql`
    UPDATE users SET next_follow_up_on = ${date}::date
    WHERE id = ${customerId} AND rep_id = ${repId}
  `;
  return result.count === 1;
}

/** Due today or overdue, oldest first. `today` is Tehran's date (persianCalendar). */
export async function listFollowUpsDue(repId: string, today: string): Promise<CustomerRow[]> {
  return sql<CustomerRow[]>`
    SELECT ${COLS} FROM users u
    WHERE u.rep_id = ${repId} AND u.next_follow_up_on <= ${today}::date
    ORDER BY u.next_follow_up_on, u.company
    LIMIT 50
  `;
}

export async function countCustomersForRep(repId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE rep_id = ${repId}`;
  return row.n;
}

// ── Admin. Callers have already passed assertAdminWrite() or the panel gate.

export type AdminCustomerRow = CustomerRow & {
  repName: string | null;
  originRepName: string | null;
  orderCount: number;
};

export type RepFilter = "all" | "none" | { repId: string };

const ADMIN_COLS = sql`${COLS}, r.name AS "repName", origin_rep.name AS "originRepName",
  (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id) AS "orderCount"`;
const ADMIN_FROM = sql`users u
  LEFT JOIN sales_reps r ON r.id = u.rep_id
  LEFT JOIN sales_reps origin_rep ON origin_rep.id = u.origin_rep_id`;

function repFilter(filter: RepFilter) {
  if (filter === "all") return sql`TRUE`;
  if (filter === "none") return sql`u.rep_id IS NULL`;
  return sql`u.rep_id = ${filter.repId}`;
}

export async function listCustomersAdmin(options: {
  search: string;
  rep: RepFilter;
  page: number;
  pageSize: number;
}): Promise<{ rows: AdminCustomerRow[]; total: number }> {
  const where = sql`${matches(options.search)} AND ${repFilter(options.rep)}`;
  const [rows, [count]] = await Promise.all([
    sql<AdminCustomerRow[]>`
      SELECT ${ADMIN_COLS} FROM ${ADMIN_FROM} WHERE ${where}
      ORDER BY u.created_at DESC, u.id
      LIMIT ${options.pageSize} OFFSET ${(options.page - 1) * options.pageSize}
    `,
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM users u WHERE ${where}`,
  ]);
  return { rows, total: count.total };
}

export async function getCustomerAdmin(customerId: string): Promise<AdminCustomerRow | null> {
  const [row] = await sql<AdminCustomerRow[]>`
    SELECT ${ADMIN_COLS} FROM ${ADMIN_FROM} WHERE u.id = ${customerId}
  `;
  return row ?? null;
}

/**
 * Who the customer's rep is, and whether that rep earns commission on them.
 * Both apply to orders placed from now on: each order locks its own copy when
 * it is placed (orderSubmissionQueries.ts), so nothing here reaches back.
 */
export async function assignCustomer(
  customerId: string,
  repId: string | null,
  earnsCommission: boolean,
): Promise<"ok" | "not-found" | "bad-rep"> {
  if (repId !== null) {
    const [rep] = await sql`SELECT 1 FROM sales_reps WHERE id = ${repId} AND active`;
    if (!rep) return "bad-rep";
  }
  const result = await sql`
    UPDATE users SET rep_id = ${repId}, rep_earns_commission = ${earnsCommission}
    WHERE id = ${customerId}
  `;
  return result.count === 0 ? "not-found" : "ok";
}

export async function resetCustomerPasswordAdmin(
  customerId: string,
  passwordHash: string,
): Promise<CustomerRow | null> {
  const [row] = await sql<CustomerRow[]>`
    UPDATE users u SET password_hash = ${passwordHash}, must_change_password = true
    WHERE u.id = ${customerId}
    RETURNING ${COLS}
  `;
  return row ?? null;
}

export async function setFollowUpAdmin(customerId: string, date: string | null): Promise<boolean> {
  const result = await sql`
    UPDATE users SET next_follow_up_on = ${date}::date WHERE id = ${customerId}
  `;
  return result.count === 1;
}
