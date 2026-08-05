/**
 * Sanity-checks a deployed database after `db:setup:remote`.
 *
 * Run: npm run db:verify:remote
 *
 * Checks the things that fail silently rather than loudly: row counts, and
 * whether the trigram/FTS indexes actually exist. On Supabase, `pg_trgm` is
 * preinstalled into an `extensions` schema, so `CREATE EXTENSION IF NOT EXISTS`
 * succeeds while `gin_trgm_ops` may still fail to resolve — which would leave
 * autocomplete and fuzzy part-number search quietly unindexed.
 */
import postgres from "postgres";

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("✗ No DIRECT_DATABASE_URL or DATABASE_URL set.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 2 });

/**
 * Schema first, and it has to come first.
 *
 * This script used to check only the catalog, so a database carrying products
 * but none of the accounts, orders or invoicing schema printed "✓ database
 * looks correct" — the most misleading moment possible, since it is read right
 * before a deploy.
 */
const TABLES = [
  "categories", "product_families", "products", "product_spec_values",
  "spec_defs", "carts", "cart_items", "orders", "order_items", "users",
  "app_settings",
] as const;

const present = await sql<{ name: string }[]>`
  SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'
`;
const have = new Set(present.map((r) => r.name));
const missingTables = TABLES.filter((t) => !have.has(t));
console.log(
  `tables      ${TABLES.length - missingTables.length}/${TABLES.length} ${
    missingTables.length === 0 ? "✓" : `✗ MISSING ${missingTables.join(", ")}`
  }`,
);

// `quotes` still existing means the rename has not been run. Pushing the schema
// over the top of it would create an empty `orders` and drop the real data.
if (have.has("quotes")) {
  console.log("            ✗ `quotes` still exists — run db:rename-orders:remote FIRST");
}

/** The objects `drizzle-kit push` drops on every run and cannot re-create. */
const EXTENSION_OBJECTS = [
  "products_fts_idx", "products_part_number_trgm_idx",
  "families_name_en_trgm_idx", "families_name_fa_trgm_idx",
  "categories_name_en_trgm_idx", "categories_name_fa_trgm_idx",
  "categories_path_prefix_idx", "psv_product_idx",
  "orders_invoice_number_key", "orders_email_ref_idx",
  "users_email_lower_key",
] as const;

const objs = await sql<{ indexname: string }[]>`
  SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
`;
const haveObjs = new Set(objs.map((r) => r.indexname));
const missingObjs = EXTENSION_OBJECTS.filter((o) => !haveObjs.has(o));
console.log(
  `extensions.sql ${EXTENSION_OBJECTS.length - missingObjs.length}/${
    EXTENSION_OBJECTS.length
  } ${missingObjs.length === 0 ? "✓" : `✗ MISSING ${missingObjs.join(", ")}`}`,
);

const [{ hasSeq }] = await sql<{ hasSeq: boolean }[]>`
  SELECT to_regclass('public.invoice_seq') IS NOT NULL AS "hasSeq"
`;
console.log(`invoice_seq ${hasSeq ? "✓" : "✗ MISSING — invoice numbers will restart at 1"}`);

// A managed provider's REST API reads these tables with a key that ships in
// browser code. `drizzle-kit push` turns RLS off on every run, so it is worth
// checking every time rather than once.
const rlsOff = await sql<{ tablename: string }[]>`
  SELECT tablename FROM pg_tables
  WHERE schemaname = 'public' AND NOT rowsecurity ORDER BY tablename
`;
console.log(
  rlsOff.length === 0
    ? "row-level security ✓ on every table"
    : `row-level security ✗ OFF on ${rlsOff.map((r) => r.tablename).join(", ")} — run db:extensions:remote`,
);

// Everything below reads the catalog tables, which is only meaningful once
// they exist.
if (missingTables.length > 0) {
  console.log("\n✗ schema incomplete — run db:push:remote before anything else");
  await sql.end();
  process.exit(1);
}

const [counts] = await sql<
  { c: number; f: number; p: number; v: number }[]
>`
  SELECT (SELECT count(*) FROM categories)::int          AS c,
         (SELECT count(*) FROM product_families)::int    AS f,
         (SELECT count(*) FROM products)::int            AS p,
         (SELECT count(*) FROM product_spec_values)::int AS v
`;

console.log(
  `rows        categories=${counts.c} families=${counts.f} products=${counts.p} facets=${counts.v}`,
);

const idx = await sql<{ indexname: string }[]>`
  SELECT indexname FROM pg_indexes
  WHERE schemaname = 'public'
    AND (indexname LIKE '%trgm%' OR indexname LIKE '%fts%')
  ORDER BY indexname
`;
const expected = 6; // 1 FTS + 1 part number + 4 name indexes
console.log(
  `search idx  ${idx.length}/${expected} ${idx.length >= expected ? "✓" : "✗ MISSING"}`,
);
if (idx.length < expected) console.log("            ", idx.map((r) => r.indexname));

const ext = await sql<{ extname: string; schema: string }[]>`
  SELECT extname, extnamespace::regnamespace::text AS schema
  FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')
`;
console.log(
  `extensions  ${ext.map((e) => `${e.extname}@${e.schema}`).join(" ") || "none ✗"}`,
);

let t = Date.now();
const parts = await sql<{ part_number: string }[]>`
  SELECT part_number FROM products
  WHERE part_number ILIKE '1000A%' ORDER BY part_number LIMIT 3
`;
console.log(
  `part search ${Date.now() - t}ms  ${parts.map((r) => r.part_number).join(", ") || "✗ none"}`,
);

t = Date.now();
const fams = await sql<{ name_en: string }[]>`
  SELECT name_en FROM product_families WHERE name_en ILIKE '%bearing%' LIMIT 3
`;
console.log(
  `name search ${Date.now() - t}ms  ${fams.length} hits ${fams.length ? "✓" : "✗"}`,
);

const ok =
  counts.c > 0 &&
  counts.p > 0 &&
  idx.length >= expected &&
  parts.length > 0 &&
  missingObjs.length === 0 &&
  hasSeq &&
  rlsOff.length === 0 &&
  !have.has("quotes");
console.log(ok ? "\n✓ database looks correct" : "\n✗ something is wrong above");

await sql.end();
process.exit(ok ? 0 : 1);
