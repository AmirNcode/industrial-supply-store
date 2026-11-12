import "server-only";
import { sql } from "./index";
import { uniqueViolation } from "./pgErrors";
import { recordAudit } from "./audit";
import { codeFromPhone, randomCustomerCode } from "@/lib/customerCode";
import { latinDigits } from "@/lib/digits";
import { resolveShares } from "@/lib/commissionSplit";
import { leadRepSql, onMyList, repAccess, unassigned } from "./accountRepQueries";

export const REP_CUSTOMER_PAGE_SIZE = 50;
export const REP_SEARCH_MIN_CHARS = 3;
export const REP_SEARCH_TAKEN_MAX = 5;
const REP_SEARCH_UNASSIGNED_MAX = 20;

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
  originRepId: string | null;
  choseOwnPassword: boolean;
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

// `repId` is the lead rep and `repEarnsCommission` whether the account earns
// anyone commission, both derived from `customer_reps` and the account rate:
// the legacy `users.rep_id` / `rep_earns_commission` are written, never read.
const COLS = sql`u.id, u.customer_code AS "customerCode", u.company,
  u.contact_name AS "contactName", u.phone, u.email, u.address, u.city,
  u.default_po_number AS "defaultPoNumber", u.locale, ${leadRepSql()} AS "repId",
  (${leadRepSql()} IS NOT NULL AND u.commission_rate_bp IS DISTINCT FROM 0) AS "repEarnsCommission", u.origin,
  u.origin_rep_id AS "originRepId", u.chose_own_password AS "choseOwnPassword",
  u.next_follow_up_on::text AS "nextFollowUpOn", u.created_at AS "createdAt"`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The ID exactly; the company, contact or email by substring; or the phone's
 * digits by substring. Persian digits in the search box or in a stored phone
 * both count. `withEmail: false` is for a customer nobody holds yet: the
 * rep sees that row's contact name and phone, but an email match would let
 * them probe which addresses are registered.
 */
function matches(search: string, withEmail = true) {
  const text = latinDigits(search.trim());
  if (text === "") return sql`TRUE`;
  const like = `%${escapeLike(text)}%`;
  const digits = text.replace(/\D/g, "");
  const phone =
    digits.length >= 3
      ? sql`OR regexp_replace(translate(u.phone, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
                              '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`
      : sql`OR FALSE`;
  const email = withEmail ? sql`OR u.email ILIKE ${like}` : sql``;
  return sql`(u.customer_code = ${text} OR u.company ILIKE ${like}
              OR u.contact_name ILIKE ${like} ${email} ${phone})`;
}

/**
 * What a rep may match against a customer who is not theirs: the company by
 * substring, the customer ID exactly, and the phone only from a full number
 * (seven or more digits, as a caller would give it). Never the email or
 * contact name, and no short digit run: any match confirms that attribute of a
 * customer the rep has no right to, even though only the company is returned.
 */
const TAKEN_PHONE_MIN_DIGITS = 7;
function matchesTaken(search: string) {
  const text = latinDigits(search.trim());
  const like = `%${escapeLike(text)}%`;
  const digits = text.replace(/\D/g, "");
  const phone =
    digits.length >= TAKEN_PHONE_MIN_DIGITS
      ? sql`OR regexp_replace(translate(u.phone, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
                              '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`
      : sql`OR FALSE`;
  return sql`(u.customer_code = ${text} OR u.company ILIKE ${like} ${phone})`;
}

// ── Rep-scoped. Every statement carries "this customer is on my list"
// (`onMyList`, the `customer_reps` row) in its own WHERE, so a customer id
// posted for someone else's customer matches nothing — the ownership rule is
// in the query, not a check before it that a later edit could drop.

export async function listCustomersForRep(
  repId: string,
  search: string,
  page: number,
): Promise<{ rows: (CustomerRow & { lastOrderAt: string | null })[]; total: number }> {
  // `total` is every match, not just this page, so the page can say the list
  // is longer than what it shows (M-15). Counted on its own: a window count
  // would read 0 for a page past the end.
  const where = sql`${onMyList(repId)} AND ${matches(search)}`;
  const [rows, [count]] = await Promise.all([
    sql<(CustomerRow & { lastOrderAt: string | null })[]>`
      SELECT ${COLS},
             (SELECT max(o.created_at) FROM orders o WHERE o.user_id = u.id) AS "lastOrderAt"
      FROM users u
      WHERE ${where}
      ORDER BY u.company, u.customer_code
      LIMIT ${REP_CUSTOMER_PAGE_SIZE} OFFSET ${(Math.max(1, page) - 1) * REP_CUSTOMER_PAGE_SIZE}
    `,
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM users u WHERE ${where}`,
  ]);
  return { rows, total: count.total };
}

export async function getCustomerForRep(repId: string, customerId: string): Promise<CustomerRow | null> {
  const [row] = await sql<CustomerRow[]>`
    SELECT ${COLS} FROM users u WHERE u.id = ${customerId} AND ${onMyList(repId)}
  `;
  return row ?? null;
}

export type UnassignedCustomer = {
  id: string;
  customerCode: string;
  company: string;
  contactName: string;
  phone: string;
};
/** Shown to a rep with no right to the customer: the lead rep's name and nothing that identifies or reaches the customer. */
export type TakenCustomer = { customerCode: string; company: string; assignedTo: string };

/**
 * Other people's and nobody's customers matching the search, so a rep can tell
 * a new lead from one already taken. Both empty under three characters. The
 * customers on this rep's own list are excluded in the WHERE, and a taken
 * customer is selected as exactly code, company and the lead's name: no id,
 * phone, email or address ever leaves the query for a customer who is not
 * this rep's (the id would let a caller try the other id-keyed actions).
 */
export async function searchBeyondMine(
  repId: string,
  search: string,
): Promise<{ unassigned: UnassignedCustomer[]; taken: TakenCustomer[] }> {
  if (search.trim().length < REP_SEARCH_MIN_CHARS) return { unassigned: [], taken: [] };
  const [free, taken] = await Promise.all([
    sql<UnassignedCustomer[]>`
      SELECT u.id, u.customer_code AS "customerCode", COALESCE(u.company, '') AS company,
             COALESCE(u.contact_name, '') AS "contactName", COALESCE(u.phone, '') AS phone
      FROM users u
      WHERE ${unassigned()} AND ${matches(search, false)}
      ORDER BY u.company, u.customer_code
      LIMIT ${REP_SEARCH_UNASSIGNED_MAX}
    `,
    sql<TakenCustomer[]>`
      SELECT u.customer_code AS "customerCode", COALESCE(u.company, '') AS company,
             (SELECT r.name FROM sales_reps r WHERE r.id = ${leadRepSql()}) AS "assignedTo"
      FROM users u
      WHERE NOT ${unassigned()} AND NOT ${onMyList(repId)} AND ${matchesTaken(search)}
      ORDER BY u.company, u.customer_code
      LIMIT ${REP_SEARCH_TAKEN_MAX}
    `,
  ]);
  return { unassigned: free, taken };
}

export type OrderableCustomer =
  | { kind: "mine"; customer: CustomerRow }
  | { kind: "unassigned"; customer: UnassignedCustomer & { locale: string; email: string | null } }
  | { kind: "taken"; assignedTo: string };

/**
 * What a rep may do about one customer id: order for their own, order for an
 * unassigned one (the order wins the customer when it is paid), or nothing for
 * someone else's. The data for each case is fetched with its own rule in the
 * WHERE, so a customer who changed hands since `repAccess` is simply not found.
 */
export async function getOrderableCustomerForRep(
  repId: string,
  customerId: string,
): Promise<OrderableCustomer | null> {
  const access = await repAccess(repId, customerId);
  if (access === "missing") return null;
  if (access === "mine") {
    const customer = await getCustomerForRep(repId, customerId);
    return customer ? { kind: "mine", customer } : null;
  }
  if (access === "unassigned") {
    const [row] = await sql<(UnassignedCustomer & { locale: string; email: string | null })[]>`
      SELECT u.id, u.customer_code AS "customerCode", COALESCE(u.company, '') AS company,
             COALESCE(u.contact_name, '') AS "contactName", COALESCE(u.phone, '') AS phone,
             u.locale, u.email
      FROM users u WHERE u.id = ${customerId} AND ${unassigned()}
    `;
    return row ? { kind: "unassigned", customer: row } : null;
  }
  const [row] = await sql<{ assignedTo: string }[]>`
    SELECT r.name AS "assignedTo"
    FROM users u JOIN sales_reps r ON r.id = ${leadRepSql()}
    WHERE u.id = ${customerId} AND NOT ${onMyList(repId)}
  `;
  return row ? { kind: "taken", assignedTo: row.assignedTo } : null;
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
      // One transaction per attempt: the list row is what gives the rep the
      // customer, so a user row without it (or the reverse) must not exist.
      // The legacy columns are still written for the release running beside this one.
      return await sql.begin(async (tx) => {
        const [row] = await tx<{ id: string; customerCode: string }[]>`
          INSERT INTO users (email, password_hash, company, contact_name, phone, address, city,
                             locale, customer_code, rep_id, origin, origin_rep_id,
                             rep_earns_commission, must_change_password, chose_own_password)
          VALUES (${input.email}, ${input.passwordHash}, ${input.company}, ${input.contactName},
                  ${input.phone}, ${input.address}, ${input.city}, ${input.locale}, ${code},
                  ${repId}, 'rep', ${repId}, true, true, false)
          RETURNING id, customer_code AS "customerCode"
        `;
        await tx`INSERT INTO customer_reps (user_id, rep_id, share_bp) VALUES (${row.id}, ${repId}, NULL)`;
        return { kind: "created" as const, id: row.id, customerCode: row.customerCode };
      });
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
      UPDATE users u
      SET company = ${input.company}, contact_name = ${input.contactName}, phone = ${input.phone},
          email = ${input.email}, address = ${input.address}, city = ${input.city}
      WHERE u.id = ${customerId} AND ${onMyList(repId)}
    `;
    return result.count === 0 ? "not-found" : "ok";
  } catch (err) {
    if (uniqueViolation(err) === "users_email_lower_key") return "email-taken";
    throw err;
  }
}

/**
 * A new temporary password for a customer this rep created and who has never
 * chosen their own. Anyone else — a self sign-up, a referral, a customer
 * moved to this rep, or one who has set a password — goes through the admin:
 * a rep who could reset them could sign in as them and lock them out. The
 * rule is in the WHERE clause, so no caller can skip it; `repMayResetPassword`
 * is the same rule for deciding whether to show the button.
 */
export async function resetCustomerPasswordForRep(
  repId: string,
  customerId: string,
  passwordHash: string,
): Promise<CustomerRow | null> {
  return sql.begin(async (tx) => {
    const [row] = await tx<CustomerRow[]>`
      UPDATE users u
      SET password_hash = ${passwordHash}, must_change_password = true,
          session_version = u.session_version + 1
      WHERE u.id = ${customerId} AND ${onMyList(repId)}
        AND u.origin = 'rep' AND u.origin_rep_id = ${repId} AND NOT u.chose_own_password
      RETURNING ${COLS}
    `;
    if (!row) return null;
    await recordAudit(tx, {
      actor: { kind: "rep", id: repId },
      action: "customer.password-reset",
      subject: { kind: "customer", id: customerId },
    });
    return row;
  });
}

export async function setFollowUpForRep(
  repId: string,
  customerId: string,
  date: string | null,
): Promise<boolean> {
  const result = await sql`
    UPDATE users u SET next_follow_up_on = ${date}::date
    WHERE u.id = ${customerId} AND ${onMyList(repId)}
  `;
  return result.count === 1;
}

/** Due today or overdue, oldest first. `today` is Tehran's date (persianCalendar). */
export async function listFollowUpsDue(repId: string, today: string): Promise<CustomerRow[]> {
  return sql<CustomerRow[]>`
    SELECT ${COLS} FROM users u
    WHERE ${onMyList(repId)} AND u.next_follow_up_on <= ${today}::date
    ORDER BY u.next_follow_up_on, u.company
    LIMIT 50
  `;
}

export async function countCustomersForRep(repId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users u WHERE ${onMyList(repId)}`;
  return row.n;
}

// ── Admin. Callers have already passed assertAdminWrite() or the panel gate.

export type AdminCustomerRow = CustomerRow & {
  /** In the order they were added; the share is the effective one (blank shares already split equally). */
  reps: { repId: string; name: string; shareBp: number; active: boolean }[];
  accountRateBp: number | null;
  originRepName: string | null;
  orderCount: number;
};

export type RepFilter = "all" | "none" | "inactive" | { repId: string };

type AdminQueryRow = CustomerRow & {
  storedReps: { repId: string; name: string; active: boolean; shareBp: number | null }[];
  accountRateBp: number | null;
  originRepName: string | null;
  orderCount: number;
};

const ADMIN_COLS = sql`${COLS}, u.commission_rate_bp AS "accountRateBp",
  origin_rep.name AS "originRepName",
  (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id) AS "orderCount",
  COALESCE((SELECT json_agg(json_build_object('repId', cr.rep_id, 'name', r.name, 'active', r.active,
                                              'shareBp', cr.share_bp) ORDER BY cr.added_at, cr.rep_id)
            FROM customer_reps cr JOIN sales_reps r ON r.id = cr.rep_id
            WHERE cr.user_id = u.id), '[]'::json) AS "storedReps"`;
const ADMIN_FROM = sql`users u LEFT JOIN sales_reps origin_rep ON origin_rep.id = u.origin_rep_id`;

function toAdminRow({ storedReps, ...row }: AdminQueryRow): AdminCustomerRow {
  const shares = new Map(
    resolveShares(storedReps.map((rep) => ({ repId: rep.repId, shareBp: rep.shareBp }))).map((share) => [
      share.repId,
      share.shareBp,
    ]),
  );
  return {
    ...row,
    reps: storedReps.map((rep) => ({ repId: rep.repId, name: rep.name, shareBp: shares.get(rep.repId) ?? 0, active: rep.active })),
  };
}

function repFilter(filter: RepFilter) {
  if (filter === "all") return sql`TRUE`;
  if (filter === "none") return unassigned();
  if (filter === "inactive") {
    return sql`EXISTS (SELECT 1 FROM customer_reps cr JOIN sales_reps r ON r.id = cr.rep_id AND NOT r.active
                       WHERE cr.user_id = u.id)`;
  }
  return onMyList(filter.repId);
}

export async function listCustomersAdmin(options: {
  search: string;
  rep: RepFilter;
  page: number;
  pageSize: number;
}): Promise<{ rows: AdminCustomerRow[]; total: number }> {
  const where = sql`${matches(options.search)} AND ${repFilter(options.rep)}`;
  const [rows, [count]] = await Promise.all([
    sql<AdminQueryRow[]>`
      SELECT ${ADMIN_COLS} FROM ${ADMIN_FROM} WHERE ${where}
      ORDER BY u.created_at DESC, u.id
      LIMIT ${options.pageSize} OFFSET ${(options.page - 1) * options.pageSize}
    `,
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM users u WHERE ${where}`,
  ]);
  return { rows: rows.map(toAdminRow), total: count.total };
}

export async function getCustomerAdmin(customerId: string): Promise<AdminCustomerRow | null> {
  const [row] = await sql<AdminQueryRow[]>`
    SELECT ${ADMIN_COLS} FROM ${ADMIN_FROM} WHERE u.id = ${customerId}
  `;
  return row ? toAdminRow(row) : null;
}

export async function resetCustomerPasswordAdmin(
  customerId: string,
  passwordHash: string,
): Promise<CustomerRow | null> {
  return sql.begin(async (tx) => {
    const [row] = await tx<CustomerRow[]>`
      UPDATE users u
      SET password_hash = ${passwordHash}, must_change_password = true,
          session_version = u.session_version + 1
      WHERE u.id = ${customerId}
      RETURNING ${COLS}
    `;
    if (!row) return null;
    await recordAudit(tx, {
      actor: { kind: "admin" },
      action: "customer.password-reset",
      subject: { kind: "customer", id: customerId },
    });
    return row;
  });
}

export async function setFollowUpAdmin(customerId: string, date: string | null): Promise<boolean> {
  const result = await sql`
    UPDATE users SET next_follow_up_on = ${date}::date WHERE id = ${customerId}
  `;
  return result.count === 1;
}
