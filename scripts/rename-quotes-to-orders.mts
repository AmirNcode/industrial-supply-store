import "dotenv/config";
import { sql, assertSafeTarget, targetHost } from "@/db/script-client";

/**
 * One-shot migration from the RFQ model to the order model.
 *
 * This is deliberately not left to `drizzle-kit push`. Push reconciles by
 * diffing, and a rename looks identical to "drop this table, create that one" —
 * which would silently destroy every submitted request. Renaming explicitly,
 * before push ever sees the schema, is the only safe order.
 *
 * Safe to run twice: every statement checks whether it has already happened.
 */
async function main() {
  assertSafeTarget("rename quotes to orders", "ALLOW_REMOTE_MIGRATION");
  console.log(`→ target: ${targetHost()}`);

  const [{ exists: hasQuotes }] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'quotes'
    ) AS exists
  `;

  await sql.begin(async (tx) => {
    if (hasQuotes) {
      console.log("→ renaming tables, columns, indexes and sequences");
      await tx.unsafe(`
        ALTER TABLE quotes RENAME TO orders;
        ALTER TABLE quote_items RENAME TO order_items;
        ALTER TABLE order_items RENAME COLUMN quote_id TO order_id;
        ALTER INDEX IF EXISTS quotes_ref_key RENAME TO orders_ref_key;
        ALTER INDEX IF EXISTS quotes_created_idx RENAME TO orders_created_idx;
        ALTER INDEX IF EXISTS quote_items_quote_idx RENAME TO order_items_order_idx;
        ALTER SEQUENCE IF EXISTS quotes_id_seq RENAME TO orders_id_seq;
        ALTER SEQUENCE IF EXISTS quote_items_id_seq RENAME TO order_items_id_seq;
      `);
    } else {
      console.log("→ tables already renamed, skipping");
    }

    console.log("→ adding order columns");
    await tx.unsafe(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS user_id uuid,
        ADD COLUMN IF NOT EXISTS requested_total_cents integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS payment_url text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS courier text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS tracking_number text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS invoice_number text,
        ADD COLUMN IF NOT EXISTS fx_rate_to_toman integer,
        ADD COLUMN IF NOT EXISTS invoiced_at timestamptz,
        ADD COLUMN IF NOT EXISTS paid_at timestamptz,
        ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
        ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

      ALTER TABLE order_items
        ADD COLUMN IF NOT EXISTS requested_unit_price_cents integer NOT NULL DEFAULT 0;
    `);

    console.log("→ backfilling");
    await tx.unsafe(`
      UPDATE orders SET requested_total_cents = total_cents
        WHERE requested_total_cents = 0;
      UPDATE order_items SET requested_unit_price_cents = unit_price_cents
        WHERE requested_unit_price_cents = 0;
      UPDATE orders SET status = 'received' WHERE status = 'submitted';
      UPDATE orders SET ref = 'ORD-' || substring(ref from 5) WHERE ref LIKE 'RFQ-%';
    `);

    console.log("→ renaming constraints");
    // `ALTER TABLE ... RENAME` leaves constraint names behind, so the primary
    // and foreign keys are still called `quotes_pkey` and
    // `quote_items_quote_id_quotes_id_fk`. drizzle-kit diffs on those names:
    // left alone, its next push would propose dropping and recreating the
    // primary key of a table holding live orders. Postgres has no
    // `RENAME CONSTRAINT ... IF EXISTS`, hence the guards.
    await tx.unsafe(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_pkey') THEN
          ALTER TABLE orders RENAME CONSTRAINT quotes_pkey TO orders_pkey;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_items_pkey') THEN
          ALTER TABLE order_items RENAME CONSTRAINT quote_items_pkey TO order_items_pkey;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'quote_items_quote_id_quotes_id_fk') THEN
          ALTER TABLE order_items
            RENAME CONSTRAINT quote_items_quote_id_quotes_id_fk
                           TO order_items_order_id_orders_id_fk;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'quote_items_product_id_products_id_fk') THEN
          ALTER TABLE order_items
            RENAME CONSTRAINT quote_items_product_id_products_id_fk
                           TO order_items_product_id_products_id_fk;
        END IF;
      END $$;
    `);

    console.log("→ constraints, indexes and the invoice sequence");
    await tx.unsafe(`
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
      ALTER TABLE orders ADD CONSTRAINT orders_status_check
        CHECK (status IN ('received','invoiced','preparing','shipped',
                          'delivered','cancelled'));

      CREATE UNIQUE INDEX IF NOT EXISTS orders_invoice_number_key
        ON orders (invoice_number) WHERE invoice_number IS NOT NULL;
      CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS orders_email_ref_idx ON orders (lower(email), ref);

      CREATE SEQUENCE IF NOT EXISTS invoice_seq;
    `);
  });

  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders`;
  console.log(`✓ done — ${n} orders`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
