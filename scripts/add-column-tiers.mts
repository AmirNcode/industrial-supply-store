import "dotenv/config";
import { sql, targetHost } from "@/db/script-client";

/**
 * Add the columns that let a family's spec columns be defined from the admin
 * panel: the table/detail split, the remembered CSV header mappings, and the
 * product image and document fields.
 *
 * Written out rather than left to `drizzle-kit push` for the reason recorded in
 * `docs/DEPLOYMENT.md`: push reconciles by diffing the live database against
 * the schema file, and everything it cannot model in that file — the expression
 * indexes, `invoice_seq`, row-level security — reads as drift and is dropped.
 * `npm run db:push` repairs that afterwards by re-applying `extensions.sql`,
 * but this change needs none of it. Every statement here is additive, so there
 * is nothing to repair and nothing at risk.
 *
 * No `assertSafeTarget` guard: unlike the reset and rename scripts this
 * destroys nothing, and running it twice is a no-op. The target host is printed
 * so it is still obvious what was touched.
 *
 * Safe to run twice.
 */
async function main() {
  console.log(`→ target: ${targetHost()}`);

  await sql.begin(async (tx) => {
    console.log("→ spec_defs: display tier and remembered CSV header");
    await tx.unsafe(`
      ALTER TABLE spec_defs
        ADD COLUMN IF NOT EXISTS display text NOT NULL DEFAULT 'table',
        ADD COLUMN IF NOT EXISTS csv_alias text;
    `);

    // Every column that existed before tiering keeps rendering where it did,
    // which is what makes this invisible on the day it lands.
    await tx.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'spec_defs_display_check'
        ) THEN
          ALTER TABLE spec_defs ADD CONSTRAINT spec_defs_display_check
            CHECK (display IN ('table', 'detail'));
        END IF;
      END $$;
    `);

    console.log("→ product_families: remembered header mappings");
    await tx.unsafe(`
      ALTER TABLE product_families
        ADD COLUMN IF NOT EXISTS field_aliases jsonb NOT NULL DEFAULT '{}'::jsonb;
    `);

    console.log("→ products: image and documents");
    await tx.unsafe(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);
  });

  const [{ ok }] = await sql<{ ok: number }[]>`
    SELECT count(*)::int AS ok
    FROM information_schema.columns
    WHERE (table_name = 'spec_defs' AND column_name IN ('display', 'csv_alias'))
       OR (table_name = 'product_families' AND column_name = 'field_aliases')
       OR (table_name = 'products' AND column_name IN ('image_url', 'documents'))
  `;
  if (ok !== 5) {
    console.error(`\n✗ Expected 5 new columns, found ${ok}.\n`);
    process.exit(1);
  }

  console.log("✓ 5 columns present");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
