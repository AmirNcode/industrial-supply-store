import "dotenv/config";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, sql, assertSafeTarget, targetHost } from "@/db/script-client";
import {
  categories,
  productFamilies,
  specDefs as specDefsTable,
  products as productsTable,
  productSpecValues,
} from "@/db/schema";
import type { SpecBag } from "@/db/schema";
import { TAXONOMY } from "./taxonomy";
import { generateFamily } from "./generate";
import type { CategorySeed } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Postgres caps a statement at 65535 bind parameters; stay well under it. */
async function insertChunked<T extends Record<string, unknown>>(
  table: Parameters<typeof db.insert>[0],
  rows: T[],
  perChunk = 800,
) {
  for (let i = 0; i < rows.length; i += perChunk) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(table).values(rows.slice(i, i + perChunk) as any);
  }
}

function specValueToText(v: unknown): string {
  if (typeof v === "number") return String(Number(v.toFixed(4)));
  return String(v ?? "");
}

async function main() {
  // TRUNCATE ... CASCADE wipes the whole catalog, carts and submitted quotes.
  // Seeding a hosted database is a supported workflow, but it has to be asked
  // for rather than happening because DATABASE_URL was still exported.
  assertSafeTarget("truncate and reseed the catalog", "ALLOW_REMOTE_SEED");

  const t0 = Date.now();
  console.log(`→ target: ${targetHost()}`);
  console.log("→ applying extensions and expression indexes");
  const ext = readFileSync(join(__dirname, "../db/extensions.sql"), "utf8");
  await sql.unsafe(ext);

  console.log("→ clearing existing catalog");
  // RESTART IDENTITY so part numbers and ids are identical on every reseed.
  await sql.unsafe(`
    TRUNCATE product_spec_values, products, spec_defs, product_families,
             cart_items, carts, quote_items, quotes, categories
    RESTART IDENTITY CASCADE
  `);

  // ---- categories ---------------------------------------------------------
  type CatRow = { id: number; seed: CategorySeed; path: string };
  const flatCats: CatRow[] = [];

  async function insertCat(
    seed: CategorySeed,
    parentId: number | null,
    parentPath: string,
    depth: number,
    sort: number,
  ): Promise<CatRow> {
    const path = parentPath ? `${parentPath}/${seed.slug}` : seed.slug;
    const [row] = await db
      .insert(categories)
      .values({
        slug: seed.slug,
        parentId,
        path,
        depth,
        nameEn: seed.en,
        nameFa: seed.fa,
        icon: seed.icon ?? "box",
        sort,
      })
      .returning({ id: categories.id });
    const rec = { id: row.id, seed, path };
    flatCats.push(rec);
    let childSort = 0;
    for (const child of seed.children ?? []) {
      await insertCat(child, row.id, path, depth + 1, childSort++);
    }
    return rec;
  }

  console.log("→ inserting category tree");
  let topSort = 0;
  for (const top of TAXONOMY) {
    await insertCat(top, null, "", 0, topSort++);
  }
  console.log(`  ${flatCats.length} categories`);

  // ---- families, spec defs, products --------------------------------------
  console.log("→ generating product families");
  let familyIndex = 0;
  let totalProducts = 0;
  let totalSpecValues = 0;

  for (const cat of flatCats) {
    const fams = cat.seed.families ?? [];
    let famSort = 0;
    for (const f of fams) {
      const { specDefs, products } = generateFamily(f.slug, f.gen, familyIndex);
      familyIndex++;

      const [famRow] = await db
        .insert(productFamilies)
        .values({
          slug: f.slug,
          categoryId: cat.id,
          nameEn: f.en,
          nameFa: f.fa,
          descEn: f.descEn,
          descFa: f.descFa,
          aboutEn: f.aboutEn ?? "",
          aboutFa: f.aboutFa ?? "",
          icon: f.icon ?? cat.seed.icon ?? "box",
          sort: famSort++,
          productCount: products.length,
          groupEn: f.groupEn ?? "",
          groupFa: f.groupFa ?? "",
        })
        .returning({ id: productFamilies.id });

      await insertChunked(
        specDefsTable,
        specDefs.map((d) => ({ ...d, familyId: famRow.id })),
      );

      // Only spec keys that have a column definition become facets.
      const defByKey = new Map(specDefs.map((d) => [d.key, d]));

      const productRows = products.map((p) => ({
        partNumber: p.partNumber,
        familyId: famRow.id,
        specs: p.specs,
        priceCents: p.priceCents,
        priceTiers: p.priceTiers,
        packQty: p.packQty,
        leadDays: p.leadDays,
        inStock: p.inStock,
        sort: p.sort,
        searchText: buildSearchText(p.partNumber, f.en, f.fa, cat.seed, p.specs),
      }));

      // Need the generated ids back to write the facet index.
      const inserted: { id: number; partNumber: string }[] = [];
      for (let i = 0; i < productRows.length; i += 800) {
        const chunk = productRows.slice(i, i + 800);
        const res = await db
          .insert(productsTable)
          .values(chunk)
          .returning({ id: productsTable.id, partNumber: productsTable.partNumber });
        inserted.push(...res);
      }
      totalProducts += inserted.length;

      const idByPart = new Map(inserted.map((r) => [r.partNumber, r.id]));
      const psvRows: {
        productId: number;
        familyId: number;
        specKey: string;
        valText: string;
        valNum: number | null;
      }[] = [];

      for (const p of products) {
        const pid = idByPart.get(p.partNumber);
        if (!pid) continue;
        for (const [key, val] of Object.entries(p.specs)) {
          const def = defByKey.get(key);
          if (!def || !def.filterable) continue;
          if (val === null || val === undefined || val === "") continue;
          psvRows.push({
            productId: pid,
            familyId: famRow.id,
            specKey: key,
            valText: specValueToText(val),
            valNum: typeof val === "number" ? val : null,
          });
        }
      }
      await insertChunked(productSpecValues, psvRows, 1500);
      totalSpecValues += psvRows.length;

      process.stdout.write(
        `  ${f.slug}: ${inserted.length} products\r`.padEnd(80).slice(0, 80) + "\r",
      );
    }
  }

  console.log(`\n  ${familyIndex} families, ${totalProducts} products, ${totalSpecValues} facet rows`);

  // ---- roll product counts up the tree ------------------------------------
  console.log("→ rolling up category product counts");
  await sql.unsafe(`
    UPDATE categories c SET product_count = COALESCE(sub.n, 0)
    FROM (
      SELECT anc.id, SUM(f.product_count) AS n
      FROM categories anc
      JOIN categories desc_c
        ON desc_c.path = anc.path OR desc_c.path LIKE anc.path || '/%'
      JOIN product_families f ON f.category_id = desc_c.id
      GROUP BY anc.id
    ) sub
    WHERE c.id = sub.id
  `);

  console.log("→ analyzing");
  await sql.unsafe("ANALYZE");

  const [{ count: catCount }] = await sql`SELECT count(*)::int FROM categories`;
  const [{ count: famCount }] = await sql`SELECT count(*)::int FROM product_families`;
  const [{ count: prodCount }] = await sql`SELECT count(*)::int FROM products`;

  console.log(
    `\n✓ seeded ${catCount} categories, ${famCount} families, ${prodCount} products in ${(
      (Date.now() - t0) / 1000
    ).toFixed(1)}s`,
  );
  await sql.end();
}

/** Flattened text fed to the FTS index — part number, names, and spec values. */
function buildSearchText(
  partNumber: string,
  famEn: string,
  famFa: string,
  cat: CategorySeed,
  specs: SpecBag,
): string {
  const specText = Object.values(specs)
    .filter((v) => v !== null && v !== "")
    .map((v) => String(v))
    .join(" ");
  return [partNumber, famEn, famFa, cat.en, cat.fa, specText].join(" ").slice(0, 2000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
