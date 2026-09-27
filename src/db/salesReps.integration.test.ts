import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import { randomReferralCode } from "@/lib/repAccount";
import { randomCustomerCode } from "@/lib/customerCode";

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
