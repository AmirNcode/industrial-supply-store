import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
import {
  createUser,
  findUserForSignIn,
  getRepContactForUser,
  getUserById,
  setPassword,
  updateProfile,
} from "./userQueries";
import {
  assignCustomer,
  createCustomerForRep,
  getCustomerForRep,
  listCustomersForRep,
  resetCustomerPasswordForRep,
  setFollowUpForRep,
  updateCustomerForRep,
} from "./customerQueries";
import { addNoteForRep, listNotes } from "./noteQueries";
import { issueInvoice } from "./invoiceQueries";
import { confirmPayment } from "./paymentProofQueries";
import { submitOrderFromCartInTransaction } from "./orderSubmissionQueries";
import { quoteCartFingerprint } from "@/lib/quoteSubmission";
import { getOrderByPayToken } from "./accountQueries";
import { getOrderForRep, getReorderLines, listOrdersForRep, repCanActOnOrder } from "./repOrderQueries";
import {
  addPayout,
  voidPayout,
  listDeliveredForRep,
  listInProgressForRep,
  listPayouts,
  listRepTotals,
  listTargets,
  setTarget,
} from "./repMoney";

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

function randomPhone(): string {
  return `0912${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
}

test("a rep reads and changes only their own customers", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  try {
    const a = await createRep({ username: `ca-${suffix}`, name: "A", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    const b = await createRep({ username: `cb-${suffix}`, name: "B", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    if (a === "username-taken" || b === "username-taken") throw new Error("username clash");
    repIds.push(a.id, b.id);

    const phone = randomPhone();
    const input = { company: `Co ${suffix}`, contactName: "N", phone, email: null, address: "", city: "" };
    const created = await createCustomerForRep(a.id, { ...input, codeChoice: "phone", passwordHash: "x", locale: "fa" });
    if (created.kind !== "created") throw new Error(created.kind);
    userIds.push(created.id);
    assert.equal(created.customerCode, phone.slice(-7));

    const mine = await getCustomerForRep(a.id, created.id);
    assert.equal(mine?.origin, "rep");
    assert.equal(mine?.repEarnsCommission, true);
    const [flag] = await sql<{ must: boolean }[]>`SELECT must_change_password AS must FROM users WHERE id = ${created.id}`;
    assert.equal(flag.must, true);

    // Rep B: every path reads as not found and changes nothing.
    assert.equal(await getCustomerForRep(b.id, created.id), null);
    assert.equal(await updateCustomerForRep(b.id, created.id, { ...input, company: "Hijacked" }), "not-found");
    assert.equal(await resetCustomerPasswordForRep(b.id, created.id, "y"), null);
    assert.equal(await setFollowUpForRep(b.id, created.id, "2030-01-01"), false);
    assert.equal(await addNoteForRep(b.id, created.id, "sneaky"), false);
    assert.equal((await listCustomersForRep(b.id, "")).some((c) => c.id === created.id), false);
    assert.equal((await getCustomerForRep(a.id, created.id))?.company, `Co ${suffix}`);
    assert.equal((await listNotes(created.id)).length, 0);

    // Rep A can, and search finds by ID and by phone digits.
    assert.equal(await addNoteForRep(a.id, created.id, "Called about O-rings"), true);
    assert.equal((await listNotes(created.id))[0]?.body, "Called about O-rings");
    assert.equal(await setFollowUpForRep(a.id, created.id, "2030-01-01"), true);
    assert.equal((await listCustomersForRep(a.id, created.customerCode))[0]?.id, created.id);
    assert.equal((await listCustomersForRep(a.id, phone.slice(-5))).some((c) => c.id === created.id), true);

    // The same phone again: its digits are taken, and the rep is told so.
    assert.deepEqual(
      await createCustomerForRep(a.id, { ...input, codeChoice: "phone", passwordHash: "x", locale: "fa" }),
      { kind: "code-taken" },
    );
    const random = await createCustomerForRep(a.id, { ...input, codeChoice: "random", passwordHash: "x", locale: "fa" });
    if (random.kind !== "created") throw new Error(random.kind);
    userIds.push(random.id);
    assert.notEqual(random.customerCode, created.customerCode);
    assert.deepEqual(
      await createCustomerForRep(a.id, { ...input, phone: "123", codeChoice: "phone", passwordHash: "x", locale: "fa" }),
      { kind: "no-phone-code" },
    );

    const email = `${suffix}@example.invalid`;
    const withEmail = await createCustomerForRep(a.id, { ...input, phone: randomPhone(), email, codeChoice: "phone", passwordHash: "x", locale: "fa" });
    if (withEmail.kind !== "created") throw new Error(withEmail.kind);
    userIds.push(withEmail.id);
    assert.deepEqual(
      await createCustomerForRep(a.id, { ...input, phone: randomPhone(), email: email.toUpperCase(), codeChoice: "phone", passwordHash: "x", locale: "fa" }),
      { kind: "email-taken" },
    );

    // Moving the customer hands access and notes to the new rep.
    assert.equal(await assignCustomer(created.id, b.id, false), "ok");
    assert.equal(await getCustomerForRep(a.id, created.id), null);
    assert.equal((await getCustomerForRep(b.id, created.id))?.repEarnsCommission, false);
    assert.equal((await listNotes(created.id)).length, 1);
  } finally {
    await cleanupReps(repIds, userIds);
  }
});

test("a customer sees their rep only while the rep is active; the profile keeps an address", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  try {
    const rep = await createRep({
      username: `rc-${suffix}`,
      name: "Rep C",
      phone: "0912 000 2222",
      email: "",
      commissionRateBp: 250,
      passwordHash: "x",
    });
    if (rep === "username-taken") throw new Error("username clash");
    repIds.push(rep.id);
    const created = await createUser({
      email: `${suffix}@example.invalid`,
      passwordHash: "x",
      company: "C",
      contactName: "N",
      phone: "",
      locale: "fa",
      origin: "referral",
      repId: rep.id,
    });
    if (created === "email-taken") throw new Error("unexpected");
    userIds.push(created.id);

    assert.deepEqual({ ...(await getRepContactForUser(created.id)) }, { name: "Rep C", phone: "0912 000 2222" });
    await sql`UPDATE sales_reps SET active = false WHERE id = ${rep.id}`;
    assert.equal(await getRepContactForUser(created.id), null);

    await updateProfile(created.id, {
      company: "C2",
      contactName: "N2",
      phone: "021",
      defaultPoNumber: "",
      locale: "fa",
      address: "خیابان ۱، پلاک ۲",
      city: "تهران",
    });
    const after = await getUserById(created.id);
    assert.equal(after?.address, "خیابان ۱، پلاک ۲");
    assert.equal(after?.city, "تهران");
  } finally {
    await cleanupReps(repIds, userIds);
  }
});

async function cartWithOneLine(tx: Tx): Promise<{ cartId: string; fingerprint: string }> {
  const suffix = randomUUID();
  const [category] = await tx<{ id: number }[]>`
    INSERT INTO categories (slug, path, name_en, name_fa)
    VALUES (${`rep-${suffix}`}, ${`rep-${suffix}`}, 'Rep test', 'آزمایش') RETURNING id`;
  const [family] = await tx<{ id: number }[]>`
    INSERT INTO product_families (slug, category_id, name_en, name_fa)
    VALUES (${`rep-family-${suffix}`}, ${category.id}, 'Rep family', 'خانواده') RETURNING id`;
  const [product] = await tx<{ id: number }[]>`
    INSERT INTO products (part_number, family_id, specs, price_cents,
                          inventory_available, inventory_on_hold, inventory_sold)
    VALUES (${`REP-${suffix}`}, ${family.id}, '{}'::jsonb, 1000, 100, 0, 0) RETURNING id`;
  const [cart] = await tx<{ id: string }[]>`INSERT INTO carts DEFAULT VALUES RETURNING id`;
  await tx`INSERT INTO cart_items (cart_id, product_id, qty) VALUES (${cart.id}, ${product.id}, 2)`;
  return {
    cartId: cart.id,
    fingerprint: quoteCartFingerprint([{ productId: product.id, qty: 2, unitPriceCents: 1000 }]),
  };
}

async function place(tx: Tx, userId: string | null, placedByRepId: string | null) {
  const { cartId, fingerprint } = await cartWithOneLine(tx);
  return submitOrderFromCartInTransaction(tx, {
    cartId,
    cartFingerprint: fingerprint,
    submissionKey: randomUUID(),
    locale: "en",
    currency: "USD",
    userId,
    placedByRepId,
    contact: { company: "C", contactName: "N", email: "", phone: "1", poNumber: "", address: "", city: "", country: "", notes: "" },
  });
}

async function stampOf(tx: Tx, ref: string) {
  const [row] = await tx<{ repId: string | null; rateBp: number | null; placedByRep: boolean }[]>`
    SELECT rep_id AS "repId", commission_rate_bp AS "rateBp", placed_by_rep AS "placedByRep"
    FROM orders WHERE ref = ${ref}`;
  return row;
}

function created(result: Awaited<ReturnType<typeof place>>): string {
  if (result.kind !== "created") throw new Error(`expected an order, got ${result.kind}`);
  return result.ref;
}

test("the customer's rep, rate and eligibility are locked onto an order when it is placed", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const rep = await insertRep(tx, { rateBp: 250 });
    const other = await insertRep(tx, { rateBp: 900 });
    const eligible = await insertCustomer(tx, { repId: rep, earns: true });
    const ineligible = await insertCustomer(tx, { repId: rep, earns: false });

    const own = created(await place(tx, eligible, null));
    assert.deepEqual(await stampOf(tx, own), { repId: rep, rateBp: 250, placedByRep: false });

    const noCommission = created(await place(tx, ineligible, null));
    assert.deepEqual(await stampOf(tx, noCommission), { repId: rep, rateBp: 0, placedByRep: false });

    const byRep = created(await place(tx, eligible, rep));
    assert.deepEqual(await stampOf(tx, byRep), { repId: rep, rateBp: 250, placedByRep: true });

    // Later changes cannot reach back into a placed order.
    await tx`UPDATE sales_reps SET commission_rate_bp = 900 WHERE id = ${rep}`;
    await tx`UPDATE users SET rep_id = ${other} WHERE id = ${eligible}`;
    assert.deepEqual(await stampOf(tx, own), { repId: rep, rateBp: 250, placedByRep: false });

    // The first rep may no longer order for a customer who is now someone else's.
    assert.deepEqual(await place(tx, eligible, rep), { kind: "customer-moved" });

    // A locked-out rep is credited with nothing.
    await tx`UPDATE sales_reps SET active = false WHERE id = ${other}`;
    const afterLockout = created(await place(tx, eligible, null));
    assert.deepEqual(await stampOf(tx, afterLockout), { repId: null, rateBp: null, placedByRep: false });

    const guest = created(await place(tx, null, null));
    assert.deepEqual(await stampOf(tx, guest), { repId: null, rateBp: null, placedByRep: false });
  });
});

test("a pay token opens its own order and nothing else", async () => {
  assertLocalDatabase();
  const [order] = await sql<{ id: number; payToken: string }[]>`
    INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Pay Co', 'N', '', 1000, 1000)
    RETURNING id, pay_token AS "payToken"`;
  try {
    assert.equal((await getOrderByPayToken(order.payToken))?.order.company, "Pay Co");
    assert.equal(await getOrderByPayToken("0".repeat(64)), null);
  } finally {
    await sql`DELETE FROM orders WHERE id = ${order.id}`;
  }
});

test("a rep sees their customers' orders and their own credit, and nothing else", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  const orderIds: number[] = [];
  try {
    const a = await createRep({ username: `oa-${suffix}`, name: "A", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    const b = await createRep({ username: `ob-${suffix}`, name: "B", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    if (a === "username-taken" || b === "username-taken") throw new Error("username clash");
    repIds.push(a.id, b.id);
    const [customer] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, customer_code, rep_id, origin, origin_rep_id, rep_earns_commission)
      VALUES (${`${suffix}@example.invalid`}, 'x', ${randomCustomerCode()}, ${a.id}, 'rep', ${a.id}, true)
      RETURNING id`;
    userIds.push(customer.id);
    const [order] = await sql<{ id: number; ref: string }[]>`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                          user_id, rep_id, commission_rate_bp, placed_by_rep)
      VALUES (${`ORD-${suffix.slice(0, 6).toUpperCase()}`}, 'Co', 'N', '', 1000, 1000,
              ${customer.id}, ${a.id}, 250, true)
      RETURNING id, ref`;
    orderIds.push(order.id);
    await sql`
      INSERT INTO order_items (order_id, product_id, part_number, family_name, qty,
                               unit_price_cents, requested_unit_price_cents)
      VALUES (${order.id}, NULL, 'GONE-1', 'F', 2, 500, 500)`;

    assert.equal((await listOrdersForRep(a.id, null)).some((o) => o.ref === order.ref), true);
    assert.equal((await listOrdersForRep(b.id, null)).some((o) => o.ref === order.ref), false);
    assert.equal(await getOrderForRep(b.id, order.ref), null);
    assert.equal(await getReorderLines(b.id, order.ref), null);

    const mine = await getOrderForRep(a.id, order.ref);
    assert.equal(mine?.order.creditedToMe, true);
    assert.equal(mine?.order.commissionRateBp, 250);
    assert.deepEqual(await getReorderLines(a.id, order.ref), {
      customerId: customer.id,
      lines: [],
      missing: ["GONE-1"],
    });

    // Moved to rep B: A keeps sight of the order it is credited with, but can
    // no longer reorder for the customer; B sees it without the credit.
    await sql`UPDATE users SET rep_id = ${b.id} WHERE id = ${customer.id}`;
    assert.equal((await getOrderForRep(a.id, order.ref))?.order.customerIsMine, false);
    assert.equal((await getReorderLines(a.id, order.ref))?.customerId, null);
    assert.equal((await getOrderForRep(b.id, order.ref))?.order.creditedToMe, false);
  } finally {
    if (orderIds.length) await sql`DELETE FROM orders WHERE id = ANY(${orderIds})`;
    await cleanupReps(repIds, userIds);
  }
});

test("reorder leaves out products the admin has since hidden from the catalog", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  let orderId: number | null = null;
  let categoryId: number | null = null;
  try {
    const rep = await createRep({ username: `oh-${suffix}`, name: "H", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    if (rep === "username-taken") throw new Error("username clash");
    repIds.push(rep.id);
    const [customer] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, customer_code, rep_id, origin, origin_rep_id, rep_earns_commission)
      VALUES (${`${suffix}-h@example.invalid`}, 'x', ${randomCustomerCode()}, ${rep.id}, 'rep', ${rep.id}, true)
      RETURNING id`;
    userIds.push(customer.id);
    const [category] = await sql<{ id: number }[]>`
      INSERT INTO categories (slug, path, name_en, name_fa)
      VALUES (${`hid-${suffix}`}, ${`hid-${suffix}`}, 'Hidden test', 'آزمایش') RETURNING id`;
    categoryId = category.id;
    const [visible] = await sql<{ id: number }[]>`
      INSERT INTO product_families (slug, category_id, name_en, name_fa)
      VALUES (${`vis-${suffix}`}, ${category.id}, 'Visible', 'دیده') RETURNING id`;
    const [hidden] = await sql<{ id: number }[]>`
      INSERT INTO product_families (slug, category_id, name_en, name_fa, is_visible)
      VALUES (${`hid-${suffix}`}, ${category.id}, 'Hidden', 'پنهان', false) RETURNING id`;
    const product = async (partNumber: string, familyId: number) => {
      const [row] = await sql<{ id: number }[]>`
        INSERT INTO products (part_number, family_id, specs, price_cents,
                              inventory_available, inventory_on_hold, inventory_sold)
        VALUES (${partNumber}, ${familyId}, '{}'::jsonb, 100, 100, 0, 0) RETURNING id`;
      return row.id;
    };
    const kept = await product(`KEEP-${suffix}`, visible.id);
    const gone = await product(`HIDE-${suffix}`, hidden.id);
    const [order] = await sql<{ id: number; ref: string }[]>`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                          user_id, rep_id, commission_rate_bp, placed_by_rep)
      VALUES (${`ORD-H${suffix.slice(0, 5).toUpperCase()}`}, 'Co', 'N', '', 200, 200,
              ${customer.id}, ${rep.id}, 250, true)
      RETURNING id, ref`;
    orderId = order.id;
    await sql`
      INSERT INTO order_items (order_id, product_id, part_number, family_name, qty,
                               unit_price_cents, requested_unit_price_cents)
      VALUES (${order.id}, ${kept}, ${`KEEP-${suffix}`}, 'Visible', 1, 100, 100),
             (${order.id}, ${gone}, ${`HIDE-${suffix}`}, 'Hidden', 1, 100, 100)`;

    // Quick order refuses hidden products; Reorder must not bring them back.
    assert.deepEqual(await getReorderLines(rep.id, order.ref), {
      customerId: customer.id,
      lines: [{ productId: kept, qty: 1 }],
      missing: [`HIDE-${suffix}`],
    });
  } finally {
    if (orderId !== null) await sql`DELETE FROM orders WHERE id = ${orderId}`;
    if (categoryId !== null) {
      await sql`DELETE FROM products WHERE family_id IN (SELECT id FROM product_families WHERE category_id = ${categoryId})`;
      await sql`DELETE FROM product_families WHERE category_id = ${categoryId}`;
      await sql`DELETE FROM categories WHERE id = ${categoryId}`;
    }
    await cleanupReps(repIds, userIds);
  }
});

async function insertDelivered(
  tx: Tx,
  repId: string,
  totalCents: number,
  fxRateToRial: number,
  rateBp: number,
  deliveredAt: string,
): Promise<void> {
  await tx`
    INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                        status, rep_id, commission_rate_bp, invoice_number, fx_rate_to_rial,
                        created_at, invoiced_at, paid_at, shipped_at, delivered_at)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Money Co', 'N', '',
            ${totalCents}, ${totalCents}, 'delivered', ${repId}, ${rateBp},
            ${`INV-TEST-${randomUUID().slice(0, 8)}`}, ${fxRateToRial},
            ${deliveredAt}::timestamptz - interval '9 days', ${deliveredAt}::timestamptz - interval '8 days',
            ${deliveredAt}::timestamptz - interval '6 days', ${deliveredAt}::timestamptz - interval '4 days',
            ${deliveredAt}::timestamptz)`;
}

test("one exact definition of sales and commission, and owed after payouts", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const rep = await insertRep(tx, { rateBp: 250 });
    await insertDelivered(tx, rep, 12345, 1050000, 250, "2026-09-10T10:00:00Z");
    // Cents × rate × basis points here is 1.35e19 — past 2^53, where
    // JavaScript arithmetic would already be wrong.
    await insertDelivered(tx, rep, 900000000, 1500000, 10000, "2026-09-11T10:00:00Z");

    const rows = await listDeliveredForRep(rep, tx);
    assert.deepEqual(rows.map((r) => [r.salesRial, r.commissionRial]), [
      [129_622_500, 3_240_563],
      [13_500_000_000_000, 13_500_000_000_000],
    ]);
    assert.ok(rows[0].deliveredAt instanceof Date);

    await addPayout(rep, 1_000_000, "Shahrivar", tx);
    assert.deepEqual((await listRepTotals(tx)).get(rep), {
      repId: rep,
      earnedRial: 3_240_563 + 13_500_000_000_000,
      paidRial: 1_000_000,
    });
    const [payout] = await listPayouts(rep, tx);
    assert.equal(await voidPayout(rep, payout.id, tx), true);
    assert.equal(await voidPayout(rep, payout.id, tx), false, "voided once only");
    assert.equal((await listRepTotals(tx)).get(rep)?.paidRial, 0);
    // The record stays, marked, and both steps are in the audit trail.
    const [kept] = await listPayouts(rep, tx);
    assert.equal(kept.id, payout.id);
    assert.ok(kept.voidedAt instanceof Date);
    const trail = await tx<{ action: string }[]>`
      SELECT action FROM audit_log WHERE subject_kind = 'payout' AND subject_id = ${String(payout.id)} ORDER BY id`;
    assert.deepEqual(trail.map((row) => row.action), ["payout.recorded", "payout.voided"]);

    await setTarget(rep, { year: 1405, month: 7 }, 500_000_000, tx);
    await setTarget(rep, { year: 1405, month: 7 }, 600_000_000, tx);
    assert.deepEqual(await listTargets(rep, tx), [{ year: 1405, month: 7, amountRial: 600_000_000 }]);
  });
});

test("an order not yet invoiced is estimated at today's rate", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const rep = await insertRep(tx, { rateBp: 500 });
    await tx`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                          status, rep_id, commission_rate_bp)
      VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Open Co', 'N', '', 10000, 10000,
              'received', ${rep}, 500)`;
    const [row] = await listInProgressForRep(rep, 1_000_000, tx);
    assert.equal(row.estimate, true);
    assert.equal(row.salesRial, 100_000_000);
    assert.equal(row.commissionRial, 5_000_000);
  });
});

test("no invoice is issued while a line is priced 0, by a rep or the admin", async () => {
  assertLocalDatabase();
  const [order] = await sql<{ id: number }[]>`
    INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Zero Co', 'Tester',
            'zero@example.invalid', 500, 500)
    RETURNING id
  `;
  try {
    const [priced, free] = await sql<{ id: number }[]>`
      INSERT INTO order_items (order_id, product_id, part_number, family_name, qty,
                               unit_price_cents, requested_unit_price_cents)
      VALUES (${order.id}, NULL, 'ZERO-1', 'Integration Family', 1, 500, 500),
             (${order.id}, NULL, 'ZERO-2', 'Integration Family', 3, 0, 0)
      RETURNING id
    `;
    const status = async () =>
      (await sql<{ status: string; invoice: string | null }[]>`
        SELECT status, invoice_number AS invoice FROM orders WHERE id = ${order.id}`)[0];

    // A rep invoices at the order's own prices, one of which is 0.
    assert.equal(await issueInvoice(order.id, { rate: 1_000_000, vatRateBp: 0 }), "unpriced");
    // The admin leaving that line at 0 is refused the same way, and the price
    // written on the way in is rolled back with it.
    assert.equal(
      await issueInvoice(order.id, {
        rate: 1_000_000,
        vatRateBp: 0,
        prices: [{ id: priced.id, cents: 700 }, { id: free.id, cents: 0 }],
      }),
      "unpriced",
    );
    assert.deepEqual(await status(), { status: "received", invoice: null });
    const [line] = await sql<{ cents: number }[]>`
      SELECT unit_price_cents AS cents FROM order_items WHERE id = ${priced.id}`;
    assert.equal(line.cents, 500);

    // Priced by the admin, it issues.
    assert.equal(
      await issueInvoice(order.id, {
        rate: 1_000_000,
        vatRateBp: 0,
        prices: [{ id: priced.id, cents: 500 }, { id: free.id, cents: 250 }],
      }),
      "issued",
    );
    assert.equal((await status()).status, "invoiced");
  } finally {
    await sql`DELETE FROM orders WHERE id = ${order.id}`;
  }
});

test("a rep cannot move an order to preparing: no rep code reaches confirmPayment", () => {
  // Confirming payment is the admin's alone (review finding C-2). The query
  // takes no rep, so the only way a rep could reach it is by code under the
  // rep routes calling it — which this refuses.
  assert.equal(confirmPayment.length, 2);
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? files(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
    });
  const repCode = [
    ...files(join(process.cwd(), "src", "app", "[locale]", "rep")),
    join(process.cwd(), "src", "db", "repOrderQueries.ts"),
    join(process.cwd(), "src", "db", "customerQueries.ts"),
  ];
  for (const file of repCode) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/confirmPayment|'preparing'|paid_at\s*=/.test(source), `${file} can confirm a payment`);
  }
});

test("a rep resets only a customer they created who has never chosen a password", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  try {
    const a = await createRep({ username: `ra-${suffix}`, name: "A", phone: "", email: "", commissionRateBp: 0, passwordHash: "x" });
    const b = await createRep({ username: `rb-${suffix}`, name: "B", phone: "", email: "", commissionRateBp: 0, passwordHash: "x" });
    if (a === "username-taken" || b === "username-taken") throw new Error("username clash");
    repIds.push(a.id, b.id);
    const input = { contactName: "N", email: null, address: "", city: "" };

    // Created by rep A, never signed in: A may reset it.
    const own = await createCustomerForRep(a.id, {
      ...input, company: `Own ${suffix}`, phone: randomPhone(), codeChoice: "random", passwordHash: "x", locale: "fa",
    });
    if (own.kind !== "created") throw new Error(own.kind);
    userIds.push(own.id);
    assert.ok(await resetCustomerPasswordForRep(a.id, own.id, "temp-1"));

    // Once the customer chooses their own, only the admin can reset it.
    await setPassword(own.id, "their-own", false);
    assert.equal(await resetCustomerPasswordForRep(a.id, own.id, "temp-2"), null);

    // A self sign-up assigned to rep A: never A's to reset.
    const self = await createUser({
      email: `${randomUUID()}@example.invalid`, passwordHash: "x", company: `Self ${suffix}`,
      contactName: "N", phone: "12", locale: "en", origin: "self", repId: null,
    });
    if (self === "email-taken") throw new Error("unexpected");
    userIds.push(self.id);
    assert.equal(await assignCustomer(self.id, a.id, false), "ok");
    assert.equal(await resetCustomerPasswordForRep(a.id, self.id, "temp-3"), null);

    // Created by rep B, then moved to rep A before signing in: not A's either.
    const moved = await createCustomerForRep(b.id, {
      ...input, company: `Moved ${suffix}`, phone: randomPhone(), codeChoice: "random", passwordHash: "x", locale: "fa",
    });
    if (moved.kind !== "created") throw new Error(moved.kind);
    userIds.push(moved.id);
    assert.equal(await assignCustomer(moved.id, a.id, false), "ok");
    assert.equal(await resetCustomerPasswordForRep(a.id, moved.id, "temp-4"), null);

    // Nothing refused changed a password.
    const hashes = await sql<{ id: string; hash: string }[]>`
      SELECT id, password_hash AS hash FROM users WHERE id = ANY(${[own.id, self.id, moved.id]})`;
    assert.deepEqual(
      Object.fromEntries(hashes.map((row) => [row.id, row.hash])),
      { [own.id]: "their-own", [self.id]: "x", [moved.id]: "x" },
    );
  } finally {
    await cleanupReps(repIds, userIds);
  }
});

test("the previous release's writes still succeed against the migrated schema", async () => {
  // Review finding H-10. The live site's code (before the sales-rep release)
  // runs against this schema from the moment the migration is applied until
  // the new deployment is live, and again after any rollback. These are its
  // exact insert shapes.
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const phone = `0912 ${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
    const [user] = await tx<{ code: string; origin: string; chose: boolean }[]>`
      INSERT INTO users (email, password_hash, company, contact_name, phone, locale)
      VALUES (${`${randomUUID()}@example.invalid`}, 'x', 'Old Co', 'N', ${phone}, 'fa')
      RETURNING customer_code AS code, origin, chose_own_password AS chose
    `;
    assert.match(user.code, /^[0-9]{7}$/);
    assert.equal(user.origin, "self");
    assert.equal(user.chose, true);

    // A second old-style sign-up with the same phone gets a different code.
    const [second] = await tx<{ code: string }[]>`
      INSERT INTO users (email, password_hash, company, contact_name, phone, locale)
      VALUES (${`${randomUUID()}@example.invalid`}, 'x', 'Old Co 2', 'N', ${phone}, 'fa')
      RETURNING customer_code AS code
    `;
    assert.notEqual(second.code, user.code);

    // The old checkout's order insert: no rep columns, no pay token.
    const [order] = await tx<{ token: string; placedByRep: boolean }[]>`
      INSERT INTO orders (ref, company, contact_name, email, phone, po_number, address,
                          city, country, notes, locale, currency, total_cents,
                          requested_total_cents)
      VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Old Co', 'N',
              'old@example.invalid', '', '', '', '', '', '', 'fa', 'IRR', 100, 100)
      RETURNING pay_token AS token, placed_by_rep AS "placedByRep"
    `;
    assert.match(order.token, /^[0-9a-f]{64}$/);
    assert.equal(order.placedByRep, false);
  });
});

test("every password change or reset ends the account's other sessions", async () => {
  // Review M-2: the session cookie carries users.session_version.
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  try {
    const rep = await createRep({ username: `sv-${suffix}`, name: "S", phone: "", email: "", commissionRateBp: 0, passwordHash: "x" });
    if (rep === "username-taken") throw new Error("username clash");
    repIds.push(rep.id);
    const created = await createCustomerForRep(rep.id, {
      company: `SV ${suffix}`, contactName: "N", phone: randomPhone(), email: null, address: "", city: "",
      codeChoice: "random", passwordHash: "x", locale: "fa",
    });
    if (created.kind !== "created") throw new Error(created.kind);
    userIds.push(created.id);
    const { getSessionVersion } = await import("./userQueries");
    const { resetCustomerPasswordAdmin } = await import("./customerQueries");

    const start = await getSessionVersion(created.id);
    assert.equal(start, 1);
    assert.ok(await resetCustomerPasswordForRep(rep.id, created.id, "temp"));
    assert.equal(await getSessionVersion(created.id), 2);
    await setPassword(created.id, "own", false);
    assert.equal(await getSessionVersion(created.id), 3);
    assert.ok(await resetCustomerPasswordAdmin(created.id, "admin-temp"));
    assert.equal(await getSessionVersion(created.id), 4);
  } finally {
    await cleanupReps(repIds, userIds);
  }
});

test("checkout orders nothing that has been hidden since it was put in the cart", async () => {
  // Review M-3: /api/cart added any product id; addLine now refuses hidden
  // ones, and a product hidden after it was added drops out at checkout.
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const { cartId } = await cartWithOneLine(tx);
    const [visible] = await tx<{ productId: number }[]>`
      SELECT product_id AS "productId" FROM cart_items WHERE cart_id = ${cartId}`;
    const [family] = await tx<{ id: number; categoryId: number }[]>`
      SELECT f.id, f.category_id AS "categoryId" FROM products p
      JOIN product_families f ON f.id = p.family_id WHERE p.id = ${visible.productId}`;
    const [hiddenFamily] = await tx<{ id: number }[]>`
      INSERT INTO product_families (slug, category_id, name_en, name_fa, is_visible)
      VALUES (${`hidden-${randomUUID()}`}, ${family.categoryId}, 'Hidden', 'پنهان', false) RETURNING id`;
    const [hidden] = await tx<{ id: number }[]>`
      INSERT INTO products (part_number, family_id, specs, price_cents,
                            inventory_available, inventory_on_hold, inventory_sold)
      VALUES (${`HID-${randomUUID()}`}, ${hiddenFamily.id}, '{}'::jsonb, 1, 100, 0, 0) RETURNING id`;
    await tx`INSERT INTO cart_items (cart_id, product_id, qty) VALUES (${cartId}, ${hidden.id}, 5)`;

    const result = await submitOrderFromCartInTransaction(tx, {
      cartId,
      cartFingerprint: quoteCartFingerprint([{ productId: visible.productId, qty: 2, unitPriceCents: 1000 }]),
      submissionKey: randomUUID(),
      locale: "en",
      currency: "USD",
      userId: null,
      placedByRepId: null,
      contact: { company: "C", contactName: "N", email: "", phone: "1", poNumber: "", address: "", city: "", country: "", notes: "" },
    });
    const ref = created(result);
    const lines = await tx<{ productId: number }[]>`
      SELECT i.product_id AS "productId" FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.ref = ${ref}`;
    assert.deepEqual(lines.map((line) => line.productId), [visible.productId]);
  });
});

test("totals past what the database stores are refused, not a 500", async () => {
  // Review M-9: 99,999 of a $500 product overflowed a 32-bit total.
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const { cartId } = await cartWithOneLine(tx);
    const [line] = await tx<{ productId: number }[]>`
      SELECT product_id AS "productId" FROM cart_items WHERE cart_id = ${cartId}`;
    await tx`UPDATE products SET price_cents = 50000 WHERE id = ${line.productId}`;
    await tx`UPDATE cart_items SET qty = 99999 WHERE cart_id = ${cartId}`;
    const result = await submitOrderFromCartInTransaction(tx, {
      cartId,
      cartFingerprint: quoteCartFingerprint([{ productId: line.productId, qty: 99999, unitPriceCents: 50000 }]),
      submissionKey: randomUUID(),
      locale: "en",
      currency: "USD",
      userId: null,
      placedByRepId: null,
      contact: { company: "C", contactName: "N", email: "", phone: "1", poNumber: "", address: "", city: "", country: "", notes: "" },
    });
    assert.deepEqual(result, { kind: "too-large" });
  });

  const [order] = await sql<{ id: number }[]>`
    INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Big Co', 'T', 'big@example.invalid', 1, 1)
    RETURNING id`;
  try {
    const [item] = await sql<{ id: number }[]>`
      INSERT INTO order_items (order_id, product_id, part_number, family_name, qty,
                               unit_price_cents, requested_unit_price_cents)
      VALUES (${order.id}, NULL, 'BIG-1', 'Integration Family', 99999, 1, 1) RETURNING id`;
    // The admin types a price that makes the invoice overflow.
    assert.equal(
      await issueInvoice(order.id, { rate: 1_000_000, vatRateBp: 0, prices: [{ id: item.id, cents: 50_000 }] }),
      "too-large",
    );
    const [row] = await sql<{ status: string }[]>`SELECT status FROM orders WHERE id = ${order.id}`;
    assert.equal(row.status, "received");
  } finally {
    await sql`DELETE FROM orders WHERE id = ${order.id}`;
  }
});

test("money and state changes leave an audit record in the same transaction", async () => {
  // Review M-11.
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const [rep] = await sql<{ id: string }[]>`
    INSERT INTO sales_reps (username, password_hash, name, referral_code)
    VALUES (${`audit-${suffix}`}, 'x', 'Audit Rep', ${randomReferralCode()}) RETURNING id`;
  const [order] = await sql<{ id: number }[]>`
    INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Audit Co', 'T', 'a@example.invalid', 100, 100)
    RETURNING id`;
  try {
    await sql`
      INSERT INTO order_items (order_id, product_id, part_number, family_name, qty,
                               unit_price_cents, requested_unit_price_cents)
      VALUES (${order.id}, NULL, 'AUD-1', 'Integration Family', 1, 100, 100)`;
    assert.equal(await issueInvoice(order.id, { rate: 1_000_000, vatRateBp: 0, actor: { kind: "rep", id: rep.id } }), "issued");
    assert.equal(await confirmPayment(order.id, "invoiced"), true);
    // A refused change leaves no record.
    assert.equal(await confirmPayment(order.id, "invoiced"), false);
    const trail = await sql<{ action: string; actorKind: string; actorId: string | null }[]>`
      SELECT action, actor_kind AS "actorKind", actor_id AS "actorId" FROM audit_log
      WHERE subject_kind = 'order' AND subject_id = ${String(order.id)} ORDER BY id`;
    assert.deepEqual([...trail], [
      { action: "invoice.issued", actorKind: "rep", actorId: rep.id },
      { action: "payment.confirmed", actorKind: "admin", actorId: null },
    ]);
  } finally {
    await sql`DELETE FROM audit_log WHERE subject_kind = 'order' AND subject_id = ${String(order.id)}`;
    await sql`DELETE FROM orders WHERE id = ${order.id}`;
    await sql`DELETE FROM sales_reps WHERE id = ${rep.id}`;
  }
});

test("rep lists report their full size, so a cut-off list can say so", async () => {
  // Review M-15: lists stopped at 300/500 rows with no sign.
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  try {
    const rep = await createRep({ username: `lt-${suffix}`, name: "L", phone: "", email: "", commissionRateBp: 0, passwordHash: "x" });
    if (rep === "username-taken") throw new Error("username clash");
    repIds.push(rep.id);
    for (let i = 0; i < 3; i++) {
      const created = await createCustomerForRep(rep.id, {
        company: `LT ${suffix} ${i}`, contactName: "N", phone: randomPhone(), email: null, address: "", city: "",
        codeChoice: "random", passwordHash: "x", locale: "fa",
      });
      if (created.kind !== "created") throw new Error(created.kind);
      userIds.push(created.id);
    }
    const rows = await listCustomersForRep(rep.id, "");
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.totalCount), [3, 3, 3]);
    assert.deepEqual([...(await listOrdersForRep(rep.id, null))], []);
  } finally {
    await cleanupReps(repIds, userIds);
  }
});

test("a moved customer's older orders are visible to the new rep but not theirs to act on", async () => {
  // Review M-17: no pay link, no invoicing, no receipts on another rep's sale.
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  let orderId: number | undefined;
  try {
    const oldRep = await createRep({ username: `mo-${suffix}`, name: "Old", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    const newRep = await createRep({ username: `mn-${suffix}`, name: "New", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    if (oldRep === "username-taken" || newRep === "username-taken") throw new Error("username clash");
    repIds.push(oldRep.id, newRep.id);
    const customer = await createCustomerForRep(oldRep.id, {
      company: `Moved ${suffix}`, contactName: "N", phone: randomPhone(), email: null, address: "", city: "",
      codeChoice: "random", passwordHash: "x", locale: "fa",
    });
    if (customer.kind !== "created") throw new Error(customer.kind);
    userIds.push(customer.id);
    const [order] = await sql<{ id: number; ref: string }[]>`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                          user_id, rep_id, commission_rate_bp)
      VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Moved Co', 'N', '', 100, 100,
              ${customer.id}, ${oldRep.id}, 250)
      RETURNING id, ref`;
    orderId = order.id;
    assert.equal(await assignCustomer(customer.id, newRep.id, true), "ok");

    const seen = await getOrderForRep(newRep.id, order.ref);
    assert.ok(seen, "the new rep still sees the order");
    assert.equal(seen.order.payToken, null);
    assert.equal(seen.order.creditedToMe, false);
    assert.equal(await repCanActOnOrder(newRep.id, order.ref), false);
    assert.equal((await listOrdersForRep(newRep.id, null)).find((o) => o.ref === order.ref)?.payToken, null);

    assert.equal(await repCanActOnOrder(oldRep.id, order.ref), true);
    assert.match((await getOrderForRep(oldRep.id, order.ref))?.order.payToken ?? "", /^[0-9a-f]{64}$/);
  } finally {
    if (orderId !== undefined) await sql`DELETE FROM orders WHERE id = ${orderId}`;
    await cleanupReps(repIds, userIds);
  }
});
