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
  counts.c > 0 && counts.p > 0 && idx.length >= expected && parts.length > 0;
console.log(ok ? "\n✓ database looks correct" : "\n✗ something is wrong above");

await sql.end();
process.exit(ok ? 0 : 1);
