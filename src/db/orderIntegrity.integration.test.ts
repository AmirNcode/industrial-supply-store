import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import {
  findShortfalls,
  holdStockForOrder,
  releaseHeldStock,
  sellHeldStock,
} from "./inventoryQueries";
import { submitOrderFromCart, type SubmitOrderInput } from "./orderSubmissionQueries";
import { getInvoiceByRef, issueInvoice, updateOrderItemPrices } from "./invoiceQueries";
import { addPaymentProof, confirmPayment, listPaymentProofs } from "./paymentProofQueries";
import { PROOF_MAX_PER_ORDER } from "@/lib/paymentProof";
import { persianYearMonth } from "@/lib/persianCalendar";
import { randomReferralCode } from "@/lib/repAccount";
import { quoteCartFingerprint } from "@/lib/quoteSubmission";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for the database integration test");
  const { hostname } = new URL(raw);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`Refusing to run order integration tests against non-local host: ${hostname}`);
  }
}

async function addHeldOrder(
  tx: Tx,
  productId: number,
  partNumber: string,
  qty: number,
  marker: string,
) {
  const [order] = await tx<{ id: number }[]>`
    INSERT INTO orders (submission_key, ref, company, contact_name, email, phone,
                        notes, locale, currency, total_cents, requested_total_cents, status)
    VALUES (${randomUUID()}, ${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`},
            'Integration Test', 'Test Buyer', 'test@example.invalid', '555-0100',
            ${marker}, 'en', 'USD', 100, 100, 'received')
    RETURNING id
  `;
  await tx`
    INSERT INTO order_items (order_id, product_id, part_number, family_name,
                             specs_snapshot, qty, unit_price_cents,
                             requested_unit_price_cents)
    VALUES (${order.id}, ${productId}, ${partNumber}, 'Integration Family',
            '{}'::jsonb, ${qty}, 100, 100)
  `;
  await holdStockForOrder(tx, order.id);
  return order.id;
}

test("quote replay and reservation allocation stay correct through the order lifecycle", async () => {
  assertLocalDatabase();

  const suffix = randomUUID();
  const marker = `order-integrity-${suffix}`;
  const submissionKey = randomUUID();
  const cartId = randomUUID();
  let categoryId: number | undefined;

  try {
    const setup = await sql.begin(async (tx) => {
      const [category] = await tx<{ id: number }[]>`
        INSERT INTO categories (slug, path, name_en, name_fa)
        VALUES (${`integration-${suffix}`}, ${`integration-${suffix}`},
                'Integration', 'آزمایش')
        RETURNING id
      `;
      const [family] = await tx<{ id: number }[]>`
        INSERT INTO product_families (slug, category_id, name_en, name_fa)
        VALUES (${`integration-family-${suffix}`}, ${category.id},
                'Integration Family', 'خانواده آزمایشی')
        RETURNING id
      `;
      const partNumber = `INT-${suffix}`;
      const [product] = await tx<{ id: number }[]>`
        INSERT INTO products (part_number, family_id, specs, price_cents,
                              inventory_available, inventory_on_hold, inventory_sold)
        VALUES (${partNumber}, ${family.id}, '{}'::jsonb, 100, 100, 0, 0)
        RETURNING id
      `;
      const secondPartNumber = `INT-BATCH-${suffix}`;
      const [secondProduct] = await tx<{ id: number }[]>`
        INSERT INTO products (part_number, family_id, specs, price_cents,
                              inventory_available, inventory_on_hold, inventory_sold)
        VALUES (${secondPartNumber}, ${family.id},
                '{"material":"Viton","durometer":75}'::jsonb,
                250, 50, 0, 0)
        RETURNING id
      `;
      await tx`INSERT INTO carts (id) VALUES (${cartId})`;
      await tx`
        INSERT INTO cart_items (cart_id, product_id, qty)
        VALUES (${cartId}, ${product.id}, 60),
               (${cartId}, ${secondProduct.id}, 20)
      `;
      return {
        categoryId: category.id,
        familyId: family.id,
        productId: product.id,
        partNumber,
        secondProductId: secondProduct.id,
        secondPartNumber,
      };
    });
    categoryId = setup.categoryId;

    const input: SubmitOrderInput = {
      cartId,
      cartFingerprint: quoteCartFingerprint([
        { productId: setup.productId, qty: 60, unitPriceCents: 100 },
        { productId: setup.secondProductId, qty: 20, unitPriceCents: 250 },
      ]),
      submissionKey,
      locale: "en",
      currency: "USD",
      userId: null,
      placedByRepId: null,
      contact: {
        company: "Integration Test",
        contactName: "Test Buyer",
        email: "test@example.invalid",
        phone: "555-0100",
        poNumber: "",
        address: "",
        city: "",
        country: "",
        notes: marker,
      },
    };

    // These use separate transactions and race on purpose. One request creates
    // the order; the other waits for the cart lock and replays the same ref.
    const results = await Promise.all([
      submitOrderFromCart(input),
      submitOrderFromCart(input),
    ]);
    assert.deepEqual(new Set(results.map((result) => result.kind)), new Set(["created", "replayed"]));
    const refs = results.map((result) => {
      assert.ok("ref" in result);
      return result.ref;
    });
    assert.equal(refs[0], refs[1]);

    const [created] = await sql<
      { id: number; orders: number; items: number; currency: string }[]
    >`
      SELECT min(o.id)::int AS id, count(DISTINCT o.id)::int AS orders,
             count(i.id)::int AS items, min(o.currency) AS currency
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
      WHERE o.submission_key = ${submissionKey}
    `;
    assert.equal(created.orders, 1);
    assert.equal(created.items, 2);
    assert.equal(created.currency, "USD");

    const snapshots = await sql<
      {
        id: number;
        partNumber: string;
        specsSnapshot: Record<string, unknown>;
        qty: number;
        unitPriceCents: number;
      }[]
    >`
      SELECT id, part_number AS "partNumber", specs_snapshot AS "specsSnapshot", qty,
             unit_price_cents AS "unitPriceCents"
      FROM order_items
      WHERE order_id = ${created.id}
      ORDER BY product_id
    `;
    assert.deepEqual([...snapshots], [
      {
        id: snapshots[0].id,
        partNumber: setup.partNumber,
        specsSnapshot: {},
        qty: 60,
        unitPriceCents: 100,
      },
      {
        id: snapshots[1].id,
        partNumber: setup.secondPartNumber,
        specsSnapshot: { material: "Viton", durometer: 75 },
        qty: 20,
        unitPriceCents: 250,
      },
    ]);
    const pricesUpdated = await sql.begin((tx) =>
      updateOrderItemPrices(
        tx,
        created.id,
        snapshots.map((item) => ({ id: item.id, cents: item.unitPriceCents })),
      ),
    );
    assert.equal(pricesUpdated, 2);

    const inventoryAfterSubmit = await sql<{ id: number; available: number; onHold: number }[]>`
      SELECT id, inventory_available AS available, inventory_on_hold AS "onHold"
      FROM products
      WHERE id = ANY(${[setup.productId, setup.secondProductId]}::int[])
      ORDER BY id
    `;
    assert.deepEqual([...inventoryAfterSubmit], [
      { id: setup.productId, available: 40, onHold: 60 },
      { id: setup.secondProductId, available: 30, onHold: 20 },
    ]);
    const [cartAfterSubmit] = await sql<{ cartLines: number }[]>`
      SELECT count(*)::int AS "cartLines" FROM cart_items WHERE cart_id = ${cartId}
    `;
    assert.equal(cartAfterSubmit.cartLines, 0);
    assert.equal((await findShortfalls([created.id])).size, 0, "60 of 100 is sufficient");

    const { secondId, thirdId } = await sql.begin(async (tx) => ({
      secondId: await addHeldOrder(tx, setup.productId, setup.partNumber, 30, marker),
      thirdId: await addHeldOrder(tx, setup.productId, setup.partNumber, 20, marker),
    }));

    const allocated = await findShortfalls([created.id, secondId, thirdId]);
    assert.equal(allocated.size, 1);
    assert.deepEqual(allocated.get(thirdId), [
      { orderId: thirdId, partNumber: setup.partNumber, qty: 20, available: 10 },
    ]);

    // Paying the first order consumes its hold but does not manufacture stock;
    // the final order still has only ten packs available in sequence.
    await sql.begin(async (tx) => {
      await tx`
        UPDATE orders
        SET status = 'preparing', invoice_number = ${`INV-TEST-${suffix}`},
            fx_rate_to_rial = 10000, invoiced_at = now(), paid_at = now()
        WHERE id = ${created.id}
      `;
      await sellHeldStock(tx, created.id);
    });
    assert.deepEqual((await findShortfalls([secondId, thirdId])).get(thirdId), [
      { orderId: thirdId, partNumber: setup.partNumber, qty: 20, available: 10 },
    ]);

    // Cancelling the 30-pack hold makes that stock available to the later
    // order, so its warning must disappear.
    await sql.begin(async (tx) => {
      await tx`UPDATE orders SET status = 'cancelled' WHERE id = ${secondId}`;
      await releaseHeldStock(tx, secondId);
    });
    assert.equal((await findShortfalls([thirdId])).size, 0);

    // Exact stock and a single insufficient order cover the two remaining
    // boundary cases without sharing inventory with the sequence above.
    await sql.begin(async (tx) => {
      const exactPart = `EXACT-${suffix}`;
      const [exactProduct] = await tx<{ id: number }[]>`
        INSERT INTO products (part_number, family_id, specs, price_cents,
                              inventory_available, inventory_on_hold, inventory_sold)
        VALUES (${exactPart}, ${setup.familyId}, '{}'::jsonb, 100, 50, 0, 0)
        RETURNING id
      `;
      const exactOrder = await addHeldOrder(tx, exactProduct.id, exactPart, 50, marker);
      assert.equal((await findShortfalls([exactOrder], tx)).size, 0);

      const shortPart = `SHORT-${suffix}`;
      const [shortProduct] = await tx<{ id: number }[]>`
        INSERT INTO products (part_number, family_id, specs, price_cents,
                              inventory_available, inventory_on_hold, inventory_sold)
        VALUES (${shortPart}, ${setup.familyId}, '{}'::jsonb, 100, 10, 0, 0)
        RETURNING id
      `;
      const shortOrder = await addHeldOrder(tx, shortProduct.id, shortPart, 15, marker);
      assert.deepEqual((await findShortfalls([shortOrder], tx)).get(shortOrder), [
        { orderId: shortOrder, partNumber: shortPart, qty: 15, available: 10 },
      ]);
    });
  } finally {
    // Exact test-owned rows only. This also cleans up after a failed assertion;
    // production hosts are refused before the first write.
    await sql.begin(async (tx) => {
      await tx`DELETE FROM orders WHERE notes = ${marker}`;
      await tx`DELETE FROM carts WHERE id = ${cartId}`;
      if (categoryId) await tx`DELETE FROM categories WHERE id = ${categoryId}`;
    });
  }
});

after(async () => {
  await sql.end({ timeout: 5 });
});

test("an invoice locks its prices, exchange rate and VAT rate once, and only once", async () => {
  assertLocalDatabase();
  const [order] = await sql<{ id: number; ref: string }[]>`
    INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'VAT Co', 'Tester',
            'vat@example.invalid', 1000, 1000)
    RETURNING id, ref
  `;
  try {
    const [line] = await sql<{ id: number }[]>`
      INSERT INTO order_items (order_id, product_id, part_number, family_name, qty,
                               unit_price_cents, requested_unit_price_cents)
      VALUES (${order.id}, NULL, 'VAT-1', 'Integration Family', 2, 500, 500)
      RETURNING id
    `;
    // A VAT rate belongs to an invoice; an order still being priced has none.
    await assert.rejects(sql`UPDATE orders SET vat_rate_bp = 1000 WHERE id = ${order.id}`, {
      code: "23514",
    });

    const read = async () => {
      const [row] = await sql<
        { status: string; rate: number; vatRateBp: number; totalCents: number; invoiceNumber: string }[]
      >`
        SELECT status, fx_rate_to_rial AS rate, vat_rate_bp AS "vatRateBp",
               total_cents AS "totalCents", invoice_number AS "invoiceNumber"
        FROM orders WHERE id = ${order.id}
      `;
      const [item] = await sql<{ cents: number }[]>`
        SELECT unit_price_cents AS cents FROM order_items WHERE id = ${line.id}
      `;
      return { ...row, lineCents: item.cents };
    };

    assert.equal(
      await issueInvoice(order.id, {
        rate: 1_094_889,
        vatRateBp: 1000,
        prices: [{ id: line.id, cents: 450 }],
      }),
      "issued",
    );
    const issued = await read();
    assert.equal(issued.status, "invoiced");
    assert.equal(issued.rate, 1_094_889);
    assert.equal(issued.vatRateBp, 1000);
    assert.equal(issued.totalCents, 900);
    assert.equal(issued.lineCents, 450);
    assert.match(issued.invoiceNumber, /^INV-\d{4}-\d{4,}$/);
    // The year is the Persian one (L-5), e.g. 1405 rather than 2026.
    assert.equal(
      issued.invoiceNumber.slice(4, 8),
      String(persianYearMonth(new Date()).year),
    );
    assert.equal((await getInvoiceByRef(order.ref))?.order.vatRateBp, 1000);

    // The admin and a rep finalizing at once: the second changes nothing, and
    // its price update is rolled back with it.
    assert.equal(
      await issueInvoice(order.id, { rate: 2_000_000, vatRateBp: 900, prices: [{ id: line.id, cents: 1 }] }),
      "conflict",
    );
    assert.deepEqual(await read(), issued);
  } finally {
    await sql`DELETE FROM orders WHERE id = ${order.id}`;
  }
});

test("a receipt moves an invoice to review; confirming sells the stock", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const [order] = await sql<{ id: number }[]>`
    INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents)
    VALUES (${`ORD-${suffix.slice(0, 6).toUpperCase()}`}, 'Proof Co', 'Tester',
            'proof@example.invalid', 500, 500)
    RETURNING id
  `;
  const [rep] = await sql<{ id: string }[]>`
    INSERT INTO sales_reps (username, password_hash, name, referral_code)
    VALUES (${`proof-${suffix}`}, 'x', 'Proof Rep',
            ${randomReferralCode()})
    RETURNING id
  `;
  const file = (n: number) => ({ path: `test/${suffix}/${n}.jpg`, type: "image/jpeg" as const, size: 10 });
  const status = async () =>
    (await sql<{ status: string; submitted: boolean; paid: boolean }[]>`
      SELECT status, payment_submitted_at IS NOT NULL AS submitted, paid_at IS NOT NULL AS paid
      FROM orders WHERE id = ${order.id}`)[0];
  try {
    // Nothing to pay for yet.
    assert.equal(await addPaymentProof(order.id, file(0), { kind: "customer" }), "closed");

    await issueInvoice(order.id, { rate: 1_000_000, vatRateBp: 1000 });
    assert.equal(await addPaymentProof(order.id, file(1), { kind: "customer" }), "added");
    assert.deepEqual(await status(), { status: "payment_review", submitted: true, paid: false });
    assert.equal(await addPaymentProof(order.id, file(2), { kind: "rep", repId: rep.id }), "added");
    const proofs = (await listPaymentProofs([order.id])).get(order.id) ?? [];
    assert.deepEqual(proofs.map((p) => [p.uploadedBy, p.repName]), [["customer", null], ["rep", "Proof Rep"]]);

    // The cap holds.
    for (let n = 3; n <= PROOF_MAX_PER_ORDER; n++) {
      assert.equal(await addPaymentProof(order.id, file(n), { kind: "customer" }), "added");
    }
    assert.equal(await addPaymentProof(order.id, file(99), { kind: "customer" }), "full");

    // A confirmation from the wrong status changes nothing.
    assert.equal(await confirmPayment(order.id, "invoiced"), false);
    assert.equal(await confirmPayment(order.id, "payment_review"), true);
    assert.deepEqual(await status(), { status: "preparing", submitted: true, paid: true });
    // And no receipt can be added once payment is confirmed.
    assert.equal(await addPaymentProof(order.id, file(100), { kind: "customer" }), "closed");

    // The database refuses a review with no receipt date, and a rep upload with no rep.
    await assert.rejects(
      sql`UPDATE orders SET status = 'payment_review', paid_at = NULL, payment_submitted_at = NULL
          WHERE id = ${order.id}`,
      { code: "23514" },
    );
    await assert.rejects(
      sql`INSERT INTO payment_proofs (order_id, storage_path, content_type, byte_size, uploaded_by)
          VALUES (${order.id}, ${`test/${suffix}/x.jpg`}, 'image/jpeg', 10, 'rep')`,
      { code: "23514" },
    );
  } finally {
    await sql`DELETE FROM orders WHERE id = ${order.id}`;
    await sql`DELETE FROM sales_reps WHERE id = ${rep.id}`;
  }
});

test("invoice numbers stay unique past 9,999, and the realignment never winds back", async () => {
  // Review finding H-3: lpad(…, 4) truncated 10000 to 1000.
  assertLocalDatabase();
  const [{ start }] = await sql<{ start: string }[]>`
    SELECT (CASE WHEN is_called THEN last_value ELSE last_value - 1 END)::text AS start FROM invoice_seq`;
  const ids: number[] = [];
  try {
    await sql`SELECT setval('invoice_seq', 9998, true)`;
    const numbers: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [order] = await sql<{ id: number }[]>`
        INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents)
        VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Seq Co', 'Tester',
                'seq@example.invalid', 100, 100)
        RETURNING id`;
      ids.push(order.id);
      await sql`
        INSERT INTO order_items (order_id, product_id, part_number, family_name, qty,
                                 unit_price_cents, requested_unit_price_cents)
        VALUES (${order.id}, NULL, 'SEQ-1', 'Integration Family', 1, 100, 100)`;
      assert.equal(await issueInvoice(order.id, { rate: 1_000_000, vatRateBp: 0 }), "issued");
      const [row] = await sql<{ n: string }[]>`SELECT invoice_number AS n FROM orders WHERE id = ${order.id}`;
      numbers.push(row.n.split("-")[2]);
    }
    assert.deepEqual(numbers, ["9999", "10000", "10001"]);

    // A repair run after a push must not move the sequence back to 9,999.
    const { realignInvoiceSequence } = await import("./invoiceSequence");
    assert.equal(await realignInvoiceSequence(sql), 10001);
    await sql`SELECT setval('invoice_seq', 1, false)`;
    assert.equal(await realignInvoiceSequence(sql), 10001, "recreated sequence moves past issued numbers");
  } finally {
    if (ids.length) await sql`DELETE FROM orders WHERE id = ANY(${ids})`;
    const value = Number(start);
    if (value > 0) await sql`SELECT setval('invoice_seq', ${value}, true)`;
    else await sql`SELECT setval('invoice_seq', 1, false)`;
  }
});

test("concurrent checkouts sharing products in opposite order do not deadlock", async () => {
  // Review M-8: stock moves now lock product rows in id order first.
  assertLocalDatabase();
  const suffix = randomUUID();
  let categoryId: number | undefined;
  try {
    const [category] = await sql<{ id: number }[]>`
      INSERT INTO categories (slug, path, name_en, name_fa)
      VALUES (${`deadlock-${suffix}`}, ${`deadlock-${suffix}`}, 'Deadlock', 'بن‌بست') RETURNING id`;
    categoryId = category.id;
    const [family] = await sql<{ id: number }[]>`
      INSERT INTO product_families (slug, category_id, name_en, name_fa)
      VALUES (${`deadlock-family-${suffix}`}, ${category.id}, 'Deadlock', 'بن‌بست') RETURNING id`;
    const products = await sql<{ id: number }[]>`
      INSERT INTO products (part_number, family_id, specs, price_cents,
                            inventory_available, inventory_on_hold, inventory_sold)
      VALUES (${`DL-A-${suffix}`}, ${family.id}, '{}'::jsonb, 100, 1000, 0, 0),
             (${`DL-B-${suffix}`}, ${family.id}, '{}'::jsonb, 100, 1000, 0, 0),
             (${`DL-C-${suffix}`}, ${family.id}, '{}'::jsonb, 100, 1000, 0, 0)
      RETURNING id`;
    const ids = products.map((p) => p.id);
    const orders: number[] = [];
    for (let n = 0; n < 16; n++) {
      const [order] = await sql<{ id: number }[]>`
        INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents)
        VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'DL Co', 'T', 'dl@example.invalid', 300, 300)
        RETURNING id`;
      orders.push(order.id);
      const lineOrder = n % 2 === 0 ? ids : [...ids].reverse();
      for (const productId of lineOrder) {
        await sql`
          INSERT INTO order_items (order_id, product_id, part_number, family_name, qty,
                                   unit_price_cents, requested_unit_price_cents)
          VALUES (${order.id}, ${productId}, 'DL', 'Deadlock', 1, 100, 100)`;
      }
    }
    await Promise.all(
      orders.map((orderId) =>
        sql.begin(async (tx) => {
          await holdStockForOrder(tx, orderId);
          // Hold the locks a moment, so the transactions genuinely overlap.
          await tx`SELECT pg_sleep(0.02)`;
        }),
      ),
    );
    const held = await sql<{ onHold: number }[]>`
      SELECT inventory_on_hold AS "onHold" FROM products WHERE id = ANY(${ids}) ORDER BY id`;
    assert.deepEqual(held.map((row) => row.onHold), [16, 16, 16]);
  } finally {
    if (categoryId !== undefined) {
      await sql`DELETE FROM orders WHERE company = 'DL Co'`;
      await sql`DELETE FROM categories WHERE id = ${categoryId}`;
    }
  }
});
