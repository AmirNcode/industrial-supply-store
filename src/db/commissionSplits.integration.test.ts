import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    throw new Error(`Refusing to run commission split integration tests against non-local host: ${hostname}`);
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

async function insertRep(tx: Tx, options: { rateBp?: number } = {}): Promise<string> {
  const [rep] = await tx<{ id: string }[]>`
    INSERT INTO sales_reps (username, password_hash, name, commission_rate_bp, referral_code)
    VALUES (${`rep-${randomUUID().slice(0, 8)}`}, 'x', 'Split Rep', ${options.rateBp ?? 250}, ${randomReferralCode()})
    RETURNING id
  `;
  return rep.id;
}

/** A customer shaped the way the pre-split release wrote it: owner in `users.rep_id`. */
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

/** A delivered order credited the pre-split way: `orders.rep_id` and a locked rate. */
async function insertDeliveredOrder(
  tx: Tx,
  fields: { userId: string; repId: string; rateBp: number },
): Promise<number> {
  const [order] = await tx<{ id: number }[]>`
    INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                        status, user_id, rep_id, commission_rate_bp, invoice_number, fx_rate_to_rial,
                        created_at, invoiced_at, paid_at, shipped_at, delivered_at)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Split Co', 'N', '', 10000, 10000,
            'delivered', ${fields.userId}, ${fields.repId}, ${fields.rateBp},
            ${`INV-TEST-${randomUUID().slice(0, 8)}`}, 1050000,
            now() - interval '9 days', now() - interval '8 days', now() - interval '6 days',
            now() - interval '4 days', now() - interval '2 days')
    RETURNING id
  `;
  return order.id;
}

/** The migration's backfill section, re-run so legacy-shaped rows can be checked. */
async function runBackfill(tx: Tx): Promise<void> {
  const file = readFileSync(
    join(process.cwd(), "supabase/migrations/20261112120000_add_commission_splits.sql"),
    "utf8",
  );
  const section = file.split("-- backfill:begin")[1]?.split("-- backfill:end")[0];
  if (!section) throw new Error("backfill markers missing from the migration");
  await tx.unsafe(section);
}

test("migration backfill keeps every rep's money", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const repId = await insertRep(tx, { rateBp: 500 });
    const earner = await insertCustomer(tx, { repId, earns: true });
    const nonEarner = await insertCustomer(tx, { repId, earns: false });
    const earnerOrder = await insertDeliveredOrder(tx, { userId: earner, repId, rateBp: 500 });
    const nonEarnerOrder = await insertDeliveredOrder(tx, { userId: nonEarner, repId, rateBp: 0 });

    await runBackfill(tx);
    await runBackfill(tx); // idempotent

    const links = await tx<{ userId: string; shareBp: number | null }[]>`
      SELECT user_id AS "userId", share_bp AS "shareBp" FROM customer_reps
      WHERE rep_id = ${repId} ORDER BY user_id`;
    assert.equal(links.length, 2);
    assert.deepEqual(links.map((l) => l.shareBp), [null, null]);
    assert.deepEqual(links.map((l) => l.userId).sort(), [earner, nonEarner].sort());

    const rates = await tx<{ id: string; rate: number | null }[]>`
      SELECT id, commission_rate_bp AS rate FROM users WHERE id IN (${earner}, ${nonEarner})`;
    assert.equal(rates.find((r) => r.id === earner)?.rate, null);
    assert.equal(rates.find((r) => r.id === nonEarner)?.rate, 0);

    const shares = await tx<{ orderId: number; repId: string; shareBp: number }[]>`
      SELECT order_id AS "orderId", rep_id AS "repId", share_bp AS "shareBp"
      FROM order_rep_shares WHERE order_id IN (${earnerOrder}, ${nonEarnerOrder}) ORDER BY order_id`;
    assert.equal(shares.length, 2);
    for (const s of shares) {
      assert.equal(s.repId, repId);
      assert.equal(s.shareBp, 10000);
    }
  });
});

test("backfill sets placed_by_rep_id only for orders a rep placed", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const repId = await insertRep(tx);
    const userId = await insertCustomer(tx, { repId });
    const [placed] = await tx<{ id: number }[]>`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                          user_id, rep_id, commission_rate_bp, placed_by_rep)
      VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'P', 'N', '', 100, 100,
              ${userId}, ${repId}, 250, true)
      RETURNING id`;
    const [own] = await tx<{ id: number }[]>`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                          user_id, rep_id, commission_rate_bp)
      VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'O', 'N', '', 100, 100,
              ${userId}, ${repId}, 250)
      RETURNING id`;
    await runBackfill(tx);
    const rows = await tx<{ id: number; by: string | null }[]>`
      SELECT id, placed_by_rep_id AS by FROM orders WHERE id IN (${placed.id}, ${own.id})`;
    assert.equal(rows.find((r) => r.id === placed.id)?.by, repId);
    assert.equal(rows.find((r) => r.id === own.id)?.by, null);
  });
});

test("split constraints refuse bad shares and accept unclaimed orders", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const repId = await insertRep(tx);
    const userId = await insertCustomer(tx, { repId });
    const refused = (query: (sp: Tx) => Promise<unknown>) =>
      assert.rejects(tx.savepoint((sp) => query(sp)), { code: "23514" });

    await refused((sp) => sp`INSERT INTO customer_reps (user_id, rep_id, share_bp) VALUES (${userId}, ${repId}, 0)`);
    await refused((sp) => sp`INSERT INTO customer_reps (user_id, rep_id, share_bp) VALUES (${userId}, ${repId}, 10001)`);
    await refused((sp) => sp`UPDATE users SET commission_rate_bp = 10001 WHERE id = ${userId}`);

    // Placed by a rep with only the new column set: valid.
    await tx`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                          placed_by_rep, placed_by_rep_id)
      VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'N', 'N', '', 100, 100, true, ${repId})`;
    // Placed by a rep, but nobody named: refused.
    await refused((sp) => sp`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents, placed_by_rep)
      VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'N', 'N', '', 100, 100, true)`);
    // A credited order still needs its rate.
    await refused((sp) => sp`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents, rep_id)
      VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'N', 'N', '', 100, 100, ${repId})`);

    const [order] = await tx<{ id: number }[]>`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents)
      VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'N', 'N', '', 100, 100) RETURNING id`;
    await refused((sp) => sp`INSERT INTO order_rep_shares (order_id, rep_id, share_bp) VALUES (${order.id}, ${repId}, 0)`);
  });
});
