import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import { randomReferralCode } from "@/lib/repAccount";
import { randomCustomerCode } from "@/lib/customerCode";
import {
  listAccountReps,
  listAccountsWithInactiveRep,
  repAccess,
  setAccountReps,
  splitForOrder,
} from "./accountRepQueries";
import {
  assignCustomer,
  createCustomerForRep,
  getCustomerForRep,
  getOrderableCustomerForRep,
  listCustomersForRep,
  listFollowUpsDue,
  countCustomersForRep,
  searchBeyondMine,
  setFollowUpForRep,
  updateCustomerForRep,
} from "./customerQueries";
import { addNoteForRep } from "./noteQueries";
import { listOrdersForRep, getOrderForRep, repCanActOnOrder } from "./repOrderQueries";
import { createUser, getRepContactForUser } from "./userQueries";
import { deactivateRep, listReps } from "./repQueries";
import { confirmPayment, addPaymentProof } from "./paymentProofQueries";
import { sweepExpiredOrders } from "./expiryQueries";
import { submitOrderFromCartInTransaction } from "./orderSubmissionQueries";
import { quoteCartFingerprint } from "@/lib/quoteSubmission";
import { splitCart } from "@/lib/checkoutSplit";
import { listDeliveredForRep, listInProgressForRep, listRecentDeliveries, listRepTotals } from "./repMoney";

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

// ── Account rep list. setAccountReps opens its own transaction, so these
// tests commit real rows and remove them afterwards, audit rows included (the
// log is append-only for the app, not for a local test database).

async function withCommitted(body: (made: { rep: () => Promise<string>; customer: () => Promise<string> }) => Promise<void>) {
  const reps: string[] = [];
  const users: string[] = [];
  try {
    await body({
      rep: async () => {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO sales_reps (username, password_hash, name, commission_rate_bp, referral_code)
          VALUES (${`rep-${randomUUID().slice(0, 8)}`}, 'x', ${`Rep ${reps.length + 1}`}, 250, ${randomReferralCode()})
          RETURNING id`;
        reps.push(row.id);
        return row.id;
      },
      customer: async () => {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO users (email, password_hash, customer_code, origin, phone, company)
          VALUES (${`${randomUUID()}@example.invalid`}, 'x', ${randomCustomerCode()}, 'self', '0912 000 0000', 'Split Co')
          RETURNING id`;
        users.push(row.id);
        return row.id;
      },
    });
  } finally {
    if (users.length) await sql`DELETE FROM audit_log WHERE subject_kind = 'customer' AND subject_id = ANY(${users}::text[])`;
    if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users}::uuid[])`;
    if (reps.length) await sql`DELETE FROM sales_reps WHERE id = ANY(${reps}::uuid[])`;
  }
}

const stored = (id: string) => sql<{ repId: string; shareBp: number | null }[]>`
  SELECT rep_id AS "repId", share_bp AS "shareBp" FROM customer_reps WHERE user_id = ${id} ORDER BY added_at, rep_id`;

test("setAccountReps saves 75/15/10 and reads it back", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b, c] = [await made.rep(), await made.rep(), await made.rep()];
    const id = await made.customer();
    const result = await setAccountReps(id, [
      { repId: a, shareBp: 7500 }, { repId: b, shareBp: 1500 }, { repId: c, shareBp: 1000 },
    ], null);
    assert.equal(result, "ok");
    const list = await listAccountReps(id);
    assert.deepEqual(list.map((r) => r.repId), [a, b, c]);
    assert.deepEqual(list.map((r) => r.shareBp), [7500, 1500, 1000]);
    assert.deepEqual(list.map((r) => r.effectiveShareBp), [7500, 1500, 1000]);
    assert.deepEqual(list.map((r) => r.isLead), [true, false, false]);
    const [user] = await sql<{ repId: string | null; earns: boolean }[]>`
      SELECT rep_id AS "repId", rep_earns_commission AS earns FROM users WHERE id = ${id}`;
    assert.equal(user.repId, a);
    assert.equal(user.earns, true);
  });
});

test("blank shares are equal, lead is the first added", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b, c] = [await made.rep(), await made.rep(), await made.rep()];
    const id = await made.customer();
    assert.equal(await setAccountReps(id, [a, b, c].map((repId) => ({ repId, shareBp: null })), null), "ok");
    const list = await listAccountReps(id);
    assert.deepEqual(list.map((r) => r.repId), [a, b, c]);
    assert.deepEqual(list.map((r) => r.effectiveShareBp), [3334, 3333, 3333]);
    assert.deepEqual(list.map((r) => r.isLead), [true, false, false]);
  });
});

test("an account rate of 0 clears the legacy earns flag", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const a = await made.rep();
    const id = await made.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: null }], 0), "ok");
    const [user] = await sql<{ rate: number | null; earns: boolean }[]>`
      SELECT commission_rate_bp AS rate, rep_earns_commission AS earns FROM users WHERE id = ${id}`;
    assert.equal(user.rate, 0);
    assert.equal(user.earns, false);
  });
});

test("setAccountReps refuses a bad list and leaves the stored one alone", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b] = [await made.rep(), await made.rep()];
    const id = await made.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: 6000 }, { repId: b, shareBp: 4000 }], 300), "ok");
    const keep = await stored(id);

    const six: string[] = [];
    for (let i = 0; i < 6; i++) six.push(await made.rep());
    const inactive = await made.rep();
    await sql`UPDATE sales_reps SET active = false WHERE id = ${inactive}`;

    const cases: [string, Parameters<typeof setAccountReps>[0], Parameters<typeof setAccountReps>[1], string][] = [
      ["total", id, [{ repId: a, shareBp: 5000 }, { repId: b, shareBp: 4000 }], "total"],
      ["mixed", id, [{ repId: a, shareBp: 5000 }, { repId: b, shareBp: null }], "mixed"],
      ["duplicate", id, [{ repId: a, shareBp: null }, { repId: a, shareBp: null }], "duplicate"],
      ["too-many", id, six.map((repId) => ({ repId, shareBp: null })), "too-many"],
      ["bad-rep", id, [{ repId: a, shareBp: null }, { repId: inactive, shareBp: null }], "bad-rep"],
      ["not-found", randomUUID(), [{ repId: a, shareBp: null }], "not-found"],
    ];
    for (const [label, customerId, rows, expected] of cases) {
      assert.equal(await setAccountReps(customerId, rows, null), expected, label);
      assert.deepEqual(await stored(id), keep, `${label} left the list unchanged`);
    }
    const [user] = await sql<{ rate: number | null }[]>`SELECT commission_rate_bp AS rate FROM users WHERE id = ${id}`;
    assert.equal(user.rate, 300);
  });
});

test("an inactive rep already listed can stay", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b] = [await made.rep(), await made.rep()];
    const id = await made.customer();
    const rows = [{ repId: a, shareBp: null }, { repId: b, shareBp: null }];
    assert.equal(await setAccountReps(id, rows, null), "ok");
    await sql`UPDATE sales_reps SET active = false WHERE id = ${b}`;
    assert.equal(await setAccountReps(id, rows, null), "ok");
    const flagged = (await listAccountsWithInactiveRep()).find((row) => row.customerId === id);
    assert.deepEqual(flagged?.inactiveReps, ["Rep 2"]);
  });
});

test("an empty list unassigns", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const a = await made.rep();
    const id = await made.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: null }], 400), "ok");
    assert.equal(await setAccountReps(id, [], null), "ok");
    assert.equal((await stored(id)).length, 0);
    const [user] = await sql<{ repId: string | null; rate: number | null; earns: boolean }[]>`
      SELECT rep_id AS "repId", commission_rate_bp AS rate, rep_earns_commission AS earns FROM users WHERE id = ${id}`;
    assert.deepEqual(user, { repId: null, rate: null, earns: false });
    assert.equal(await repAccess(a, id), "unassigned");
  });
});

test("repAccess tells mine, taken, unassigned and missing apart", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b, other] = [await made.rep(), await made.rep(), await made.rep()];
    const id = await made.customer();
    const free = await made.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: null }, { repId: b, shareBp: null }], null), "ok");
    assert.equal(await repAccess(a, id), "mine");
    assert.equal(await repAccess(b, id), "mine");
    assert.equal(await repAccess(other, id), "taken");
    assert.equal(await repAccess(other, free), "unassigned");
    assert.equal(await repAccess(other, randomUUID()), "missing");
  });
});

test("every successful save writes one audit row", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const a = await made.rep();
    const id = await made.customer();
    const count = async () =>
      (await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log
        WHERE action = 'customer.reps-changed' AND subject_kind = 'customer' AND subject_id = ${id}`)[0].n;
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: null }], 500), "ok");
    assert.equal(await count(), 1);
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: null }], 100), "ok");
    assert.equal(await count(), 2);
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: 5000 }], null), "total");
    assert.equal(await count(), 2); // a refusal writes nothing
  });
});

// ── Orders copy the split. These place orders through the real submission
// function; the rows are committed (setAccountReps and the lock test need
// that), so each test removes its own orders, cart and product afterwards.

type Made = Parameters<Parameters<typeof withCommitted>[0]>[0];

async function withOrders(
  made: Made,
  body: (place: (userId: string | null, placedByRepId?: string | null, payable?: boolean) => ReturnType<typeof submitOrderFromCartInTransaction>) => Promise<void>,
  customers: string[],
) {
  const categories: number[] = [];
  try {
    await body(async (userId, placedByRepId = null, payable = false) => {
      const suffix = randomUUID();
      const [category] = await sql<{ id: number }[]>`
        INSERT INTO categories (slug, path, name_en, name_fa)
        VALUES (${`split-${suffix}`}, ${`split-${suffix}`}, 'Split test', 'آزمایش') RETURNING id`;
      categories.push(category.id);
      const [family] = await sql<{ id: number }[]>`
        INSERT INTO product_families (slug, category_id, name_en, name_fa)
        VALUES (${`split-family-${suffix}`}, ${category.id}, 'Split family', 'خانواده') RETURNING id`;
      const [product] = await sql<{ id: number }[]>`
        INSERT INTO products (part_number, family_id, specs, price_cents,
                              inventory_available, inventory_on_hold, inventory_sold)
        VALUES (${`SPL-${suffix}`}, ${family.id}, '{}'::jsonb, 1000, 100, 0, 0) RETURNING id`;
      const [cart] = await sql<{ id: string }[]>`INSERT INTO carts DEFAULT VALUES RETURNING id`;
      await sql`INSERT INTO cart_items (cart_id, product_id, qty) VALUES (${cart.id}, ${product.id}, 2)`;
      return sql.begin((tx) => submitOrderFromCartInTransaction(tx, orderInput(cart.id, product.id, userId, placedByRepId, payable)));
    });
  } finally {
    if (customers.length) await sql`DELETE FROM orders WHERE user_id = ANY(${customers}::uuid[])`;
    if (categories.length) {
      await sql`DELETE FROM carts WHERE id IN (SELECT cart_id FROM cart_items WHERE product_id IN
        (SELECT p.id FROM products p JOIN product_families f ON f.id = p.family_id WHERE f.category_id = ANY(${categories}::int[])))`;
      await sql`DELETE FROM products WHERE family_id IN (SELECT id FROM product_families WHERE category_id = ANY(${categories}::int[]))`;
      await sql`DELETE FROM product_families WHERE category_id = ANY(${categories}::int[])`;
      await sql`DELETE FROM categories WHERE id = ANY(${categories}::int[])`;
    }
  }
  void made;
}

function orderInput(cartId: string, productId: number, userId: string | null, placedByRepId: string | null, payable = false) {
  return {
    cartId,
    // Two units on a shelf of 100, exactly as the page would have signed them.
    cartFingerprint: quoteCartFingerprint(
      splitCart([{ productId, qty: 2, unitPriceCents: 1000, inStock: true, available: 100 }]).lines,
    ),
    submissionKey: randomUUID(),
    locale: "en" as const,
    currency: "USD" as const,
    userId,
    placedByRepId,
    contact: { company: "C", contactName: "N", email: "", phone: "1", poNumber: "", address: "1 Test St", city: "Tehran", country: "", notes: "", postalCode: "", nationalId: "", economicCode: "" },
    mode: "split" as const,
    // Pish-factor terms turn the order into an `invoiced` one that confirmPayment can accept;
    // without them it is only `received`.
    pishFactor: payable ? { rate: 1_000_000, vatRateBp: 1000 } : null,
  };
}

type Placed = Awaited<ReturnType<typeof submitOrderFromCartInTransaction>>;

function refOf(result: Placed): string {
  if (result.kind !== "created") throw new Error(`expected an order, got ${result.kind}`);
  return result.ref;
}

const orderRow = async (ref: string) => {
  const [order] = await sql<{ id: number; repId: string | null; rateBp: number | null; placedByRep: boolean; placedByRepId: string | null }[]>`
    SELECT id, rep_id AS "repId", commission_rate_bp AS "rateBp", placed_by_rep AS "placedByRep",
           placed_by_rep_id AS "placedByRepId"
    FROM orders WHERE ref = ${ref}`;
  const rows = await sql<{ repId: string; shareBp: number }[]>`
    SELECT rep_id AS "repId", share_bp AS "shareBp" FROM order_rep_shares WHERE order_id = ${order.id}
    ORDER BY share_bp DESC, rep_id`;
  // Plain objects: deepStrictEqual compares prototypes, and a driver row is not one.
  return { ...order, shares: rows.map((row) => ({ repId: row.repId, shareBp: row.shareBp })) };
};

test("order copies a 75/25 split and the account rate", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b] = [await made.rep(), await made.rep()];
    const id = await made.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: 7500 }, { repId: b, shareBp: 2500 }], 400), "ok");
    await withOrders(made, async (place) => {
      const order = await orderRow(refOf(await place(id)));
      assert.deepEqual(order.shares, [{ repId: a, shareBp: 7500 }, { repId: b, shareBp: 2500 }]);
      assert.equal(order.rateBp, 400);
      assert.equal(order.repId, a); // legacy column: the biggest share
    }, [id]);
  });
});

test("blank account rate follows the lead rep's rate at placement", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const lead = await made.rep();
    const id = await made.customer();
    await sql`UPDATE sales_reps SET commission_rate_bp = 500 WHERE id = ${lead}`;
    assert.equal(await setAccountReps(id, [{ repId: lead, shareBp: null }], null), "ok");
    await withOrders(made, async (place) => {
      const first = await orderRow(refOf(await place(id)));
      assert.equal(first.rateBp, 500);
      await sql`UPDATE sales_reps SET commission_rate_bp = 700 WHERE id = ${lead}`;
      const second = await orderRow(refOf(await place(id)));
      assert.equal(second.rateBp, 700);
      const [{ rateBp }] = await sql<{ rateBp: number }[]>`SELECT commission_rate_bp AS "rateBp" FROM orders WHERE id = ${first.id}`;
      assert.equal(rateBp, 500); // the first order keeps what it was placed at
    }, [id]);
  });
});

test("later changes do not reach a placed order", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b] = [await made.rep(), await made.rep()];
    const id = await made.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: 6000 }, { repId: b, shareBp: 4000 }], null), "ok");
    await withOrders(made, async (place) => {
      const ref = refOf(await place(id));
      const before = await orderRow(ref);
      const other = await made.rep();
      assert.equal(await setAccountReps(id, [{ repId: other, shareBp: null }], 100), "ok");
      assert.deepEqual(await orderRow(ref), before);
    }, [id]);
  });
});

test("inactive rep is left out", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b] = [await made.rep(), await made.rep()];
    const id = await made.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: 7500 }, { repId: b, shareBp: 2500 }], null), "ok");
    await sql`UPDATE sales_reps SET active = false WHERE id = ${b}`;
    await withOrders(made, async (place) => {
      const order = await orderRow(refOf(await place(id)));
      assert.deepEqual(order.shares, [{ repId: a, shareBp: 7500 }]);
      assert.equal(order.rateBp, 250);
      assert.equal(order.repId, a);
    }, [id]);
  });
});

test("rep on the list may order; another rep may not", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b, outsider] = [await made.rep(), await made.rep(), await made.rep()];
    const id = await made.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: null }, { repId: b, shareBp: null }], null), "ok");
    await withOrders(made, async (place) => {
      const order = await orderRow(refOf(await place(id, b)));
      assert.equal(order.placedByRep, true);
      assert.equal(order.placedByRepId, b);
      assert.equal(order.shares.length, 2);

      assert.deepEqual(await place(id, outsider), { kind: "customer-moved" });
      const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders WHERE user_id = ${id}`;
      assert.equal(n, 1);
    }, [id]);
  });
});

test("rep removed before submit", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b] = [await made.rep(), await made.rep()];
    const id = await made.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: null }, { repId: b, shareBp: null }], null), "ok");
    assert.equal(await setAccountReps(id, [{ repId: b, shareBp: null }], null), "ok");
    await withOrders(made, async (place) => {
      assert.deepEqual(await place(id, a), { kind: "customer-moved" });
      const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders WHERE user_id = ${id}`;
      assert.equal(n, 0);
    }, [id]);
  });
});

test("rep orders for an unassigned customer", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const rep = await made.rep();
    const id = await made.customer();
    await withOrders(made, async (place) => {
      const order = await orderRow(refOf(await place(id, rep)));
      assert.equal(order.placedByRep, true);
      assert.equal(order.placedByRepId, rep);
      assert.equal(order.shares.length, 0);
      assert.equal(order.repId, null);
      assert.equal(order.rateBp, null);
    }, [id]);
  });
});

test("split saved mid-submission waits for the order, which keeps the old split", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b, c] = [await made.rep(), await made.rep(), await made.rep()];
    const id = await made.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: 7000 }, { repId: b, shareBp: 3000 }], null), "ok");
    await withOrders(made, async () => {
      // A cart outside the helper so the order can be written inside transaction A.
      const suffix = randomUUID();
      const [category] = await sql<{ id: number }[]>`
        INSERT INTO categories (slug, path, name_en, name_fa)
        VALUES (${`split-${suffix}`}, ${`split-${suffix}`}, 'Split test', 'آزمایش') RETURNING id`;
      const [family] = await sql<{ id: number }[]>`
        INSERT INTO product_families (slug, category_id, name_en, name_fa)
        VALUES (${`split-family-${suffix}`}, ${category.id}, 'Split family', 'خانواده') RETURNING id`;
      const [product] = await sql<{ id: number }[]>`
        INSERT INTO products (part_number, family_id, specs, price_cents,
                              inventory_available, inventory_on_hold, inventory_sold)
        VALUES (${`SPL-${suffix}`}, ${family.id}, '{}'::jsonb, 1000, 100, 0, 0) RETURNING id`;
      const [cart] = await sql<{ id: string }[]>`INSERT INTO carts DEFAULT VALUES RETURNING id`;
      await sql`INSERT INTO cart_items (cart_id, product_id, qty) VALUES (${cart.id}, ${product.id}, 2)`;
      try {
        let save: Promise<string> | undefined;
        let settled = false;
        const result = await sql.begin(async (tx) => {
          assert.ok(await splitForOrder(tx, id)); // holds the customer-row lock
          save = setAccountReps(id, [{ repId: c, shareBp: null }], null);
          void save.then(() => { settled = true; });
          await new Promise((resolve) => setTimeout(resolve, 200));
          assert.equal(settled, false, "the save must wait for the open order");
          return submitOrderFromCartInTransaction(tx, orderInput(cart.id, product.id, id, null));
        });
        assert.equal(await save, "ok");
        const order = await orderRow(refOf(result));
        assert.deepEqual(order.shares, [{ repId: a, shareBp: 7000 }, { repId: b, shareBp: 3000 }]);
      } finally {
        await sql`DELETE FROM orders WHERE user_id = ${id}`;
        await sql`DELETE FROM carts WHERE id = ${cart.id}`;
        await sql`DELETE FROM products WHERE id = ${product.id}`;
        await sql`DELETE FROM product_families WHERE id = ${family.id}`;
        await sql`DELETE FROM categories WHERE id = ${category.id}`;
      }
    }, [id]);
  });
});

// ── A paid rep order wins an unassigned customer. confirmPayment is the admin's
// "paid"; nothing a rep does reaches it.

const claimAudits = async (customerId: string) =>
  (await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit_log
    WHERE action = 'customer.claimed' AND subject_kind = 'customer' AND subject_id = ${customerId}`)[0].n;

const listOf = async (id: string) => (await stored(id)).map((row) => ({ repId: row.repId, shareBp: row.shareBp }));

async function placed(place: Parameters<Parameters<typeof withOrders>[1]>[0], userId: string | null, repId: string | null) {
  const order = await orderRow(refOf(await place(userId, repId, true)));
  const [{ status }] = await sql<{ status: string }[]>`SELECT status FROM orders WHERE id = ${order.id}`;
  assert.equal(status, "invoiced", "the fixture order must be payable");
  return order.id;
}

test("paid rep order claims the customer", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const rep = await made.rep();
    const id = await made.customer();
    await withOrders(made, async (place) => {
      const orderId = await placed(place, id, rep);
      assert.equal(await confirmPayment(orderId, "invoiced"), true);
      assert.deepEqual(await listOf(id), [{ repId: rep, shareBp: null }]);
      const [order] = await sql<{ ref: string }[]>`SELECT ref FROM orders WHERE id = ${orderId}`;
      const row = await orderRow(order.ref);
      assert.deepEqual(row.shares, [{ repId: rep, shareBp: 10000 }]);
      assert.equal(row.rateBp, 250);
      assert.equal(row.repId, rep);
      assert.equal(await claimAudits(id), 1);
      const [user] = await sql<{ repId: string | null; earns: boolean }[]>`
        SELECT rep_id AS "repId", rep_earns_commission AS earns FROM users WHERE id = ${id}`;
      assert.deepEqual({ ...user }, { repId: rep, earns: true });
    }, [id]);
  });
});

test("unpaid, cancelled and expired orders claim nothing", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const rep = await made.rep();
    const id = await made.customer();
    await withOrders(made, async (place) => {
      const open = await placed(place, id, rep);
      assert.deepEqual(await listOf(id), []);
      const cancelled = await placed(place, id, rep);
      await sql`UPDATE orders SET status = 'cancelled', expires_at = NULL WHERE id = ${cancelled}`;
      assert.equal(await confirmPayment(cancelled, "invoiced"), false);
      const lapsing = await placed(place, id, rep);
      await sql`UPDATE orders SET expires_at = now() - interval '1 hour' WHERE id = ${lapsing}`;
      await sweepExpiredOrders({ force: true });
      assert.equal(await confirmPayment(lapsing, "invoiced"), false);
      assert.deepEqual(await listOf(id), []);
      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM order_rep_shares WHERE order_id = ANY(${[open, cancelled, lapsing]}::bigint[])`;
      assert.equal(n, 0);
    }, [id]);
  });
});

test("receipt upload does not claim", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const rep = await made.rep();
    const id = await made.customer();
    await withOrders(made, async (place) => {
      const orderId = await placed(place, id, rep);
      assert.equal(
        await addPaymentProof(orderId, { path: `test/${randomUUID()}.jpg`, type: "image/jpeg", size: 10 }, { kind: "rep", repId: rep }),
        "added",
      );
      const [{ status }] = await sql<{ status: string }[]>`SELECT status FROM orders WHERE id = ${orderId}`;
      assert.equal(status, "payment_review");
      assert.deepEqual(await listOf(id), []);
    }, [id]);
  });
});

test("a customer's own paid order claims nothing", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const id = await made.customer();
    await withOrders(made, async (place) => {
      const orderId = await placed(place, id, null);
      assert.equal(await confirmPayment(orderId, "invoiced"), true);
      assert.deepEqual(await listOf(id), []);
      assert.equal(await claimAudits(id), 0);
    }, [id]);
  });
});

test("second order by the same rep is credited", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const rep = await made.rep();
    const id = await made.customer();
    await withOrders(made, async (place) => {
      const first = await placed(place, id, rep);
      const second = await placed(place, id, rep);
      assert.equal(await confirmPayment(first, "invoiced"), true);
      assert.equal(await confirmPayment(second, "invoiced"), true);
      const rows = await sql<{ orderId: number; shareBp: number }[]>`
        SELECT order_id AS "orderId", share_bp AS "shareBp" FROM order_rep_shares
        WHERE order_id IN (${first}, ${second}) AND rep_id = ${rep} ORDER BY order_id`;
      assert.deepEqual(rows.map((row) => ({ ...row })), [
        { orderId: first, shareBp: 10000 }, { orderId: second, shareBp: 10000 },
      ]);
      assert.deepEqual(await listOf(id), [{ repId: rep, shareBp: null }]);
      assert.equal(await claimAudits(id), 1); // credited changes no list, so no second claim
    }, [id]);
  });
});

test("lost race: the first paid order wins, the second keeps no shares", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b] = [await made.rep(), await made.rep()];
    const id = await made.customer();
    await withOrders(made, async (place) => {
      const orderA = await placed(place, id, a);
      const orderB = await placed(place, id, b);
      assert.equal(await confirmPayment(orderA, "invoiced"), true);
      assert.equal(await confirmPayment(orderB, "invoiced"), true);
      assert.deepEqual(await listOf(id), [{ repId: a, shareBp: null }]);
      const rows = await sql<{ orderId: number; repId: string }[]>`
        SELECT order_id AS "orderId", rep_id AS "repId" FROM order_rep_shares WHERE order_id IN (${orderA}, ${orderB})`;
      assert.deepEqual(rows.map((row) => ({ ...row })), [{ orderId: orderA, repId: a }]);
    }, [id]);
  });
});

test("concurrent claims: exactly one rep wins", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, b] = [await made.rep(), await made.rep()];
    const id = await made.customer();
    await withOrders(made, async (place) => {
      const orderA = await placed(place, id, a);
      const orderB = await placed(place, id, b);
      const results = await Promise.all([confirmPayment(orderA, "invoiced"), confirmPayment(orderB, "invoiced")]);
      assert.deepEqual(results, [true, true]);
      assert.equal((await listOf(id)).length, 1);
      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(DISTINCT order_id)::int AS n FROM order_rep_shares WHERE order_id IN (${orderA}, ${orderB})`;
      assert.equal(n, 1);
      assert.equal(await claimAudits(id), 1);
    }, [id]);
  });
});

test("admin assigned someone else before payment", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const [a, c] = [await made.rep(), await made.rep()];
    const id = await made.customer();
    await withOrders(made, async (place) => {
      const orderId = await placed(place, id, a);
      assert.equal(await setAccountReps(id, [{ repId: c, shareBp: null }], null), "ok");
      assert.equal(await confirmPayment(orderId, "invoiced"), true);
      assert.deepEqual(await listOf(id), [{ repId: c, shareBp: null }]);
      const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM order_rep_shares WHERE order_id = ${orderId}`;
      assert.equal(n, 0);
    }, [id]);
  });
});

// ── Rep money by share. Delivered orders are built in a rolled-back
// transaction with exactly the share rows submission would have written.

async function deliveredWithShares(
  tx: Tx,
  fields: { totalCents: number; fx: number; rateBp: number; shares: { repId: string; shareBp: number }[] },
): Promise<number> {
  const [order] = await tx<{ id: number }[]>`
    INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                        status, commission_rate_bp, invoice_number, fx_rate_to_rial,
                        created_at, invoiced_at, paid_at, shipped_at, delivered_at)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Money Co', 'N', '',
            ${fields.totalCents}, ${fields.totalCents}, 'delivered', ${fields.rateBp},
            ${`INV-TEST-${randomUUID().slice(0, 8)}`}, ${fields.fx},
            now() - interval '9 days', now() - interval '8 days', now() - interval '6 days',
            now() - interval '4 days', now() - interval '2 days')
    RETURNING id`;
  for (const share of fields.shares) {
    await tx`INSERT INTO order_rep_shares (order_id, rep_id, share_bp)
             VALUES (${order.id}, ${share.repId}, ${share.shareBp})`;
  }
  return order.id;
}

// 10,000 cents at 1,000,000 rial per dollar: a sale of exactly 100,000,000 rial.
const HUNDRED_MILLION = { totalCents: 10000, fx: 1_000_000 };

test("one pot, then split", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const [a, b] = [await insertRep(tx), await insertRep(tx)];
    await deliveredWithShares(tx, { ...HUNDRED_MILLION, rateBp: 500, shares: [
      { repId: a, shareBp: 7500 }, { repId: b, shareBp: 2500 },
    ] });
    const [rowA] = await listDeliveredForRep(a, tx);
    const [rowB] = await listDeliveredForRep(b, tx);
    assert.deepEqual([rowA.salesRial, rowA.commissionRial, rowA.shareBp, rowA.rateBp], [75_000_000, 3_750_000, 7500, 500]);
    assert.deepEqual([rowB.salesRial, rowB.commissionRial, rowB.shareBp, rowB.rateBp], [25_000_000, 1_250_000, 2500, 500]);
  });
});

test("rep totals add up to the sale", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const [a, b] = [await insertRep(tx), await insertRep(tx)];
    await deliveredWithShares(tx, { ...HUNDRED_MILLION, rateBp: 500, shares: [
      { repId: a, shareBp: 7500 }, { repId: b, shareBp: 2500 },
    ] });
    const recent = (await listRecentDeliveries(30, tx)).filter((row) => row.repId === a || row.repId === b);
    assert.equal(recent.length, 2);
    assert.equal(recent.reduce((sum, row) => sum + row.salesRial, 0), 100_000_000);
    const totals = await listRepTotals(tx);
    assert.equal(totals.get(a)?.earnedRial, 3_750_000);
    assert.equal(totals.get(b)?.earnedRial, 1_250_000);
  });
});

test("uneven thirds", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const reps = [await insertRep(tx), await insertRep(tx), await insertRep(tx)];
    await deliveredWithShares(tx, { totalCents: 100_000_001, fx: 100, rateBp: 333, shares: [
      { repId: reps[0], shareBp: 3334 }, { repId: reps[1], shareBp: 3333 }, { repId: reps[2], shareBp: 3333 },
    ] });
    const rows = (await Promise.all(reps.map((rep) => listDeliveredForRep(rep, tx)))).map((r) => r[0]);
    for (const row of rows) {
      assert.ok(Number.isInteger(row.salesRial) && Number.isInteger(row.commissionRial));
    }
    const pot = Math.round(100_000_001 * 333 / 10000);
    const sum = rows.reduce((total, row) => total + row.commissionRial, 0);
    assert.ok(Math.abs(sum - pot) <= 2, `shares ${sum} vs pot ${pot}`);
  });
});

test("inactive rep's share is paid to nobody", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const [a, b] = [await insertRep(tx), await insertRep(tx)];
    // B was inactive at placement, so submission wrote no row for B (75/25 stays 75).
    await deliveredWithShares(tx, { ...HUNDRED_MILLION, rateBp: 500, shares: [{ repId: a, shareBp: 7500 }] });
    const totals = await listRepTotals(tx);
    assert.equal(totals.get(a)?.earnedRial, 3_750_000);
    assert.equal(totals.get(b)?.earnedRial, 0);
    assert.deepEqual(await listDeliveredForRep(b, tx), []);
  });
});

test("rate 0 credits the sale and no commission", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const a = await insertRep(tx);
    await deliveredWithShares(tx, { ...HUNDRED_MILLION, rateBp: 0, shares: [{ repId: a, shareBp: 10000 }] });
    const [row] = await listDeliveredForRep(a, tx);
    assert.equal(row.salesRial, 100_000_000);
    assert.equal(row.commissionRial, 0);
  });
});

test("backfilled single-rep order is unchanged", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const repId = await insertRep(tx, { rateBp: 500 });
    const userId = await insertCustomer(tx, { repId, earns: true });
    await insertDeliveredOrder(tx, { userId, repId, rateBp: 500 }); // 10000 cents × 1,050,000
    await runBackfill(tx);
    const [row] = await listDeliveredForRep(repId, tx);
    assert.equal(row.salesRial, Math.round(10000 * 1_050_000 / 100));
    assert.equal(row.commissionRial, Math.round(10000 * 1_050_000 * 500 / 1_000_000));
    assert.equal(row.shareBp, 10000);
  });
});

test("pending claim shows as an estimate", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const rep = await made.rep();
    const id = await made.customer();
    await withOrders(made, async (place) => {
      const ref = refOf(await place(id, rep));
      const rows = await listInProgressForRep(rep, 1_000_000);
      const row = rows.find((r) => r.ref === ref);
      assert.ok(row, "the pending order is listed");
      assert.equal(row.pendingClaim, true);
      assert.equal(row.estimate, true);
      assert.equal(row.shareBp, 10000);
      assert.equal(row.rateBp, 250);
      assert.deepEqual(await listDeliveredForRep(rep), []);
    }, [id]);
  });
});


// ── Rep access by account list (Task 7). Every rep-scoped read and write goes
// through `customer_reps`; the legacy `users.rep_id` is written, never read.

type Scope = {
  rep: (name?: string) => Promise<string>;
  customer: (fields?: { company?: string; phone?: string; code?: string; contact?: string }) => Promise<string>;
  track: (userId: string) => void;
};

async function inScope(body: (scope: Scope) => Promise<void>) {
  const reps: string[] = [];
  const users: string[] = [];
  try {
    await body({
      rep: async (name = `Rep ${reps.length + 1}`) => {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO sales_reps (username, password_hash, name, commission_rate_bp, referral_code)
          VALUES (${`rep-${randomUUID().slice(0, 8)}`}, 'x', ${name}, 250, ${randomReferralCode()})
          RETURNING id`;
        reps.push(row.id);
        return row.id;
      },
      customer: async (fields = {}) => {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO users (email, password_hash, customer_code, origin, phone, company, contact_name)
          VALUES (${`${randomUUID()}@example.invalid`}, 'x', ${fields.code ?? randomCustomerCode()}, 'self',
                  ${fields.phone ?? "0912 000 0000"}, ${fields.company ?? "Scope Co"}, ${fields.contact ?? "Contact"})
          RETURNING id`;
        users.push(row.id);
        return row.id;
      },
      track: (userId) => void users.push(userId),
    });
  } finally {
    if (users.length) {
      await sql`DELETE FROM orders WHERE user_id = ANY(${users}::uuid[])`;
      await sql`DELETE FROM audit_log WHERE subject_kind = 'customer' AND subject_id = ANY(${users}::text[])`;
      await sql`DELETE FROM users WHERE id = ANY(${users}::uuid[])`;
    }
    if (reps.length) {
      await sql`DELETE FROM audit_log WHERE subject_kind = 'rep' AND subject_id = ANY(${reps}::text[])`;
      await sql`DELETE FROM sales_reps WHERE id = ANY(${reps}::uuid[])`;
    }
  }
}

// Letters only: a search with three or more digits anywhere in it also matches
// phone numbers by those digits joined together, so a hex tag could match a fixture phone.
const tagOf = () =>
  [...randomUUID().replace(/-/g, "").slice(0, 10)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
const legacyOf = async (id: string) =>
  (await sql<{ repId: string | null; earns: boolean }[]>`
    SELECT rep_id AS "repId", rep_earns_commission AS earns FROM users WHERE id = ${id}`)[0];

test("a co-rep reaches the customer", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const [a, b, c] = [await s.rep(), await s.rep(), await s.rep()];
    const id = await s.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: 7500 }, { repId: b, shareBp: 2500 }], null), "ok");
    const input = { company: "New Co", contactName: "N", phone: "1", email: null, address: "", city: "" };

    assert.equal((await getCustomerForRep(b, id))?.id, id);
    assert.equal(await updateCustomerForRep(b, id, input), "ok");
    assert.equal(await addNoteForRep(b, id, "hello"), true);
    assert.equal(await setFollowUpForRep(b, id, "2020-01-01"), true);
    assert.deepEqual((await listFollowUpsDue(b, "2030-01-01")).map((row) => row.id), [id]);
    assert.equal(await countCustomersForRep(b), 1);

    assert.equal(await getCustomerForRep(c, id), null);
    assert.equal(await updateCustomerForRep(c, id, input), "not-found");
    assert.equal(await addNoteForRep(c, id, "intruder"), false);
    assert.equal(await setFollowUpForRep(c, id, "2020-01-01"), false);
    assert.equal((await listFollowUpsDue(c, "2030-01-01")).length, 0);
    assert.equal(await countCustomersForRep(c), 0);
  });
});

test("removed rep loses the customer at once but keeps their order", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const [a, b] = [await s.rep(), await s.rep()];
    const id = await s.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: 7500 }, { repId: b, shareBp: 2500 }], null), "ok");
    await withOrders(undefined as never, async (place) => {
      const ref = refOf(await place(id, a));
      assert.equal(await setAccountReps(id, [{ repId: a, shareBp: 10000 }], null), "ok");

      const input = { company: "X", contactName: "N", phone: "1", email: null, address: "", city: "" };
      assert.equal(await getCustomerForRep(b, id), null);
      assert.equal(await updateCustomerForRep(b, id, input), "not-found");
      assert.equal(await addNoteForRep(b, id, "late"), false);
      assert.equal(await setFollowUpForRep(b, id, "2020-01-01"), false);

      const rows = await listOrdersForRep(b, null);
      const row = rows.find((r) => r.ref === ref);
      assert.ok(row, "the order stays visible");
      assert.equal(row.canAct, true);
      assert.equal(row.myShareBp, 2500);
      assert.equal(row.pendingClaim, false);
      assert.equal(await repCanActOnOrder(b, ref), true);
      assert.equal((await getOrderForRep(b, ref))?.order.customerIsMine, false);
    }, [id]);
  });
});

test("an order a rep placed for an unassigned customer is theirs to act on, pending", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const [a, c] = [await s.rep(), await s.rep()];
    const id = await s.customer();
    await withOrders(undefined as never, async (place) => {
      const ref = refOf(await place(id, a));
      const row = (await listOrdersForRep(a, null)).find((r) => r.ref === ref);
      assert.ok(row);
      assert.equal(row.canAct, true);
      assert.equal(row.pendingClaim, true);
      assert.equal(row.myShareBp, null);
      assert.equal(await repCanActOnOrder(a, ref), true);
      assert.equal((await listOrdersForRep(c, null)).some((r) => r.ref === ref), false);
      assert.equal(await repCanActOnOrder(c, ref), false);
      assert.equal(await getOrderForRep(c, ref), null);
    }, [id]);
  });
});

test("search beyond mine", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const tag = tagOf();
    const [me, other] = [await s.rep(), await s.rep("Other Rep")];
    const free = await s.customer({ company: `Acme ${tag} Free`, contact: "Fay", phone: "0912 111 2222" });
    const taken = await s.customer({ company: `Acme ${tag} Taken` });
    const mine = await s.customer({ company: `Acme ${tag} Mine` });
    assert.equal(await setAccountReps(taken, [{ repId: other, shareBp: null }], null), "ok");
    assert.equal(await setAccountReps(mine, [{ repId: me, shareBp: null }], null), "ok");

    assert.deepEqual(await searchBeyondMine(me, "ac"), { unassigned: [], taken: [] });
    assert.deepEqual(await searchBeyondMine(me, "  a  "), { unassigned: [], taken: [] });

    const found = await searchBeyondMine(me, `acme ${tag}`);
    assert.deepEqual(found.unassigned.map((row) => row.id), [free]);
    assert.deepEqual(Object.keys(found.unassigned[0]).sort(), ["company", "contactName", "customerCode", "id", "phone"]);
    assert.equal(found.taken.length, 1);
    assert.deepEqual(Object.keys(found.taken[0]).sort(), ["assignedTo", "company", "customerCode"]);
    assert.equal(found.taken[0].company, `Acme ${tag} Taken`);
    assert.equal(found.taken[0].assignedTo, "Other Rep");
    // The rep's own customer is in neither list, for any search that matches it.
    assert.ok(![...found.unassigned, ...found.taken].some((row) => row.company === `Acme ${tag} Mine`));

    // Seven taken customers match; five come back.
    for (let i = 0; i < 6; i++) {
      const id = await s.customer({ company: `Bulk ${tag} ${i}` });
      assert.equal(await setAccountReps(id, [{ repId: other, shareBp: null }], null), "ok");
    }
    const bulk = await s.customer({ company: `Bulk ${tag} extra` });
    assert.equal(await setAccountReps(bulk, [{ repId: other, shareBp: null }], null), "ok");
    assert.equal((await searchBeyondMine(me, `bulk ${tag}`)).taken.length, 5);

    // A rep with the customer on a shared list sees it in neither.
    assert.equal(await setAccountReps(taken, [{ repId: other, shareBp: 5000 }, { repId: me, shareBp: 5000 }], null), "ok");
    assert.ok(!(await searchBeyondMine(me, `acme ${tag}`)).taken.some((row) => row.company.endsWith("Taken")));
  });
});

test("search treats % and _ literally", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const tag = tagOf();
    const me = await s.rep();
    const literal = await s.customer({ company: `Bolt 50%_${tag}` });
    await s.customer({ company: `Bolt 50xyz${tag}` });
    assert.deepEqual((await searchBeyondMine(me, `50%_${tag}`)).unassigned.map((row) => row.id), [literal]);
  });
});

test("search by phone and customer ID", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const me = await s.rep();
    const code = randomCustomerCode();
    const byPhone = await s.customer({ company: `Phone ${tagOf()}`, phone: "۰۹۱۲ ۳۴۵ ۹۸۷۶" });
    const byCode = await s.customer({ company: `Code ${tagOf()}`, code });
    // Persian digits typed into the box find a Persian-digit phone and a Latin one alike.
    assert.ok((await searchBeyondMine(me, "۰۹۱۲۳۴۵۹۸۷")).unassigned.some((row) => row.id === byPhone));
    assert.ok((await searchBeyondMine(me, "0912345987")).unassigned.some((row) => row.id === byPhone));
    assert.deepEqual((await searchBeyondMine(me, code)).unassigned.map((row) => row.id), [byCode]);
  });
});

test("orderable customer", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const [me, small, big] = [await s.rep("Me"), await s.rep("Small"), await s.rep("Big")];
    const mine = await s.customer({ company: "Mine Co" });
    const free = await s.customer({ company: "Free Co", contact: "Fay", phone: "0912 555 5555" });
    const taken = await s.customer({ company: "Taken Co" });
    assert.equal(await setAccountReps(mine, [{ repId: me, shareBp: null }], null), "ok");
    // The lead is the bigger share, not the first added.
    assert.equal(await setAccountReps(taken, [{ repId: small, shareBp: 3000 }, { repId: big, shareBp: 7000 }], null), "ok");

    const m = await getOrderableCustomerForRep(me, mine);
    assert.equal(m?.kind, "mine");
    const f = await getOrderableCustomerForRep(me, free);
    assert.equal(f?.kind, "unassigned");
    if (f?.kind === "unassigned") {
      assert.equal(f.customer.id, free);
      assert.equal(f.customer.contactName, "Fay");
      assert.equal(typeof f.customer.locale, "string");
      assert.equal(f.customer.email === null || typeof f.customer.email === "string", true);
    }
    assert.deepEqual(await getOrderableCustomerForRep(me, taken), { kind: "taken", assignedTo: "Big" });
    assert.equal(await getOrderableCustomerForRep(me, randomUUID()), null);
  });
});

test("rep customer list is paged at 50", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const tag = tagOf();
    const me = await s.rep();
    const ids: string[] = [];
    for (let i = 0; i < 55; i++) ids.push(await s.customer({ company: `Page ${tag} ${String(i).padStart(2, "0")}` }));
    await sql`
      INSERT INTO customer_reps (user_id, rep_id, share_bp)
      SELECT unnest(${ids}::uuid[]), ${me}, NULL`;
    const one = await listCustomersForRep(me, "", 1);
    const two = await listCustomersForRep(me, "", 2);
    assert.equal(one.rows.length, 50);
    assert.equal(two.rows.length, 5);
    assert.equal(one.total, 55);
    assert.equal(two.total, 55);
    assert.equal(new Set([...one.rows, ...two.rows].map((row) => row.id)).size, 55);
    const filtered = await listCustomersForRep(me, `page ${tag} 07`, 1);
    assert.equal(filtered.total, 1);
  });
});

test("referral sign-up and rep-created customers get a list row", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const rep = await s.rep();
    const referred = await createUser({
      email: `${randomUUID()}@example.invalid`, passwordHash: "x", company: "Ref Co", contactName: "R",
      phone: "0912 000 1111", locale: "en", origin: "referral", repId: rep, accountNumber: "assigned",
    });
    assert.notEqual(referred, "email-taken");
    if (referred === "email-taken") return;
    s.track(referred.id);
    assert.deepEqual((await listAccountReps(referred.id)).map((r) => [r.repId, r.shareBp]), [[rep, null]]);
    assert.deepEqual({ ...(await legacyOf(referred.id)) }, { repId: rep, earns: true });
    assert.equal((await getRepContactForUser(referred.id))?.name, "Rep 1");

    const self = await createUser({
      email: `${randomUUID()}@example.invalid`, passwordHash: "x", company: "Self Co", contactName: "S",
      phone: "0912 000 2222", locale: "en", origin: "self", repId: null, accountNumber: "assigned",
    });
    assert.notEqual(self, "email-taken");
    if (self === "email-taken") return;
    s.track(self.id);
    assert.deepEqual(await listAccountReps(self.id), []);

    const created = await createCustomerForRep(rep, {
      company: "Made Co", contactName: "M", phone: "0912 000 3333", email: `${randomUUID()}@example.invalid`,
      address: "", city: "", codeChoice: "random", passwordHash: "x", locale: "en",
    });
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;
    s.track(created.id);
    assert.deepEqual((await listAccountReps(created.id)).map((r) => [r.repId, r.shareBp]), [[rep, null]]);
    assert.deepEqual({ ...(await legacyOf(created.id)) }, { repId: rep, earns: true });
    assert.equal((await getCustomerForRep(rep, created.id))?.id, created.id);
  });
});

test("contact for a customer is the lead if active, else the first active rep", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const [first, lead] = [await s.rep("First"), await s.rep("Lead")];
    const id = await s.customer();
    assert.equal(await getRepContactForUser(id), null);
    assert.equal(await setAccountReps(id, [{ repId: first, shareBp: 3000 }, { repId: lead, shareBp: 7000 }], null), "ok");
    assert.equal((await getRepContactForUser(id))?.name, "Lead");
    await sql`UPDATE sales_reps SET active = false WHERE id = ${lead}`;
    assert.equal((await getRepContactForUser(id))?.name, "First");
    await sql`UPDATE sales_reps SET active = false WHERE id = ${first}`;
    assert.equal(await getRepContactForUser(id), null);
  });
});

test("assignCustomer writes the list and keeps the legacy columns in step", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const [a, b] = [await s.rep(), await s.rep()];
    const id = await s.customer();
    assert.equal(await assignCustomer(id, a, true), "ok");
    assert.deepEqual((await listAccountReps(id)).map((r) => [r.repId, r.shareBp]), [[a, null]]);
    assert.deepEqual({ ...(await legacyOf(id)) }, { repId: a, earns: true });
    assert.equal(await assignCustomer(id, b, false), "ok");
    assert.deepEqual((await listAccountReps(id)).map((r) => r.repId), [b]);
    assert.deepEqual({ ...(await legacyOf(id)) }, { repId: b, earns: false });
    assert.equal(await assignCustomer(id, null, false), "ok");
    assert.deepEqual(await listAccountReps(id), []);
    assert.deepEqual({ ...(await legacyOf(id)) }, { repId: null, earns: false });
    await sql`UPDATE sales_reps SET active = false WHERE id = ${a}`;
    assert.equal(await assignCustomer(id, a, true), "bad-rep");
    assert.equal(await assignCustomer(randomUUID(), b, true), "not-found");
    assert.deepEqual(await listAccountReps(id), []);
  });
});

test("deactivate with a destination swaps the name and keeps the share", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const [a, b, c] = [await s.rep(), await s.rep(), await s.rep()];
    const id = await s.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: 7000 }, { repId: b, shareBp: 3000 }], null), "ok");
    assert.equal(await deactivateRep(a, c), "ok");
    const list = await listAccountReps(id);
    assert.deepEqual(list.map((r) => [r.repId, r.shareBp]), [[c, 7000], [b, 3000]]);
    assert.equal(list[0].isLead, true);
    assert.equal((await legacyOf(id)).repId, c);
    assert.equal(await getCustomerForRep(a, id), null);
    assert.equal((await getCustomerForRep(c, id))?.id, id);
  });
});

test("deactivate merges into a destination already listed", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const [a, b] = [await s.rep(), await s.rep()];
    const filled = await s.customer();
    const blank = await s.customer();
    assert.equal(await setAccountReps(filled, [{ repId: a, shareBp: 7500 }, { repId: b, shareBp: 2500 }], null), "ok");
    assert.equal(await setAccountReps(blank, [{ repId: a, shareBp: null }, { repId: b, shareBp: null }], null), "ok");
    assert.equal(await deactivateRep(b, a), "ok");
    assert.deepEqual((await listAccountReps(filled)).map((r) => [r.repId, r.shareBp]), [[a, 10000]]);
    assert.deepEqual((await listAccountReps(blank)).map((r) => [r.repId, r.shareBp]), [[a, null]]);
    assert.equal((await legacyOf(filled)).repId, a);
  });
});

test("deactivate without a destination leaves the row", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const [a, b] = [await s.rep(), await s.rep()];
    const id = await s.customer();
    assert.equal(await setAccountReps(id, [{ repId: a, shareBp: 6000 }, { repId: b, shareBp: 4000 }], null), "ok");
    assert.equal(await deactivateRep(b, null), "ok");
    const list = await listAccountReps(id);
    assert.deepEqual(list.map((r) => [r.repId, r.shareBp, r.active]), [[a, 6000, true], [b, 4000, false]]);
    assert.equal(await deactivateRep(b, null), "not-found");
    const counts = await listReps();
    assert.equal(counts.find((r) => r.id === b)?.customerCount, 1);
  });
});

test("a placing rep deactivated before payment does not win the customer", async () => {
  assertLocalDatabase();
  await withCommitted(async (made) => {
    const rep = await made.rep();
    const id = await made.customer();
    await withOrders(made, async (place) => {
      const orderId = await placed(place, id, rep);
      assert.equal(await deactivateRep(rep, null), "ok");
      assert.equal(await confirmPayment(orderId, "invoiced"), true);
      assert.deepEqual(await listOf(id), []);
      assert.equal(await claimAudits(id), 0);
    }, [id]);
  });
});

test("taken customers match on company, exact ID or a full phone only", async () => {
  assertLocalDatabase();
  await inScope(async (s) => {
    const [cTag, eTag, kTag] = [tagOf(), tagOf(), tagOf()];
    const [me, other] = [await s.rep(), await s.rep("Other Rep")];
    const code = randomCustomerCode();
    const digits = String(Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)); // 10 digits, no leading 0
    const taken = await s.customer({
      company: `Held ${cTag} Co`, contact: `Person ${kTag}`, code, phone: `0${digits.slice(0, 3)} ${digits.slice(3)}`,
    });
    await sql`UPDATE users SET email = ${`mail${eTag}@example.invalid`} WHERE id = ${taken}`;
    assert.equal(await setAccountReps(taken, [{ repId: other, shareBp: null }], null), "ok");
    const found = async (search: string) =>
      (await searchBeyondMine(me, search)).taken.some((row) => row.company === `Held ${cTag} Co`);

    // Attributes of someone else's customer must not be confirmable.
    assert.equal(await found(`mail${eTag}`), false, "email fragment");
    assert.equal(await found(`person ${kTag}`), false, "contact name fragment");
    assert.equal(await found(kTag), false, "contact name fragment");
    assert.equal(await found(digits.slice(0, 3)), false, "3-digit phone fragment");
    assert.equal(await found(digits.slice(0, 6)), false, "6-digit phone fragment");

    assert.equal(await found(`held ${cTag}`), true, "company fragment");
    assert.equal(await found(code), true, "exact customer ID");
    assert.equal(await found(`0${digits.slice(0, 6)}`), true, "7-digit phone run");
    assert.equal(await found(digits), true, "full phone");
    const persian = `0${digits}`.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
    assert.equal(await found(persian), true, "Persian-digit phone");
  });
});
