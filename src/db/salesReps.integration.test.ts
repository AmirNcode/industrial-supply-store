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
import { submitOrderFromCartInTransaction } from "./orderSubmissionQueries";
import { quoteCartFingerprint } from "@/lib/quoteSubmission";
import { getOrderByPayToken } from "./accountQueries";

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
