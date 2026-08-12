import "dotenv/config";
import { sql, targetHost } from "@/db/script-client";

/**
 * Add catalog artwork and visibility without asking drizzle-kit to reconcile
 * unrelated production objects. Every statement is additive and idempotent.
 */
async function main() {
  console.log(`→ target: ${targetHost()}`);

  await sql.begin(async (tx) => {
    console.log("→ categories: image URL and catalog visibility");
    await tx.unsafe(`
      ALTER TABLE categories
        ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true;
    `);

    console.log("→ product_families: image URL and catalog visibility");
    await tx.unsafe(`
      ALTER TABLE product_families
        ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true;
    `);
  });

  const [{ ok }] = await sql<{ ok: number }[]>`
    SELECT count(*)::int AS ok
    FROM information_schema.columns
    WHERE (table_name = 'categories' AND column_name IN ('image_url', 'is_visible'))
       OR (table_name = 'product_families' AND column_name IN ('image_url', 'is_visible'))
  `;
  if (ok !== 4) {
    console.error(`\n✗ Expected 4 catalog media columns, found ${ok}.\n`);
    process.exit(1);
  }

  console.log("✓ 4 catalog media columns present");
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
