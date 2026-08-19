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
import { updateOrderItemPrices } from "./invoiceQueries";
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
      userId: null,
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

    const [created] = await sql<{ id: number; orders: number; items: number }[]>`
      SELECT min(o.id)::int AS id, count(DISTINCT o.id)::int AS orders,
             count(i.id)::int AS items
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
      WHERE o.submission_key = ${submissionKey}
    `;
    assert.equal(created.orders, 1);
    assert.equal(created.items, 2);

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
            fx_rate_to_toman = 1000, invoiced_at = now(), paid_at = now()
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
