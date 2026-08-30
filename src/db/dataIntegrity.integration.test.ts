import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import {
  inspectDatabaseIntegrity,
  reconcileDerivedData,
  reconcileInventoryForProducts,
  type DatabaseIntegrityReport,
} from "./dataIntegrity";
import { saveColumnsInTransaction } from "./columnQueries";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

class RollBackFixture extends Error {}
class RollBackSavepoint extends Error {}

function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for the database integration test");
  const { hostname } = new URL(raw);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`Refusing to run integrity integration tests against non-local host: ${hostname}`);
  }
}

function postgresCode(code: string): (error: unknown) => boolean {
  return (error) => {
    assert.equal((error as { code?: string })?.code, code);
    return true;
  };
}

async function expectDetected(
  tx: Tx,
  mutate: (savepoint: Tx) => Promise<unknown>,
  assertions: (report: DatabaseIntegrityReport) => void,
): Promise<void> {
  await assert.rejects(
    tx.savepoint(async (savepoint) => {
      await mutate(savepoint);
      assertions(await inspectDatabaseIntegrity(savepoint));
      throw new RollBackSavepoint();
    }),
    RollBackSavepoint,
  );
}

test("constraints, corruption detection, and derived reconciliation share one invariant model", async () => {
  assertLocalDatabase();
  const suffix = randomUUID();

  await assert.rejects(
    sql.begin(async (tx) => {
      const [category] = await tx<{ id: number }[]>`
        INSERT INTO categories (slug, path, depth, name_en, name_fa, product_count)
        VALUES (${`integrity-${suffix}`}, ${`integrity-${suffix}`}, 0,
                'Integrity Test', 'آزمایش', 1)
        RETURNING id
      `;
      const [family] = await tx<{ id: number }[]>`
        INSERT INTO product_families (
          slug, category_id, name_en, name_fa, product_count
        ) VALUES (
          ${`integrity-family-${suffix}`}, ${category.id},
          'Integrity Family', 'خانواده آزمایش', 1
        ) RETURNING id
      `;
      await tx`
        INSERT INTO spec_defs (family_id, key, label_en, label_fa, kind, filterable)
        VALUES (${family.id}, 'diameter', 'Diameter', 'قطر', 'number', true)
      `;
      const partNumber = `P2-${suffix}`;
      const [product] = await tx<{ id: number }[]>`
        INSERT INTO products (
          part_number, family_id, specs, price_cents,
          inventory_available, inventory_on_hold, inventory_sold
        ) VALUES (
          ${partNumber}, ${family.id}, '{"diameter": 0.03125}'::jsonb, 100,
          8, 2, 0
        ) RETURNING id
      `;
      await tx`
        INSERT INTO product_spec_values (
          product_id, family_id, spec_key, val_text, val_num
        ) VALUES (${product.id}, ${family.id}, 'diameter', '0.0313', 0.03125)
      `;
      const [user] = await tx<{ id: string }[]>`
        INSERT INTO users (email, password_hash)
        VALUES (${`integrity-${suffix}@example.invalid`}, 'not-a-real-hash')
        RETURNING id
      `;
      const [order] = await tx<{ id: number }[]>`
        INSERT INTO orders (
          submission_key, ref, user_id, company, contact_name, email,
          locale, currency, requested_total_cents, total_cents, status
        ) VALUES (
          ${randomUUID()}, ${`ORD-${suffix.slice(0, 6).toUpperCase()}`}, ${user.id},
          'Integrity Test', 'Test Buyer', 'buyer@example.invalid',
          'en', 'USD', 200, 200, 'received'
        ) RETURNING id
      `;
      const [item] = await tx<{ id: number }[]>`
        INSERT INTO order_items (
          order_id, product_id, part_number, family_name, qty,
          requested_unit_price_cents, unit_price_cents
        ) VALUES (
          ${order.id}, ${product.id}, ${partNumber}, 'Integrity Family', 2, 100, 100
        ) RETURNING id
      `;

      assert.deepEqual(await inspectDatabaseIntegrity(tx), {
        caseVariantSkuGroups: 0,
        orphanOrderUsers: 0,
        invalidCategories: 0,
        invalidFamilies: 0,
        invalidProducts: 0,
        invalidCartItems: 0,
        invalidOrderItems: 0,
        invalidOrderAmounts: 0,
        ordersWithoutItems: 0,
        orderTotalMismatches: 0,
        orderLifecycleMismatches: 0,
        familyCountMismatches: 0,
        categoryCountMismatches: 0,
        facetMismatches: 0,
        inventoryLedgerMismatches: 0,
      });

      await expectDetected(
        tx,
        async (sp) => {
          await sp`UPDATE product_families SET product_count = 2 WHERE id = ${family.id}`;
          await sp`UPDATE categories SET product_count = 2 WHERE id = ${category.id}`;
        },
        (report) => {
          assert.equal(report.familyCountMismatches, 1);
          assert.equal(report.categoryCountMismatches, 1);
        },
      );
      await expectDetected(
        tx,
        (sp) => sp`
          UPDATE product_spec_values SET val_text = 'wrong'
          WHERE product_id = ${product.id} AND spec_key = 'diameter'
        `,
        (report) => assert.equal(report.facetMismatches, 1),
      );

      /*
       * Switching a column from text to number is the one case where the facet
       * writer sees a JSON *string* under a numeric column — the importer only
       * ever stores JSON numbers there. The verifier used to decide numeric-ness
       * from `jsonb_typeof`, so it read every such row as drift and the repair
       * below then stripped the `val_num` that makes the new range filter work.
       * Both now share `NUMERIC_SPEC_PATTERN`.
       */
      await assert.rejects(
        tx.savepoint(async (sp) => {
          await sp`
            INSERT INTO spec_defs (family_id, key, label_en, label_fa, kind, filterable)
            VALUES (${family.id}, 'thread', 'Thread', 'رزوه', 'text', true)
          `;
          await sp`
            UPDATE products SET specs = specs || '{"thread": "12.50"}'::jsonb
            WHERE id = ${product.id}
          `;
          await sp`
            INSERT INTO product_spec_values (
              product_id, family_id, spec_key, val_text, val_num
            ) VALUES (${product.id}, ${family.id}, 'thread', '12.50', NULL)
          `;
          assert.equal((await inspectDatabaseIntegrity(sp)).facetMismatches, 0);

          await saveColumnsInTransaction(
            sp,
            family.id,
            [
              {
                key: "thread",
                labelEn: "Thread",
                labelFa: "رزوه",
                unit: "",
                kind: "number",
                filterable: true,
                inTable: true,
                inDetail: false,
                mobile: false,
              },
            ],
            [],
          );

          const [written] = await sp<{ valText: string; valNum: number | null }[]>`
            SELECT val_text AS "valText", val_num AS "valNum"
            FROM product_spec_values
            WHERE product_id = ${product.id} AND spec_key = 'thread'
          `;
          // The range filter the admin just asked for needs val_num populated.
          assert.deepEqual(written, { valText: "12.5", valNum: 12.5 });
          assert.equal(
            (await inspectDatabaseIntegrity(sp)).facetMismatches,
            0,
            "the verifier must accept what saveColumns writes for a kind change",
          );

          // And reconciliation must leave that row alone rather than repair it.
          const repaired = await reconcileDerivedData(sp);
          assert.equal(repaired.changes.facetRowsDeleted, 0);
          assert.equal(repaired.changes.facetRowsUpserted, 0);

          throw new RollBackSavepoint();
        }),
        RollBackSavepoint,
      );

      /*
       * A value that is not a number keeps its text under a numeric column. The
       * decimal point in the shared pattern has to be escaped for that: a
       * template literal eats the backslash in `\.`, which would turn it into
       * "any character", match `10x5`, and raise on `::numeric`.
       */
      await assert.rejects(
        tx.savepoint(async (sp) => {
          await sp`
            INSERT INTO spec_defs (family_id, key, label_en, label_fa, kind, filterable)
            VALUES (${family.id}, 'size', 'Size', 'اندازه', 'text', true)
          `;
          await sp`
            UPDATE products SET specs = specs || '{"size": "10x5"}'::jsonb
            WHERE id = ${product.id}
          `;
          await sp`
            INSERT INTO product_spec_values (
              product_id, family_id, spec_key, val_text, val_num
            ) VALUES (${product.id}, ${family.id}, 'size', '10x5', NULL)
          `;

          await saveColumnsInTransaction(
            sp,
            family.id,
            [
              {
                key: "size",
                labelEn: "Size",
                labelFa: "اندازه",
                unit: "",
                kind: "number",
                filterable: true,
                inTable: true,
                inDetail: false,
                mobile: false,
              },
            ],
            [],
          );

          const [written] = await sp<{ valText: string; valNum: number | null }[]>`
            SELECT val_text AS "valText", val_num AS "valNum"
            FROM product_spec_values
            WHERE product_id = ${product.id} AND spec_key = 'size'
          `;
          assert.deepEqual(written, { valText: "10x5", valNum: null });
          assert.equal((await inspectDatabaseIntegrity(sp)).facetMismatches, 0);

          throw new RollBackSavepoint();
        }),
        RollBackSavepoint,
      );
      await expectDetected(
        tx,
        (sp) => sp`
          UPDATE products SET inventory_on_hold = 3 WHERE id = ${product.id}
        `,
        (report) => assert.equal(report.inventoryLedgerMismatches, 1),
      );
      await expectDetected(
        tx,
        async (sp) => {
          await sp`ALTER TABLE orders DROP CONSTRAINT orders_user_id_users_id_fk`;
          await sp`UPDATE orders SET user_id = ${randomUUID()} WHERE id = ${order.id}`;
        },
        (report) => assert.equal(report.orphanOrderUsers, 1),
      );
      await expectDetected(
        tx,
        async (sp) => {
          await sp`ALTER TABLE orders DROP CONSTRAINT orders_invoice_fields_check`;
          await sp`ALTER TABLE orders DROP CONSTRAINT orders_status_timestamps_check`;
          await sp`UPDATE orders SET invoice_number = 'BROKEN' WHERE id = ${order.id}`;
        },
        (report) => assert.equal(report.orderLifecycleMismatches, 1),
      );
      await expectDetected(
        tx,
        (sp) => sp`UPDATE orders SET total_cents = 201 WHERE id = ${order.id}`,
        (report) => assert.equal(report.orderTotalMismatches, 1),
      );

      await assert.rejects(
        tx.savepoint((sp) => sp`
          INSERT INTO products (part_number, family_id, specs, price_cents)
          VALUES (${partNumber.toLowerCase()}, ${family.id}, '{}'::jsonb, 100)
        `),
        postgresCode("23505"),
      );
      await assert.rejects(
        tx.savepoint((sp) => sp`
          UPDATE orders SET user_id = ${randomUUID()} WHERE id = ${order.id}
        `),
        postgresCode("23503"),
      );
      await assert.rejects(
        tx.savepoint((sp) => sp`UPDATE order_items SET qty = 0 WHERE id = ${item.id}`),
        postgresCode("23514"),
      );
      await assert.rejects(
        tx.savepoint((sp) => sp`
          UPDATE products
          SET price_tiers = '[{"minQty": 0, "priceCents": -1}]'::jsonb
          WHERE id = ${product.id}
        `),
        postgresCode("23514"),
      );
      await assert.rejects(
        tx.savepoint((sp) => sp`
          UPDATE orders SET invoice_number = 'BROKEN' WHERE id = ${order.id}
        `),
        postgresCode("23514"),
      );
      await assert.rejects(
        tx.savepoint((sp) => sp`
          UPDATE orders SET currency = 'IRT' WHERE id = ${order.id}
        `),
        postgresCode("23514"),
      );
      await assert.rejects(
        tx.savepoint((sp) => sp`
          UPDATE orders
          SET status = 'invoiced', invoice_number = ${`INV-STAGE-${suffix}`},
              fx_rate_to_rial = 10000, invoiced_at = now(), paid_at = now()
          WHERE id = ${order.id}
        `),
        postgresCode("23514"),
      );

      await assert.rejects(
        tx.savepoint(async (sp) => {
          await sp`UPDATE products SET inventory_on_hold = 5 WHERE id = ${product.id}`;
          assert.equal(await reconcileInventoryForProducts(sp, [product.id]), 1);
          assert.equal((await inspectDatabaseIntegrity(sp)).inventoryLedgerMismatches, 0);
          throw new RollBackSavepoint();
        }),
        RollBackSavepoint,
      );

      await tx`UPDATE product_families SET product_count = 5 WHERE id = ${family.id}`;
      await tx`UPDATE categories SET product_count = 5 WHERE id = ${category.id}`;
      await tx`
        UPDATE product_spec_values SET val_text = 'wrong'
        WHERE product_id = ${product.id} AND spec_key = 'diameter'
      `;
      await tx`UPDATE products SET inventory_on_hold = 5 WHERE id = ${product.id}`;

      const reconciled = await reconcileDerivedData(tx);
      assert.equal(reconciled.before.familyCountMismatches, 1);
      assert.equal(reconciled.before.categoryCountMismatches, 1);
      assert.equal(reconciled.before.facetMismatches, 1);
      assert.equal(reconciled.before.inventoryLedgerMismatches, 1);
      assert.deepEqual(reconciled.after, {
        caseVariantSkuGroups: 0,
        orphanOrderUsers: 0,
        invalidCategories: 0,
        invalidFamilies: 0,
        invalidProducts: 0,
        invalidCartItems: 0,
        invalidOrderItems: 0,
        invalidOrderAmounts: 0,
        ordersWithoutItems: 0,
        orderTotalMismatches: 0,
        orderLifecycleMismatches: 0,
        familyCountMismatches: 0,
        categoryCountMismatches: 0,
        facetMismatches: 0,
        inventoryLedgerMismatches: 0,
      });
      assert.deepEqual(reconciled.changes, {
        familyCounts: 1,
        categoryCounts: 1,
        facetRowsDeleted: 0,
        facetRowsUpserted: 1,
        inventoryRows: 1,
      });

      throw new RollBackFixture();
    }),
    RollBackFixture,
  );
});

after(async () => {
  await sql.end({ timeout: 5 });
});
