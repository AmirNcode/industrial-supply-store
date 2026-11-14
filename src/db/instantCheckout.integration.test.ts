import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "./index";
import { submitOrderFromCart, type QuoteContact, type SubmitOrderResult } from "./orderSubmissionQueries";
import { issuePishFactor, sendQuote } from "./invoiceQueries";
import { addPaymentProof, confirmPayment } from "./paymentProofQueries";
import { sweepExpiredOrders } from "./expiryQueries";
import { cancelOrderByCustomer } from "./customerCancelQueries";
import { findShortfalls } from "./inventoryQueries";
import { issueLoginCode, redeemLoginCode } from "./loginCodeQueries";
import {
  MAX_ADDRESSES,
  addAddress,
  deleteAddress,
  getAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
  type AddressInput,
} from "./addressQueries";
import { createUser, requireNewPassword } from "./userQueries";
import { addStaffEmail, getStaffEmails, removeStaffEmail } from "@/lib/staffEmails";
import { inspectDatabaseIntegrity, reconcileInventoryForProducts } from "./dataIntegrity";
import { LOGIN_CODE_MAX_ATTEMPTS } from "@/lib/loginCode";
import { splitCart } from "@/lib/checkoutSplit";
import { quoteCartFingerprint } from "@/lib/quoteSubmission";
import { persianYearMonth } from "@/lib/persianCalendar";

function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for the database integration test");
  const { hostname } = new URL(raw);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`Refusing to run instant-checkout integration tests against non-local host: ${hostname}`);
  }
}

after(async () => {
  await sql.end({ timeout: 5 });
});

const TERMS = { rate: 1_000_000, vatRateBp: 1000 };
const HOUR = 3600;
const DAY = 24 * HOUR;

type ProductSpec = { priceCents: number; available: number; inStock?: boolean };

/** A throwaway category, family and products; `cleanup` removes everything this test made. */
async function fixture(specs: ProductSpec[]) {
  const suffix = randomUUID();
  const marker = `instant-${suffix}`;
  const [category] = await sql<{ id: number }[]>`
    INSERT INTO categories (slug, path, name_en, name_fa)
    VALUES (${marker}, ${marker}, 'Instant', 'آزمایش') RETURNING id`;
  const [family] = await sql<{ id: number }[]>`
    INSERT INTO product_families (slug, category_id, name_en, name_fa)
    VALUES (${`${marker}-f`}, ${category.id}, 'Instant Family', 'خانواده') RETURNING id`;
  const products: { id: number; priceCents: number }[] = [];
  for (const [index, spec] of specs.entries()) {
    const [product] = await sql<{ id: number }[]>`
      INSERT INTO products (part_number, family_id, specs, price_cents, in_stock,
                            inventory_available, inventory_on_hold, inventory_sold)
      VALUES (${`IC-${index}-${suffix}`}, ${family.id}, '{}'::jsonb, ${spec.priceCents},
              ${spec.inStock ?? true}, ${spec.available}, 0, 0)
      RETURNING id`;
    products.push({ id: product.id, priceCents: spec.priceCents });
  }
  const cartIds: string[] = [];
  const userIds: string[] = [];

  const contact = (): QuoteContact => ({
    company: "Instant Co",
    contactName: "Buyer",
    email: "",
    phone: "555-0100",
    poNumber: "",
    address: "1 Test Street",
    city: "Tehran",
    country: "",
    notes: marker,
    postalCode: "",
    nationalId: "",
    economicCode: "",
  });

  /** A cart of `lines` (by index into `products`). */
  async function cart(lines: { product: number; qty: number }[]): Promise<string> {
    const [row] = await sql<{ id: string }[]>`INSERT INTO carts DEFAULT VALUES RETURNING id`;
    cartIds.push(row.id);
    for (const line of lines) {
      await sql`INSERT INTO cart_items (cart_id, product_id, qty)
                VALUES (${row.id}, ${products[line.product].id}, ${line.qty})`;
    }
    return row.id;
  }

  /** The fingerprint the checkout page signs when the shelf holds `shelf[i]` of product i. */
  function fingerprint(lines: { product: number; qty: number }[], shelf: number[], inStock: boolean[] = []) {
    return quoteCartFingerprint(
      splitCart(
        lines.map((line) => ({
          productId: products[line.product].id,
          qty: line.qty,
          unitPriceCents: products[line.product].priceCents,
          inStock: inStock[line.product] ?? specs[line.product].inStock ?? true,
          available: shelf[line.product],
        })),
      ).lines,
    );
  }

  async function submit(
    lines: { product: number; qty: number }[],
    options: {
      mode?: "split" | "together";
      terms?: typeof TERMS | null;
      shelf?: number[];
      cartId?: string;
      submissionKey?: string;
      fingerprint?: string;
    } = {},
  ): Promise<SubmitOrderResult> {
    const cartId = options.cartId ?? (await cart(lines));
    return submitOrderFromCart({
      cartId,
      cartFingerprint: options.fingerprint ?? fingerprint(lines, options.shelf ?? specs.map((s) => s.available)),
      submissionKey: options.submissionKey ?? randomUUID(),
      locale: "en",
      currency: "USD",
      userId: null,
      placedByRepId: null,
      contact: contact(),
      mode: options.mode ?? "split",
      pishFactor: options.terms === undefined ? TERMS : options.terms,
    });
  }

  async function stock(index: number) {
    const [row] = await sql<{ available: number; onHold: number; sold: number }[]>`
      SELECT inventory_available AS available, inventory_on_hold AS "onHold", inventory_sold AS sold
      FROM products WHERE id = ${products[index].id}`;
    return row;
  }

  async function order(ref: string) {
    const [row] = await sql<
      {
        id: number;
        status: string;
        invoiceNumber: string | null;
        rate: number | null;
        vatRateBp: number | null;
        groupId: string | null;
        invoicedAt: string | null;
        quotedAt: string | null;
        expiredAt: string | null;
        expiresIn: number | null;
      }[]
    >`
      SELECT id, status, invoice_number AS "invoiceNumber", fx_rate_to_rial AS rate,
             vat_rate_bp AS "vatRateBp", group_id AS "groupId", invoiced_at AS "invoicedAt",
             quoted_at AS "quotedAt", expired_at AS "expiredAt",
             extract(epoch FROM expires_at - now())::float AS "expiresIn"
      FROM orders WHERE ref = ${ref}`;
    return row;
  }

  async function lines(orderId: number) {
    return sql<{ productId: number; qty: number; backorder: boolean; cents: number }[]>`
      SELECT product_id AS "productId", qty, backorder, unit_price_cents AS cents
      FROM order_items WHERE order_id = ${orderId} ORDER BY backorder, id`;
  }

  /** The inventory ledger agrees with the orders: reconciling changes nothing. */
  async function assertLedger(): Promise<void> {
    const ids = products.map((p) => p.id);
    const changed = await sql.begin((tx) => reconcileInventoryForProducts(tx, ids));
    assert.equal(changed, 0, "on_hold/sold must equal the non-back-order lines of held/paid orders");
  }

  async function cleanup(): Promise<void> {
    await sql.begin(async (tx) => {
      const orders = await tx<{ id: number }[]>`SELECT id FROM orders WHERE notes = ${marker}`;
      const ids = orders.map((o) => String(o.id));
      if (ids.length) {
        await tx`DELETE FROM audit_log WHERE subject_kind = 'order' AND subject_id = ANY(${ids}::text[])`;
        await tx`DELETE FROM orders WHERE notes = ${marker}`;
      }
      if (cartIds.length) await tx`DELETE FROM carts WHERE id = ANY(${cartIds}::uuid[])`;
      if (userIds.length) await tx`DELETE FROM users WHERE id = ANY(${userIds}::uuid[])`;
      await tx`DELETE FROM categories WHERE id = ${category.id}`;
    });
  }

  return { marker, products, userIds, cart, fingerprint, submit, stock, order, lines, assertLedger, cleanup };
}

function created(result: SubmitOrderResult) {
  assert.ok(result.kind === "created" || result.kind === "replayed", `expected an order, got ${result.kind}`);
  return result;
}

function near(actual: number | null, expected: number, tolerance = 300): void {
  assert.ok(actual !== null && Math.abs(actual - expected) < tolerance, `${actual} is not within ${tolerance}s of ${expected}`);
}

test("instant cart: one pish-factor order, no number, rate and VAT locked, stock held", async () => {
  assertLocalDatabase();
  const fx = await fixture([{ priceCents: 100, available: 10 }, { priceCents: 250, available: 5 }]);
  try {
    const result = created(await fx.submit([{ product: 0, qty: 4 }, { product: 1, qty: 2 }]));
    assert.equal(result.kind, "created");
    assert.equal(result.orders.length, 1);
    assert.equal(result.orders[0].issued, true);
    const order = await fx.order(result.ref);
    assert.equal(order.status, "invoiced");
    assert.equal(order.invoiceNumber, null);
    assert.equal(order.rate, TERMS.rate);
    assert.equal(order.vatRateBp, TERMS.vatRateBp);
    assert.equal(order.groupId, null);
    assert.ok(order.invoicedAt);
    near(order.expiresIn, DAY);
    assert.deepEqual(await fx.stock(0), { available: 6, onHold: 4, sold: 0 });
    assert.deepEqual(await fx.stock(1), { available: 3, onHold: 2, sold: 0 });
    assert.ok((await fx.lines(order.id)).every((l) => !l.backorder));
    await fx.assertLedger();
  } finally {
    await fx.cleanup();
  }
});

test("over the shelf, split: a pish-factor for what is there and a back order for the rest", async () => {
  assertLocalDatabase();
  const fx = await fixture([{ priceCents: 100, available: 3 }]);
  try {
    const key = randomUUID();
    const result = created(await fx.submit([{ product: 0, qty: 50 }], { mode: "split", submissionKey: key }));
    assert.equal(result.kind, "created");
    assert.equal(result.orders.length, 2);

    const [first, second] = result.orders;
    assert.equal(result.ref, first.ref, "the customer lands on the pish-factor");
    const pish = await fx.order(first.ref);
    const rest = await fx.order(second.ref);
    assert.equal(pish.status, "invoiced");
    assert.equal(rest.status, "received");
    assert.ok(pish.groupId);
    assert.equal(pish.groupId, rest.groupId);
    near(pish.expiresIn, DAY);
    near(rest.expiresIn, 5 * DAY);
    assert.deepEqual(
      (await fx.lines(pish.id)).map((l) => [l.qty, l.backorder]),
      [[3, false]],
    );
    assert.deepEqual(
      (await fx.lines(rest.id)).map((l) => [l.qty, l.backorder]),
      [[47, true]],
    );
    assert.deepEqual(await fx.stock(0), { available: 0, onHold: 3, sold: 0 });
    await fx.assertLedger();

    // The same submission again finds both orders and writes nothing.
    const replay = created(await fx.submit([{ product: 0, qty: 50 }], { mode: "split", submissionKey: key }));
    assert.equal(replay.kind, "replayed");
    assert.deepEqual(replay.orders.map((o) => o.ref), [first.ref, second.ref]);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders WHERE notes = ${fx.marker}`;
    assert.equal(n, 2);
    assert.deepEqual(await fx.stock(0), { available: 0, onHold: 3, sold: 0 });
    await fx.assertLedger();
  } finally {
    await fx.cleanup();
  }
});

test("over the shelf, together: one order that waits, 3 held and 47 on back order", async () => {
  assertLocalDatabase();
  const fx = await fixture([{ priceCents: 100, available: 3 }]);
  try {
    const result = created(await fx.submit([{ product: 0, qty: 50 }], { mode: "together" }));
    assert.equal(result.orders.length, 1);
    const order = await fx.order(result.ref);
    assert.equal(order.status, "received");
    assert.equal(order.invoicedAt, null);
    assert.equal(order.rate, null);
    assert.equal(order.groupId, null);
    near(order.expiresIn, 5 * DAY);
    assert.deepEqual(
      (await fx.lines(order.id)).map((l) => [l.qty, l.backorder]),
      [[3, false], [47, true]],
    );
    assert.deepEqual(await fx.stock(0), { available: 0, onHold: 3, sold: 0 });
    await fx.assertLedger();
  } finally {
    await fx.cleanup();
  }
});

test("an unpriced product on the shelf is held for a quote, never given a pish-factor", async () => {
  assertLocalDatabase();
  const fx = await fixture([{ priceCents: 0, available: 10 }]);
  try {
    const result = created(await fx.submit([{ product: 0, qty: 2 }], { terms: TERMS }));
    assert.equal(result.orders.length, 1);
    const order = await fx.order(result.ref);
    assert.equal(order.status, "received");
    assert.equal(order.invoicedAt, null);
    assert.equal(order.rate, null);
    assert.deepEqual(
      (await fx.lines(order.id)).map((l) => [l.qty, l.backorder, l.cents]),
      [[2, false, 0]],
    );
    assert.deepEqual(await fx.stock(0), { available: 8, onHold: 2, sold: 0 });
    await fx.assertLedger();
  } finally {
    await fx.cleanup();
  }
});

test("a product not kept on the shelf is all back order and holds nothing", async () => {
  assertLocalDatabase();
  const fx = await fixture([{ priceCents: 100, available: 500, inStock: false }]);
  try {
    const result = created(await fx.submit([{ product: 0, qty: 5 }]));
    assert.equal(result.orders.length, 1);
    const order = await fx.order(result.ref);
    assert.equal(order.status, "received");
    assert.deepEqual(
      (await fx.lines(order.id)).map((l) => [l.qty, l.backorder]),
      [[5, true]],
    );
    assert.deepEqual(await fx.stock(0), { available: 500, onHold: 0, sold: 0 });
    // Back-order lines are not "held": the queue has no shortfall to flag.
    assert.equal((await findShortfalls([order.id])).size, 0);
    await fx.assertLedger();
  } finally {
    await fx.cleanup();
  }
});

test("first to finish wins the last unit; the other cart is sent back", async () => {
  assertLocalDatabase();
  const fx = await fixture([{ priceCents: 100, available: 1 }]);
  try {
    const lines = [{ product: 0, qty: 1 }];
    // Both pages were drawn while the unit was available.
    const drawn = fx.fingerprint(lines, [1]);
    const [cartA, cartB] = [await fx.cart(lines), await fx.cart(lines)];
    const results = await Promise.all([
      fx.submit(lines, { cartId: cartA, fingerprint: drawn }),
      fx.submit(lines, { cartId: cartB, fingerprint: drawn }),
    ]);
    assert.deepEqual(results.map((r) => r.kind).sort(), ["cart-changed", "created"]);
    const winner = created(results.find((r) => r.kind === "created")!);
    assert.equal(winner.orders[0].issued, true);
    assert.equal((await fx.order(winner.ref)).status, "invoiced");
    assert.deepEqual(await fx.stock(0), { available: 0, onHold: 1, sold: 0 });
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders WHERE notes = ${fx.marker}`;
    assert.equal(n, 1);
    await fx.assertLedger();
  } finally {
    await fx.cleanup();
  }
});

test("a stock promise that went stale before submit is refused and writes nothing", async () => {
  assertLocalDatabase();
  const fx = await fixture([{ priceCents: 100, available: 5 }]);
  try {
    const lines = [{ product: 0, qty: 4 }];
    const drawn = fx.fingerprint(lines, [5]);
    const cartId = await fx.cart(lines);
    await sql`UPDATE products SET inventory_available = 2 WHERE id = ${fx.products[0].id}`;
    const result = await fx.submit(lines, { cartId, fingerprint: drawn });
    assert.deepEqual(result, { kind: "cart-changed" });
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders WHERE notes = ${fx.marker}`;
    assert.equal(n, 0);
    assert.deepEqual(await fx.stock(0), { available: 2, onHold: 0, sold: 0 });
    const [{ items }] = await sql<{ items: number }[]>`SELECT count(*)::int AS items FROM cart_items WHERE cart_id = ${cartId}`;
    assert.equal(items, 1, "the cart is kept so the customer can see the new split");
  } finally {
    await fx.cleanup();
  }
});

test("expiry sweep: invoiced and quoted cancel, a receipt protects, received lets go of its hold", async () => {
  assertLocalDatabase();
  const fx = await fixture([
    { priceCents: 100, available: 10 }, // 0: invoiced, lapses
    { priceCents: 100, available: 10 }, // 1: invoiced, receipt uploaded
    { priceCents: 0, available: 10 }, //   2: received, deadline passes
    { priceCents: 0, available: 10 }, //   3: quoted, deadline passes
  ]);
  const backdate = (id: number) =>
    sql`UPDATE orders SET expires_at = now() - interval '1 hour' WHERE id = ${id}`;
  try {
    const a = created(await fx.submit([{ product: 0, qty: 4 }]));
    const b = created(await fx.submit([{ product: 1, qty: 4 }]));
    const c = created(await fx.submit([{ product: 2, qty: 4 }]));
    const d = created(await fx.submit([{ product: 3, qty: 4 }]));
    const [aId, bId, cId, dId] = [a, b, c, d].map((r) => r.orders[0].id);

    // (b) The customer uploads the receipt inside the deadline.
    assert.equal(
      await addPaymentProof(bId, { path: `test/${fx.marker}/1.jpg`, type: "image/jpeg", size: 10 }, { kind: "customer" }),
      "added",
    );
    // (d) Staff quote it.
    const [line] = await fx.lines(dId);
    const [item] = await sql<{ id: number }[]>`SELECT id FROM order_items WHERE order_id = ${dId}`;
    assert.equal(line.cents, 0);
    assert.equal(await sendQuote(dId, { prices: [{ id: item.id, cents: 100 }] }), "issued");
    assert.equal((await fx.order(d.ref)).status, "quoted");

    for (const id of [aId, cId, dId]) await backdate(id);
    // Nothing else can be backdated: a payment_review order carries no deadline.
    await assert.rejects(backdate(bId), { code: "23514" });

    const swept = await sweepExpiredOrders({ force: true });
    const mine = swept.cancelled.filter((o) => [aId, dId].includes(o.id));
    assert.deepEqual(
      mine.map((o) => [o.id, o.was]).sort(),
      [[aId, "invoiced"], [dId, "quoted"]].sort(),
    );

    // (a) invoiced → cancelled, stock back on the shelf.
    const oa = await fx.order(a.ref);
    assert.equal(oa.status, "cancelled");
    assert.ok(oa.expiredAt);
    assert.equal(oa.expiresIn, null);
    assert.deepEqual(await fx.stock(0), { available: 10, onHold: 0, sold: 0 });

    // (b) the receipt cleared the deadline: untouched.
    const ob = await fx.order(b.ref);
    assert.equal(ob.status, "payment_review");
    assert.equal(ob.expiresIn, null);
    assert.equal(ob.expiredAt, null);
    assert.deepEqual(await fx.stock(1), { available: 6, onHold: 4, sold: 0 });

    // (c) received → still open, lines now back order, stock released.
    const oc = await fx.order(c.ref);
    assert.equal(oc.status, "received");
    assert.equal(oc.expiresIn, null);
    assert.equal(oc.expiredAt, null);
    assert.deepEqual(
      (await fx.lines(cId)).map((l) => [l.qty, l.backorder]),
      [[4, true]],
    );
    assert.deepEqual(await fx.stock(2), { available: 10, onHold: 0, sold: 0 });

    // (d) quoted → cancelled like (a).
    const od = await fx.order(d.ref);
    assert.equal(od.status, "cancelled");
    assert.ok(od.expiredAt);
    assert.equal(od.expiresIn, null);
    assert.deepEqual(await fx.stock(3), { available: 10, onHold: 0, sold: 0 });

    // A second sweep finds nothing of ours left to do.
    const again = await sweepExpiredOrders({ force: true });
    assert.ok(!again.cancelled.some((o) => [aId, bId, cId, dId].includes(o.id)));
    await fx.assertLedger();
  } finally {
    await fx.cleanup();
  }
});

test("the invoice number is issued on payment, so an order that expires unpaid uses none", async () => {
  assertLocalDatabase();
  const fx = await fixture([{ priceCents: 100, available: 20 }]);
  const seq = async () => {
    const [row] = await sql<{ last: string; called: boolean }[]>`
      SELECT last_value::text AS last, is_called AS called FROM invoice_seq`;
    return row;
  };
  const suffixOf = (n: string | null) => Number(n!.split("-")[2]);
  try {
    const first = created(await fx.submit([{ product: 0, qty: 1 }]));
    const lapsing = created(await fx.submit([{ product: 0, qty: 1 }]));
    const third = created(await fx.submit([{ product: 0, qty: 1 }]));
    for (const r of [first, lapsing, third]) assert.equal((await fx.order(r.ref)).invoiceNumber, null);
    const before = await seq();

    assert.equal(await confirmPayment(first.orders[0].id, "invoiced"), true);
    const n1 = (await fx.order(first.ref)).invoiceNumber;
    assert.match(n1 ?? "", /^INV-\d{4}-\d{4,}$/);
    assert.equal(n1!.slice(4, 8), String(persianYearMonth(new Date()).year));
    assert.equal(suffixOf(n1), Number(before.last) + (before.called ? 1 : 0));

    await sql`UPDATE orders SET expires_at = now() - interval '1 hour' WHERE id = ${lapsing.orders[0].id}`;
    await sweepExpiredOrders({ force: true });
    const gone = await fx.order(lapsing.ref);
    assert.equal(gone.status, "cancelled");
    assert.equal(gone.invoiceNumber, null);

    assert.equal(await confirmPayment(third.orders[0].id, "invoiced"), true);
    const n3 = (await fx.order(third.ref)).invoiceNumber;
    assert.equal(suffixOf(n3), suffixOf(n1) + 1, "the lapsed order consumed no number");

    // Paying twice or from the wrong status changes nothing and burns no number.
    assert.equal(await confirmPayment(third.orders[0].id, "invoiced"), false);
    assert.equal(await confirmPayment(lapsing.orders[0].id, "invoiced"), false);
    assert.equal(Number((await seq()).last), suffixOf(n3));
    assert.deepEqual(await fx.stock(0), { available: 18, onHold: 0, sold: 2 });
    await fx.assertLedger();
  } finally {
    await fx.cleanup();
  }
});

test("the quote path: staff quote, the customer accepts, the pish-factor locks the rate", async () => {
  assertLocalDatabase();
  const fx = await fixture([{ priceCents: 0, available: 10 }]);
  try {
    const request = created(await fx.submit([{ product: 0, qty: 3 }]));
    const id = request.orders[0].id;
    const [item] = await sql<{ id: number }[]>`SELECT id FROM order_items WHERE order_id = ${id}`;

    // A line still at 0 cannot be quoted, and nothing moves.
    const untouched = await fx.order(request.ref);
    assert.equal(await sendQuote(id, {}), "unpriced");
    const same = await fx.order(request.ref);
    assert.equal(same.status, "received");
    assert.equal(same.quotedAt, null);
    near(same.expiresIn, 5 * DAY);
    assert.ok(Math.abs((same.expiresIn ?? 0) - (untouched.expiresIn ?? 0)) < 30);
    // The pish-factor refuses a zero line too.
    assert.equal(
      await issuePishFactor(id, { ...TERMS, from: "received", actor: { kind: "admin" } }),
      "unpriced",
    );
    assert.equal((await fx.order(request.ref)).status, "received");

    assert.equal(await sendQuote(id, { prices: [{ id: item.id, cents: 200 }] }), "issued");
    const quoted = await fx.order(request.ref);
    assert.equal(quoted.status, "quoted");
    assert.ok(quoted.quotedAt);
    assert.equal(quoted.rate, null);
    assert.equal(quoted.vatRateBp, null);
    assert.equal(quoted.invoicedAt, null);
    near(quoted.expiresIn, 5 * DAY);
    // Only a received order can be quoted.
    assert.equal(await sendQuote(id, {}), "conflict");

    // Accepting from the wrong status is a conflict.
    assert.equal(
      await issuePishFactor(id, { ...TERMS, from: "received", actor: { kind: "admin" } }),
      "conflict",
    );
    assert.equal(
      await issuePishFactor(id, { ...TERMS, from: "quoted", actor: { kind: "customer", id: null } }),
      "issued",
    );
    const invoiced = await fx.order(request.ref);
    assert.equal(invoiced.status, "invoiced");
    assert.equal(invoiced.rate, TERMS.rate);
    assert.equal(invoiced.vatRateBp, TERMS.vatRateBp);
    assert.equal(invoiced.invoiceNumber, null);
    near(invoiced.expiresIn, DAY);
    const [{ total }] = await sql<{ total: number }[]>`SELECT total_cents AS total FROM orders WHERE id = ${id}`;
    assert.equal(total, 600);
    await fx.assertLedger();
  } finally {
    await fx.cleanup();
  }
});

async function userWith(fx: { marker: string; userIds: string[] }, tag: string) {
  const user = await createUser({
    email: `${fx.marker}-${tag}@example.invalid`,
    passwordHash: "x",
    company: "Code Co",
    contactName: "N",
    phone: "0912 000 0000",
    locale: "en",
    origin: "checkout",
    repId: null,
    accountNumber: "assigned",
  });
  if (user === "email-taken") throw new Error("unexpected email clash");
  fx.userIds.push(user.id);
  return user;
}

const wrongOf = (code: string) => (code === "000000" ? "111111" : "000000");

test("sign-in codes: right code once, wrong codes counted, a newer code replaces the older", async () => {
  assertLocalDatabase();
  const fx = await fixture([]);
  try {
    const user = await userWith(fx, "code");
    const verified = async () => {
      const [row] = await sql<{ at: string | null }[]>`
        SELECT email_verified_at AS at FROM users WHERE id = ${user.id}`;
      return row.at;
    };
    // A checkout account is born with a password nobody knows and no verified address.
    assert.equal(user.needsPassword, true);
    assert.equal(await verified(), null);

    // No code issued yet.
    assert.equal(await redeemLoginCode(user.id, "123456"), "expired");

    const code = await issueLoginCode(user.id);
    assert.match(code, /^\d{6}$/);
    assert.equal(await redeemLoginCode(user.id, code), "ok");
    assert.ok(await verified());
    assert.equal(await redeemLoginCode(user.id, code), "expired", "a code works once");

    // Wrong guesses are counted; at the limit the code is spent, even for the right one.
    const second = await issueLoginCode(user.id);
    for (let n = 1; n < LOGIN_CODE_MAX_ATTEMPTS; n++) {
      assert.equal(await redeemLoginCode(user.id, wrongOf(second)), "wrong", `attempt ${n}`);
    }
    assert.equal(await redeemLoginCode(user.id, wrongOf(second)), "expired");
    assert.equal(await redeemLoginCode(user.id, second), "expired");

    // A newer code invalidates the older one.
    let older = await issueLoginCode(user.id);
    let newer = await issueLoginCode(user.id);
    while (newer === older) newer = await issueLoginCode(user.id);
    assert.equal(await redeemLoginCode(user.id, older), "wrong");
    assert.equal(await redeemLoginCode(user.id, newer), "ok");

    // A lapsed code is expired.
    older = await issueLoginCode(user.id);
    await sql`UPDATE login_codes SET expires_at = now() - interval '1 minute' WHERE user_id = ${user.id} AND consumed_at IS NULL`;
    assert.equal(await redeemLoginCode(user.id, older), "expired");

    // One account's code never opens another's.
    const other = await userWith(fx, "other");
    const mine = await issueLoginCode(user.id);
    await issueLoginCode(other.id);
    assert.notEqual(await redeemLoginCode(other.id, mine), "ok");

    // After a code sign-in the old password and every old session stop working.
    const state = async () => {
      const [row] = await sql<{ hash: string; version: number; chose: boolean }[]>`
        SELECT password_hash AS hash, session_version AS version, chose_own_password AS chose
        FROM users WHERE id = ${user.id}`;
      return row;
    };
    await sql`UPDATE users SET password_hash = 'known', chose_own_password = true WHERE id = ${user.id}`;
    const before = await state();
    await requireNewPassword(user.id, "unusable");
    const afterReset = await state();
    assert.equal(afterReset.hash, "unusable");
    assert.equal(afterReset.chose, false);
    assert.equal(afterReset.version, before.version + 1);
  } finally {
    await fx.cleanup();
  }
});

test("saved addresses: first is default, one default at a time, ownership enforced, capped at 20", async () => {
  assertLocalDatabase();
  const fx = await fixture([]);
  const input = (label: string): AddressInput => ({
    label,
    recipient: "R",
    phone: "021",
    address: `${label} Street`,
    city: "Tehran",
    postalCode: "",
  });
  try {
    const me = await userWith(fx, "addr-a");
    const other = await userWith(fx, "addr-b");
    const defaults = async (userId: string) =>
      (await listAddresses(userId)).filter((a) => a.isDefault).map((a) => a.label);

    assert.equal(await addAddress(me.id, input("A")), "added");
    assert.deepEqual(await defaults(me.id), ["A"], "the first address becomes the default");
    assert.equal(await addAddress(me.id, input("B")), "added");
    assert.equal(await addAddress(me.id, input("C")), "added");
    assert.deepEqual(await defaults(me.id), ["A"], "later ones are not default unless asked");
    assert.equal(await addAddress(me.id, input("D"), true), "added");
    assert.deepEqual(await defaults(me.id), ["D"]);

    const all = await listAddresses(me.id);
    assert.equal(all[0].label, "D", "the default is listed first");
    const byLabel = Object.fromEntries(all.map((a) => [a.label, a.id]));

    assert.equal(await setDefaultAddress(me.id, byLabel.C), true);
    assert.deepEqual(await defaults(me.id), ["C"]);

    // Deleting the default hands it to the oldest remaining one.
    assert.equal(await deleteAddress(me.id, byLabel.C), true);
    assert.deepEqual(await defaults(me.id), ["A"]);
    // Deleting a non-default leaves the default alone.
    assert.equal(await deleteAddress(me.id, byLabel.B), true);
    assert.deepEqual(await defaults(me.id), ["A"]);

    // Someone else's id reads, updates, defaults and deletes nothing.
    assert.equal(await getAddress(other.id, byLabel.A), null);
    assert.equal(await updateAddress(other.id, byLabel.A, input("HACK")), false);
    assert.equal(await setDefaultAddress(other.id, byLabel.D), false);
    assert.equal(await deleteAddress(other.id, byLabel.D), false);
    assert.deepEqual(
      (await listAddresses(me.id)).map((a) => [a.label, a.isDefault]),
      [["A", true], ["D", false]],
    );
    assert.equal((await listAddresses(other.id)).length, 0);
    assert.equal(await updateAddress(me.id, byLabel.D, input("D2")), true);
    assert.equal((await getAddress(me.id, byLabel.D))?.label, "D2");

    // Deleting the last one leaves no default and no error.
    assert.equal(await deleteAddress(me.id, byLabel.A), true);
    assert.equal(await deleteAddress(me.id, byLabel.D), true);
    assert.equal((await listAddresses(me.id)).length, 0);

    // The cap.
    for (let n = 0; n < MAX_ADDRESSES; n++) assert.equal(await addAddress(other.id, input(`X${n}`)), "added");
    assert.equal(await addAddress(other.id, input("one too many")), "full");
    assert.equal((await listAddresses(other.id)).length, MAX_ADDRESSES);
    assert.equal((await defaults(other.id)).length, 1);
  } finally {
    await fx.cleanup();
  }
});

test("ledger: back-order lines count as neither held nor sold, and a wrong count is caught", async () => {
  assertLocalDatabase();
  const fx = await fixture([{ priceCents: 100, available: 3 }]);
  try {
    const baseline = (await inspectDatabaseIntegrity(sql)).inventoryLedgerMismatches;
    const placed = created(await fx.submit([{ product: 0, qty: 50 }], { mode: "split" }));
    const [pish, rest] = placed.orders;
    await fx.assertLedger();
    assert.deepEqual(await fx.stock(0), { available: 0, onHold: 3, sold: 0 });

    // Paying the pish-factor sells its 3; the 47 on back order sold nothing.
    assert.equal(await confirmPayment(pish.id, "invoiced"), true);
    assert.deepEqual(await fx.stock(0), { available: 0, onHold: 0, sold: 3 });
    await fx.assertLedger();

    // Cancelling the back order, and expiring it, release nothing.
    await sql`UPDATE orders SET status = 'cancelled', expires_at = NULL WHERE id = ${rest.id}`;
    await fx.assertLedger();
    assert.deepEqual(await fx.stock(0), { available: 0, onHold: 0, sold: 3 });
    assert.equal((await inspectDatabaseIntegrity(sql)).inventoryLedgerMismatches, baseline);

    // The check is not vacuous: a count that drifted is found and repaired.
    await sql`UPDATE products SET inventory_on_hold = 47, inventory_available = -47 WHERE id = ${fx.products[0].id}`;
    assert.equal(await sql.begin((tx) => reconcileInventoryForProducts(tx, [fx.products[0].id])), 1);
    assert.deepEqual(await fx.stock(0), { available: 0, onHold: 0, sold: 3 });
  } finally {
    await fx.cleanup();
  }
});

test("staff emails: add, refuse duplicates and junk, remove", async () => {
  assertLocalDatabase();
  const [saved] = await sql<{ value: string }[]>`SELECT value FROM app_settings WHERE key = 'staff_notify_emails'`;
  try {
    await sql`DELETE FROM app_settings WHERE key = 'staff_notify_emails'`;
    assert.deepEqual(await getStaffEmails(), []);
    assert.equal(await addStaffEmail("Sara.K@Gmail.com"), "added");
    assert.equal(await addStaffEmail("sara.k@gmail.com"), "exists");
    assert.equal(await addStaffEmail("not an email"), "invalid");
    assert.equal(await addStaffEmail("ops@hotmail.com"), "added");
    assert.deepEqual(await getStaffEmails(), ["sara.k@gmail.com", "ops@hotmail.com"]);
    await removeStaffEmail("sara.k@gmail.com");
    assert.deepEqual(await getStaffEmails(), ["ops@hotmail.com"]);
  } finally {
    await sql`DELETE FROM app_settings WHERE key = 'staff_notify_emails'`;
    if (saved) await sql`INSERT INTO app_settings (key, value) VALUES ('staff_notify_emails', ${saved.value})`;
  }
});

test("a customer cancels an unpaid order, stock comes back; after a receipt they cannot", async () => {
  assertLocalDatabase();
  const fx = await fixture([{ priceCents: 100, available: 10 }]);
  try {
    const a = created(await fx.submit([{ product: 0, qty: 4 }]));
    const b = created(await fx.submit([{ product: 0, qty: 3 }]));
    const [aId, bId] = [a, b].map((r) => r.orders[0].id);
    assert.deepEqual(await fx.stock(0), { available: 3, onHold: 7, sold: 0 });

    assert.deepEqual(await cancelOrderByCustomer(aId, { kind: "customer", id: null }, "ordered twice"), {
      ok: true,
      from: "invoiced",
    });
    const cancelled = await fx.order(a.ref);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.expiresIn, null);
    assert.equal(cancelled.expiredAt, null, "a customer cancel is not an expiry");
    assert.deepEqual(await fx.stock(0), { available: 7, onHold: 3, sold: 0 });
    // A second press, or a stale tab, changes nothing.
    assert.deepEqual(await cancelOrderByCustomer(aId, { kind: "customer", id: null }, ""), { ok: false });
    assert.deepEqual(await fx.stock(0), { available: 7, onHold: 3, sold: 0 });

    // Once a receipt exists, only staff can cancel.
    assert.equal(
      await addPaymentProof(bId, { path: `test/${fx.marker}/c.jpg`, type: "image/jpeg", size: 10 }, { kind: "customer" }),
      "added",
    );
    assert.deepEqual(await cancelOrderByCustomer(bId, { kind: "customer", id: null }, ""), { ok: false });
    assert.equal((await fx.order(b.ref)).status, "payment_review");
    await fx.assertLedger();
  } finally {
    await fx.cleanup();
  }
});
