import "dotenv/config";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, targetHost } from "@/db/script-client";

/**
 * Re-applies `src/db/extensions.sql`.
 *
 * `drizzle-kit push` drops every object in that file on every run — the
 * full-text and trigram indexes behind search, two expression indexes, the
 * partial unique index on `invoice_number`, and `invoice_seq`. drizzle-kit
 * cannot express any of them, so it reads them as drift.
 *
 * This used to be a paragraph in a plan telling whoever ran push to remember a
 * follow-up command. Two of those objects fail silently when missing rather
 * than loudly: without `users_email_lower_key`, `createUser` stops detecting
 * duplicate accounts, because it decides "email-taken" purely by catching the
 * unique violation; and `invoice_seq`, recreated from scratch, restarts at 1
 * and re-issues an invoice number that already exists. So `db:push` runs this
 * itself, and the sequence is realigned past whatever has already been issued.
 */
async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  console.log(`→ target: ${targetHost()}`);
  await sql.unsafe(readFileSync(join(here, "../src/db/extensions.sql"), "utf8"));

  const [{ next }] = await sql<{ next: number }[]>`
    SELECT COALESCE(
      max(split_part(invoice_number, '-', 3)::int), 0
    ) AS next FROM orders WHERE invoice_number IS NOT NULL
  `;
  await sql`SELECT setval('invoice_seq', ${next === 0 ? 1 : next}, ${next !== 0})`;

  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_indexes
    WHERE indexname IN (
      'products_fts_idx','products_part_number_trgm_idx',
      'families_name_en_trgm_idx','families_name_fa_trgm_idx',
      'categories_name_en_trgm_idx','categories_name_fa_trgm_idx',
      'categories_path_prefix_idx','psv_product_idx',
      'orders_invoice_number_key','orders_email_ref_idx','users_email_lower_key'
    )
  `;
  console.log(`✓ ${n}/11 extension indexes present, invoice_seq at ${next}`);

  // `drizzle-kit push` emits DISABLE ROW LEVEL SECURITY for every table on
  // every run, so this is checked rather than assumed.
  const unprotected = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND NOT rowsecurity
    ORDER BY tablename
  `;
  console.log(
    unprotected.length === 0
      ? "✓ row-level security enabled on every table"
      : `✗ RLS OFF on: ${unprotected.map((r) => r.tablename).join(", ")}`,
  );

  if (n !== 11) {
    console.error("✗ an extension index is missing — search or account uniqueness is broken");
    process.exit(1);
  }
  if (unprotected.length > 0) process.exit(1);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
