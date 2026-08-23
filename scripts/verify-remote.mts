/**
 * Sanity-checks a deployed database after `db:migrate:remote` (or a one-time
 * `db:bootstrap:empty:remote` for a genuinely blank database).
 *
 * Run: npm run db:verify:remote
 *
 * Checks the things that fail silently rather than loudly: row counts, and
 * whether the trigram/FTS indexes actually exist. On Supabase, `pg_trgm` is
 * preinstalled into an `extensions` schema, so `CREATE EXTENSION IF NOT EXISTS`
 * succeeds while `gin_trgm_ops` may still fail to resolve — which would leave
 * autocomplete and fuzzy part-number search quietly unindexed.
 */
import "dotenv/config";
import postgres from "postgres";
import { inspectDatabaseIntegrity, integrityProblems } from "@/db/dataIntegrity";

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
  "app_settings", "order_comments", "request_rate_limits",
] as const;

/**
 * Columns added after their table existed.
 *
 * A table-presence check cannot see these: `products` has been there since the
 * first seed, so a database missing the inventory columns still counts as
 * present and the script would report success while every admin products page
 * errored. Anything added by a later `ADD COLUMN` needs listing here.
 */
const COLUMNS: readonly (readonly [string, string])[] = [
  ["products", "inventory_available"],
  ["products", "inventory_on_hold"],
  ["products", "inventory_sold"],
  ["orders", "fx_rate_to_toman"],
  ["orders", "invoice_number"],
  ["orders", "user_id"],
  ["orders", "submission_key"],
  // Added 2026-08-12 by `db:column-tiers`. Every family page selects
  // spec_defs.display and products.documents, so a build that ships before the
  // script has run errors on the whole catalog, not just on admin.
  ["spec_defs", "display"],
  ["spec_defs", "mobile"],
  ["spec_defs", "csv_alias"],
  ["product_families", "field_aliases"],
  ["products", "image_url"],
  ["categories", "image_url"],
  ["categories", "is_visible"],
  ["product_families", "image_url"],
  ["product_families", "is_visible"],
  ["products", "documents"],
  // Added 2026-08-20 by `20260820093000_add_catalog_descriptions.sql`. Every
  // category and family page selects these to draw the description callout, so
  // a database without them fails at prerender, not only in admin.
  ["categories", "about_en"],
  ["categories", "about_fa"],
  ["categories", "diagram_url"],
  ["product_families", "diagram_url"],
  // Added 2026-08-20 by `20260820154500_split_column_display.sql`. Every
  // catalog route selects these to decide where a spec column renders.
  ["spec_defs", "in_table"],
  ["spec_defs", "in_detail"],
];

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

const cols = await sql<{ table_name: string; column_name: string }[]>`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema = 'public'
`;
const haveCols = new Set(cols.map((r) => `${r.table_name}.${r.column_name}`));
const missingCols = COLUMNS.filter(([t, c]) => !haveCols.has(`${t}.${c}`));
console.log(
  `columns     ${COLUMNS.length - missingCols.length}/${COLUMNS.length} ${
    missingCols.length === 0
      ? "✓"
      : `✗ MISSING ${missingCols.map(([t, c]) => `${t}.${c}`).join(", ")}`
  }`,
);

/** The objects `drizzle-kit push` drops on every run and cannot re-create. */
const EXTENSION_OBJECTS = [
  "products_fts_idx", "products_normalized_fts_idx", "products_part_number_trgm_idx",
  "products_part_number_upper_key",
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

const hasSubmissionIndex = haveObjs.has("orders_submission_key_key");
console.log(`submission key ${hasSubmissionIndex ? "unique index ✓" : "✗ UNIQUE INDEX MISSING"}`);

const REQUIRED_CONSTRAINTS = [
  "categories_depth_check", "categories_product_count_check",
  "product_families_product_count_check",
  "products_part_number_check", "products_price_cents_check",
  "products_price_tiers_check", "products_pack_qty_check",
  "products_lead_days_check", "products_inventory_on_hold_check",
  "products_inventory_sold_check", "cart_items_qty_check",
  "orders_user_id_users_id_fk", "orders_status_check", "orders_totals_check",
  "orders_invoice_fields_check", "orders_timestamp_chain_check",
  "orders_status_timestamps_check", "order_items_qty_check", "order_items_prices_check",
  "request_rate_limits_count_check",
] as const;
const constraintRows = await sql<{ conname: string; convalidated: boolean }[]>`
  SELECT c.conname, c.convalidated
  FROM pg_constraint c
  JOIN pg_namespace ns ON ns.oid = c.connamespace
  WHERE ns.nspname = 'public' AND c.conname = ANY(${[...REQUIRED_CONSTRAINTS]})
`;
const constraintState = new Map(
  constraintRows.map((row) => [row.conname, row.convalidated]),
);
const missingConstraints = REQUIRED_CONSTRAINTS.filter(
  (name) => !constraintState.has(name),
);
const unvalidatedConstraints = REQUIRED_CONSTRAINTS.filter(
  (name) => constraintState.get(name) === false,
);
console.log(
  `constraints ${REQUIRED_CONSTRAINTS.length - missingConstraints.length}/${REQUIRED_CONSTRAINTS.length} ${
    missingConstraints.length > 0
      ? `✗ MISSING ${missingConstraints.join(", ")}`
      : unvalidatedConstraints.length > 0
        ? `✗ NOT VALIDATED ${unvalidatedConstraints.join(", ")}`
        : "validated ✓"
  }`,
);

const [{ hasRateLimitPrimaryKey }] = await sql<{ hasRateLimitPrimaryKey: boolean }[]>`
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.request_rate_limits')
      AND c.contype = 'p'
      AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (scope, identity_hash)'
  ) AS "hasRateLimitPrimaryKey"
`;
const hasRateLimitExpiryIndex = haveObjs.has("request_rate_limits_expires_idx");
console.log(
  `rate limits  ${
    hasRateLimitPrimaryKey && hasRateLimitExpiryIndex
      ? "indexes ✓"
      : `✗ MISSING ${[
          !hasRateLimitPrimaryKey && "primary key (scope, identity_hash)",
          !hasRateLimitExpiryIndex && "request_rate_limits_expires_idx",
        ].filter(Boolean).join(", ")}`
  }`,
);

const [{ hasMigrationLedger }] = await sql<{ hasMigrationLedger: boolean }[]>`
  SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
    AS "hasMigrationLedger"
`;
const REQUIRED_MIGRATIONS = [
  "20260817010000",
  "20260817020000",
  "20260818025101",
  "20260820093000",
  "20260820154500",
] as const;
let recordedMigrations = new Set<string>();
if (hasMigrationLedger) {
  const rows = await sql<{ version: string }[]>`
    SELECT version FROM supabase_migrations.schema_migrations
    WHERE version = ANY(${[...REQUIRED_MIGRATIONS]})
  `;
  recordedMigrations = new Set(rows.map((row) => row.version));
}
const missingMigrations = REQUIRED_MIGRATIONS.filter(
  (version) => !recordedMigrations.has(version),
);
console.log(
  `migration ledger ${
    missingMigrations.length === 0
      ? `${REQUIRED_MIGRATIONS.join(", ")} ✓`
      : hasMigrationLedger
        ? `✗ not recorded: ${missingMigrations.join(", ")}`
        : "✗ MISSING"
  }`,
);

const [{ hasSeq }] = await sql<{ hasSeq: boolean }[]>`
  SELECT to_regclass('public.invoice_seq') IS NOT NULL AS "hasSeq"
`;
console.log(`invoice_seq ${hasSeq ? "✓" : "✗ MISSING — invoice numbers will restart at 1"}`);

// queries.ts calls these in every search and suggest query; without them the
// search page and /api/suggest 500 outright. They are dropped-and-forgotten
// candidates just like the indexes, so they are checked, not assumed.
const CATALOG_FUNCTIONS = [
  "catalog_search_words", "catalog_search_compact",
  "catalog_prefix_tsquery", "catalog_search_rank",
] as const;
const fnRows = await sql<{ proname: string }[]>`
  SELECT proname FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
`;
const haveFns = new Set(fnRows.map((r) => r.proname));
const missingFns = CATALOG_FUNCTIONS.filter((f) => !haveFns.has(f));
console.log(
  `search fns  ${CATALOG_FUNCTIONS.length - missingFns.length}/${CATALOG_FUNCTIONS.length} ${
    missingFns.length === 0
      ? "✓"
      : `✗ MISSING ${missingFns.join(", ")} — search 500s, run db:extensions:remote`
  }`,
);

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
if (missingTables.length > 0 || missingCols.length > 0) {
  console.log("\n✗ schema incomplete — only an empty database may use db:bootstrap:empty:remote");
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

const integrity = await inspectDatabaseIntegrity(sql);
const integrityIssues = integrityProblems(integrity);
console.log(
  integrityIssues.length === 0
    ? "integrity   canonical and derived data agree ✓"
    : `integrity   ✗ ${integrityIssues.join("; ")}`,
);

const idx = await sql<{ indexname: string }[]>`
  SELECT indexname FROM pg_indexes
  WHERE schemaname = 'public'
    AND (indexname LIKE '%trgm%' OR indexname LIKE '%fts%')
  ORDER BY indexname
`;
const expected = 7; // 2 FTS + 1 part number + 4 name indexes
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
  missingFns.length === 0 &&
  missingCols.length === 0 &&
  missingConstraints.length === 0 &&
  unvalidatedConstraints.length === 0 &&
  hasSubmissionIndex &&
  hasRateLimitPrimaryKey &&
  hasRateLimitExpiryIndex &&
  missingMigrations.length === 0 &&
  hasSeq &&
  rlsOff.length === 0 &&
  integrityIssues.length === 0 &&
  !have.has("quotes");
console.log(ok ? "\n✓ database looks correct" : "\n✗ something is wrong above");

await sql.end();
process.exit(ok ? 0 : 1);
