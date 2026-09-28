import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import { randomReferralCode } from "@/lib/repAccount";
import { randomCustomerCode } from "@/lib/customerCode";
import {
  createRep,
  deactivateRep,
  findRepForSignIn,
  getActiveRepByReferralCode,
  getRepById,
  setRepPassword,
} from "./repQueries";
import { createUser, findUserForSignIn, setPassword, getUserById } from "./userQueries";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

class Rollback extends Error {}

function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for the database integration test");
  const { hostname } = new URL(raw);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`Refusing to run sales rep integration tests against non-local host: ${hostname}`);
  }
}

/** Runs `body` in a transaction that is always rolled back, whatever it does. */
async function rolledBack(body: (tx: Tx) => Promise<void>): Promise<void> {
  await assert.rejects(
    sql.begin(async (tx) => {
      await body(tx);
      throw new Rollback();
    }),
    Rollback,
  );
}

async function insertRep(
  tx: Tx,
  options: { rateBp?: number; active?: boolean } = {},
): Promise<string> {
  const [rep] = await tx<{ id: string }[]>`
    INSERT INTO sales_reps (username, password_hash, name, commission_rate_bp, referral_code, active)
    VALUES (${`rep-${randomUUID().slice(0, 8)}`}, 'x', 'Integration Rep',
            ${options.rateBp ?? 250}, ${randomReferralCode()}, ${options.active ?? true})
    RETURNING id
  `;
  return rep.id;
}

async function insertCustomer(
  tx: Tx,
  options: { repId?: string | null; earns?: boolean } = {},
): Promise<string> {
  const repId = options.repId ?? null;
  const [user] = await tx<{ id: string }[]>`
    INSERT INTO users (email, password_hash, customer_code, rep_id, rep_earns_commission,
                       origin, origin_rep_id, phone)
    VALUES (${`${randomUUID()}@example.invalid`}, 'x', ${randomCustomerCode()}, ${repId},
            ${options.earns ?? false}, ${repId ? "rep" : "self"}, ${repId}, '0912 000 0000')
    RETURNING id
  `;
  return user.id;
}

async function insertOrder(
  tx: Tx,
  fields: { userId?: string | null; repId?: string | null; rateBp?: number | null } = {},
): Promise<{ id: number; payToken: string }> {
  const [order] = await tx<{ id: number; payToken: string }[]>`
    INSERT INTO orders (ref, company, contact_name, email, locale, currency, total_cents,
                        requested_total_cents, status, user_id, rep_id, commission_rate_bp)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Integration Co', 'Tester',
            't@example.invalid', 'en', 'USD', 100, 100, 'received',
            ${fields.userId ?? null}, ${fields.repId ?? null}, ${fields.rateBp ?? null})
    RETURNING id, pay_token AS "payToken"
  `;
  return order;
}

test("constraints refuse rows the application must never write", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const repId = await insertRep(tx);
    const refused = (code: string, query: (sp: Tx) => Promise<unknown>) =>
      assert.rejects(tx.savepoint((sp) => query(sp)), { code });

    await refused("23514", (sp) => sp`
      INSERT INTO sales_reps (username, password_hash, name, referral_code)
      VALUES ('Sara', 'x', 'S', ${randomReferralCode()})`);
    await refused("23514", (sp) => sp`UPDATE sales_reps SET commission_rate_bp = 10001 WHERE id = ${repId}`);
    await refused("23514", (sp) => sp`UPDATE sales_reps SET referral_code = 'ABCDEO' WHERE id = ${repId}`);
    await refused("23514", (sp) => sp`
      INSERT INTO users (email, password_hash, customer_code) VALUES ('a@example.invalid', 'x', '12345')`);
    await refused("23514", (sp) => sp`
      INSERT INTO users (email, password_hash, customer_code, origin)
      VALUES ('b@example.invalid', 'x', ${randomCustomerCode()}, 'rep')`);
    await refused("23514", (sp) => sp`
      INSERT INTO orders (ref, company, contact_name, email, rep_id, commission_rate_bp)
      VALUES ('ORD-ZZZZZ1', 'C', 'N', 'e@example.invalid', ${repId}, NULL)`);
    await refused("23514", (sp) => sp`
      INSERT INTO orders (ref, company, contact_name, email, placed_by_rep)
      VALUES ('ORD-ZZZZZ2', 'C', 'N', 'e@example.invalid', true)`);
    await refused("23514", (sp) => sp`
      INSERT INTO rep_payouts (rep_id, amount_rial) VALUES (${repId}, 0)`);
    await refused("23514", (sp) => sp`
      INSERT INTO rep_targets (rep_id, persian_year, persian_month, amount_rial)
      VALUES (${repId}, 1405, 13, 1)`);

    const customer = await insertCustomer(tx, { repId });
    const [{ code }] = await tx<{ code: string }[]>`SELECT customer_code AS code FROM users WHERE id = ${customer}`;
    await refused("23505", (sp) => sp`
      INSERT INTO users (email, password_hash, customer_code) VALUES ('c@example.invalid', 'x', ${code})`);
    // Reps are never deleted; RESTRICT makes that a database fact.
    await refused("23503", (sp) => sp`DELETE FROM sales_reps WHERE id = ${repId}`);
  });
});

test("every order gets its own pay token without the insert naming one", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const a = await insertOrder(tx);
    const b = await insertOrder(tx);
    assert.match(a.payToken, /^[0-9a-f]{64}$/);
    assert.match(b.payToken, /^[0-9a-f]{64}$/);
    assert.notEqual(a.payToken, b.payToken);
  });
});

async function cleanupReps(repIds: string[], userIds: string[] = []): Promise<void> {
  if (userIds.length) await sql`DELETE FROM users WHERE id = ANY(${userIds})`;
  if (repIds.length) await sql`DELETE FROM sales_reps WHERE id = ANY(${repIds})`;
}

test("rep accounts: unique usernames, a password change ends sessions, deactivation moves customers", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  try {
    const a = await createRep({ username: `a-${suffix}`, name: "A", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    const b = await createRep({ username: `b-${suffix}`, name: "B", phone: "", email: "", commissionRateBp: 300, passwordHash: "x" });
    if (a === "username-taken" || b === "username-taken") throw new Error("username clash");
    repIds.push(a.id, b.id);

    assert.equal(
      await createRep({ username: `a-${suffix}`, name: "Dup", phone: "", email: "", commissionRateBp: 0, passwordHash: "x" }),
      "username-taken",
    );
    assert.equal((await findRepForSignIn(`a-${suffix}`))?.passwordHash, "x");
    assert.equal(a.mustChangePassword, true);

    const version = await setRepPassword(a.id, "y", false);
    assert.equal(version, a.sessionVersion + 1);
    assert.equal((await getRepById(a.id))?.mustChangePassword, false);

    const [c] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, customer_code, rep_id, origin, origin_rep_id)
      VALUES (${`${suffix}@example.invalid`}, 'x', ${randomCustomerCode()}, ${a.id}, 'rep', ${a.id})
      RETURNING id`;
    userIds.push(c.id);

    assert.equal(await deactivateRep(a.id, a.id), "bad-destination");
    assert.equal(await deactivateRep(a.id, b.id), "ok");
    const [moved] = await sql<{ repId: string }[]>`SELECT rep_id AS "repId" FROM users WHERE id = ${c.id}`;
    assert.equal(moved.repId, b.id);
    const after = await getRepById(a.id);
    assert.equal(after?.active, false);
    assert.equal(after?.sessionVersion, (version ?? 0) + 1);
    assert.equal(await deactivateRep(b.id, a.id), "bad-destination");

    // A referral link opened before deactivation must not credit a locked-out rep.
    assert.equal(await getActiveRepByReferralCode(a.referralCode), null);
    assert.deepEqual(await getActiveRepByReferralCode(b.referralCode), { id: b.id });
  } finally {
    await cleanupReps(repIds, userIds);
  }
});

test("self sign-up gets the phone's digits as its ID, or a random one when taken", async () => {
  assertLocalDatabase();
  const digits = randomUUID().replace(/\D/g, "").slice(0, 7).padEnd(7, "3");
  const phone = `0912${digits}`;
  const ids: string[] = [];
  try {
    const base = {
      passwordHash: "x", company: "C", contactName: "N", phone, locale: "fa",
      origin: "self" as const, repId: null,
    };
    const first = await createUser({ ...base, email: `${randomUUID()}@example.invalid` });
    const second = await createUser({ ...base, email: `${randomUUID()}@example.invalid` });
    if (first === "email-taken" || second === "email-taken") throw new Error("unexpected clash");
    ids.push(first.id, second.id);

    assert.match(first.customerCode, /^[0-9]{7}$/);
    assert.match(second.customerCode, /^[0-9]{7}$/);
    assert.notEqual(first.customerCode, second.customerCode);

    const byCode = await findUserForSignIn({ kind: "code", code: second.customerCode });
    assert.equal(byCode?.id, second.id);
    // Upper-case on purpose: the lookup compares lower(email) on both sides.
    const byEmail = await findUserForSignIn({ kind: "email", email: first.email!.toUpperCase() });
    assert.equal(byEmail?.id, first.id);
    assert.equal(await createUser({ ...base, email: first.email! }), "email-taken");
  } finally {
    if (ids.length) await sql`DELETE FROM users WHERE id = ANY(${ids})`;
  }
});

test("a reset password must be replaced; the replacement clears the flag", async () => {
  assertLocalDatabase();
  const created = await createUser({
    email: `${randomUUID()}@example.invalid`,
    passwordHash: "x",
    company: "C",
    contactName: "N",
    phone: "12",
    locale: "en",
    origin: "self",
    repId: null,
  });
  if (created === "email-taken") throw new Error("unexpected");
  try {
    await setPassword(created.id, "reset-hash", true);
    assert.equal((await getUserById(created.id))?.mustChangePassword, true);
    await setPassword(created.id, "own-hash", false);
    assert.equal((await getUserById(created.id))?.mustChangePassword, false);
  } finally {
    await sql`DELETE FROM users WHERE id = ${created.id}`;
  }
});
