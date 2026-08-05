import "server-only";
import { sql } from "./index";
import type { ImportSpecDef, ImportRow } from "@/lib/importCsv";

/**
 * `filterable` rides along because the write half needs it: only a filterable
 * spec becomes a row in `product_spec_values`, which is the facet index.
 */
export type FamilySpecDef = ImportSpecDef & { filterable: boolean };

export type FamilyForImport = {
  id: number;
  slug: string;
  nameEn: string;
  nameFa: string;
  categoryId: number;
  categoryNameEn: string;
  categoryNameFa: string;
  categoryPath: string;
  defs: FamilySpecDef[];
};

export async function getFamilyForImport(id: number): Promise<FamilyForImport | null> {
  if (!Number.isInteger(id) || id <= 0) return null;

  const [family] = await sql<Omit<FamilyForImport, "defs">[]>`
    SELECT f.id, f.slug, f.name_en AS "nameEn", f.name_fa AS "nameFa",
           c.id AS "categoryId", c.name_en AS "categoryNameEn",
           c.name_fa AS "categoryNameFa", c.path AS "categoryPath"
    FROM product_families f
    JOIN categories c ON c.id = f.category_id
    WHERE f.id = ${id}
  `;
  if (!family) return null;

  const defs = await sql<FamilySpecDef[]>`
    SELECT key, kind, filterable
    FROM spec_defs WHERE family_id = ${id} ORDER BY sort, id
  `;
  return { ...family, defs };
}

export type FamilyListRow = {
  id: number;
  slug: string;
  nameEn: string;
  nameFa: string;
  productCount: number;
  categoryId: number;
  categoryNameEn: string;
  categoryNameFa: string;
};

export async function getFamiliesGrouped(): Promise<FamilyListRow[]> {
  return sql<FamilyListRow[]>`
    SELECT f.id, f.slug, f.name_en AS "nameEn", f.name_fa AS "nameFa",
           f.product_count AS "productCount",
           c.id AS "categoryId", c.name_en AS "categoryNameEn",
           c.name_fa AS "categoryNameFa"
    FROM product_families f
    JOIN categories c ON c.id = f.category_id
    ORDER BY c.sort, c.id, f.sort, f.id
  `;
}

export type ExportProduct = {
  partNumber: string;
  specs: Record<string, unknown>;
  priceCents: number;
  packQty: number;
  leadDays: number;
  inStock: boolean;
};

export async function getProductsForExport(familyId: number): Promise<ExportProduct[]> {
  return sql<ExportProduct[]>`
    SELECT part_number AS "partNumber", specs, price_cents AS "priceCents",
           pack_qty AS "packQty", lead_days AS "leadDays", in_stock AS "inStock"
    FROM products WHERE family_id = ${familyId} ORDER BY sort, id
  `;
}

/**
 * How a spec value is written into a CSV cell and into `val_text`.
 *
 * Matches `specValueToText` in `src/seed/index.ts` — the four-decimal clamp is
 * what stops a stored 0.06999999999999999 from being written back as an
 * eighteen-digit string that no longer matches the facet it came from.
 */
export function specCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(Number(value.toFixed(4)));
  return String(value);
}

/**
 * One product as a CSV record, in `columnsFor(defs)` order.
 *
 * Shared by the template and the export so the two files have identical
 * columns — that is what lets an export be edited and uploaded back.
 */
export function exportRow(p: ExportProduct, defs: readonly FamilySpecDef[]): string[] {
  return [
    p.partNumber,
    ...defs.map((d) => specCell(p.specs[d.key])),
    (p.priceCents / 100).toFixed(2),
    String(p.packQty),
    String(p.leadDays),
    p.inStock ? "yes" : "no",
  ];
}

/**
 * Search text, matching `buildSearchText` in `src/seed/index.ts`.
 *
 * Kept identical on purpose: a product written here and a product written by
 * the seeder have to be findable by the same query, and two conventions for
 * one column is how that stops being true.
 */
function buildSearchText(
  partNumber: string,
  family: FamilyForImport,
  specs: Record<string, string | number>,
): string {
  const specText = Object.values(specs)
    .filter((v) => v !== null && v !== "")
    .map((v) => String(v))
    .join(" ");
  return [
    partNumber,
    family.nameEn,
    family.nameFa,
    family.categoryNameEn,
    family.categoryNameFa,
    specText,
  ]
    .join(" ")
    .slice(0, 2000);
}

export type ImportResult = {
  inserted: number;
  updated: number;
  /** Part numbers that already exist in a different family. */
  conflicts: string[];
  /** Part numbers that exist already but spelled with different case, which
   *  the upsert would duplicate rather than update. Each entry is the
   *  catalog's spelling, so the fix is to copy it. */
  caseVariants: string[];
  /** Either list being non-empty means nothing at all was written. */
};

/** Thrown to roll the transaction back; never escapes this module. */
class ImportRefused extends Error {
  constructor(
    readonly conflicts: string[],
    readonly caseVariants: string[],
  ) {
    super("import refused");
  }
}

/** Postgres caps a statement's size, and the seeder already settled on this. */
const CHUNK = 800;

/**
 * Write an import in one transaction.
 *
 * Five things move together, and dropping any one leaves the catalog wrong in
 * a way that still renders:
 *
 *   1. `products` — the row itself.
 *   2. `products.search_text` — the full-text column; stale text means the
 *      product cannot be found by its own new specs.
 *   3. `product_spec_values` — the facet index. Filters read this, not
 *      `products.specs`, so skipping it makes filtered results silently wrong
 *      while every page still looks fine.
 *   4. `product_families.product_count` — shown on every family tile.
 *   5. `categories.product_count` — rolled up to every ancestor.
 *
 * All-or-nothing, like the parse: a part number already owned by a different
 * family aborts the whole import rather than being moved, because silently
 * relocating a SKU between families is worse than refusing the file.
 */
export async function writeImport(
  familyId: number,
  rows: readonly ImportRow[],
): Promise<ImportResult> {
  const family = await getFamilyForImport(familyId);
  if (!family) throw new Error(`No family ${familyId}`);
  if (rows.length === 0) {
    return { inserted: 0, updated: 0, conflicts: [], caseVariants: [] };
  }

  const filterable = new Set(family.defs.filter((d) => d.filterable).map((d) => d.key));
  const numeric = new Set(family.defs.filter((d) => d.kind === "number").map((d) => d.key));

  try {
    return await sql.begin(async (tx) => {
      const parts = rows.map((r) => r.partNumber);

      // Matched case-insensitively, because ON CONFLICT below is not.
      //
      // The unique index is on the raw column, so uploading "abc-100" where
      // the catalog holds "ABC-100" does not conflict — it inserts a second
      // product with the same part number in a different case, which every
      // lookup in the app (all of which upper-case first) would then find
      // twice. Refusing is the only outcome here that is not a guess about
      // which spelling was meant.
      //
      // Checked inside the transaction so the rest of it sees the same
      // snapshot, and so an abort here rolls back rather than half-writes.
      const existing = await tx<{ partNumber: string; familyId: number }[]>`
        SELECT part_number AS "partNumber", family_id AS "familyId"
        FROM products
        WHERE upper(part_number) = ANY(${parts.map((p) => p.toUpperCase())}::text[])
      `;
      const typedAs = new Map(rows.map((r) => [r.partNumber.toUpperCase(), r.partNumber]));
      const conflicts: string[] = [];
      const caseVariants: string[] = [];
      for (const e of existing) {
        if (e.familyId !== familyId) conflicts.push(e.partNumber);
        else if (typedAs.get(e.partNumber.toUpperCase()) !== e.partNumber) {
          caseVariants.push(e.partNumber);
        }
      }
      if (conflicts.length > 0 || caseVariants.length > 0) {
        throw new ImportRefused(conflicts, caseVariants);
      }

      // New products land after whatever is already in the family, so a
      // partial file cannot reshuffle the products it does not mention.
      const [{ maxSort }] = await tx<{ maxSort: number }[]>`
        SELECT COALESCE(MAX(sort), 0)::int AS "maxSort"
        FROM products WHERE family_id = ${familyId}
      `;

      let inserted = 0;
      let updated = 0;
      const touched: number[] = [];

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const result = await tx<{ id: number; inserted: boolean }[]>`
          INSERT INTO products (part_number, family_id, specs, price_cents,
                                pack_qty, lead_days, in_stock, search_text, sort)
          SELECT u.part_number, ${familyId}, u.specs, u.price_cents, u.pack_qty,
                 u.lead_days, u.in_stock::boolean, u.search_text,
                 ${maxSort + i} + u.ord
          FROM unnest(
            ${chunk.map((r) => r.partNumber)}::text[],
            ${chunk.map((r) => JSON.stringify(r.specs))}::jsonb[],
            ${chunk.map((r) => r.priceCents)}::int[],
            ${chunk.map((r) => r.packQty)}::int[],
            ${chunk.map((r) => r.leadDays)}::int[],
            -- Sent as text and cast here: postgres-js has no boolean-array
            -- type to infer, so a boolean[] parameter arrives as a scalar
            -- boolean and Postgres refuses the cast.
            ${chunk.map((r) => (r.inStock ? "t" : "f"))}::text[],
            ${chunk.map((r) => buildSearchText(r.partNumber, family, r.specs))}::text[]
          ) WITH ORDINALITY AS u(part_number, specs, price_cents, pack_qty,
                                 lead_days, in_stock, search_text, ord)
          -- family_id is deliberately absent from the update list: a part
          -- number that already exists elsewhere was refused above, so
          -- reaching here means the family already matches.
          ON CONFLICT (part_number) DO UPDATE SET
            specs = EXCLUDED.specs,
            price_cents = EXCLUDED.price_cents,
            pack_qty = EXCLUDED.pack_qty,
            lead_days = EXCLUDED.lead_days,
            in_stock = EXCLUDED.in_stock,
            search_text = EXCLUDED.search_text
          -- xmax is 0 on a fresh insert and the updating transaction's id
          -- otherwise; it is the only way to tell the two apart from one
          -- statement.
          RETURNING id, (xmax = 0) AS inserted
        `;
        for (const r of result) {
          touched.push(r.id);
          if (r.inserted) inserted++;
          else updated++;
        }
      }

      // Replace rather than merge: a spec that lost its value in the file must
      // lose its facet row too, or the product stays filterable under a value
      // it no longer has.
      await tx`DELETE FROM product_spec_values WHERE product_id = ANY(${touched}::int[])`;

      const byPart = new Map(rows.map((r) => [r.partNumber, r]));
      const idRows = await tx<{ id: number; partNumber: string }[]>`
        SELECT id, part_number AS "partNumber" FROM products
        WHERE id = ANY(${touched}::int[])
      `;

      const psv: { productId: number; key: string; text: string; num: number | null }[] = [];
      for (const { id, partNumber } of idRows) {
        const row = byPart.get(partNumber);
        if (!row) continue;
        for (const [key, value] of Object.entries(row.specs)) {
          if (!filterable.has(key)) continue;
          if (value === "" || value === null || value === undefined) continue;
          psv.push({
            productId: id,
            key,
            text: specCell(value),
            num: numeric.has(key) && typeof value === "number" ? value : null,
          });
        }
      }

      for (let i = 0; i < psv.length; i += CHUNK) {
        const chunk = psv.slice(i, i + CHUNK);
        await tx`
          INSERT INTO product_spec_values (product_id, family_id, spec_key, val_text, val_num)
          SELECT u.product_id, ${familyId}, u.spec_key, u.val_text,
                 NULLIF(u.val_num, '')::double precision
          FROM unnest(
            ${chunk.map((r) => r.productId)}::int[],
            ${chunk.map((r) => r.key)}::text[],
            ${chunk.map((r) => r.text)}::text[],
            -- Also text: an all-null numeric array gives postgres-js nothing
            -- to infer an element type from.
            ${chunk.map((r) => (r.num === null ? "" : String(r.num)))}::text[]
          ) AS u(product_id, spec_key, val_text, val_num)
        `;
      }

      await tx`
        UPDATE product_families SET product_count =
          (SELECT count(*)::int FROM products WHERE family_id = ${familyId})
        WHERE id = ${familyId}
      `;

      // The seeder's roll-up, unchanged. Every ancestor of the family's
      // category has to move, not just the leaf.
      await tx`
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
      `;

      return { inserted, updated, conflicts: [], caseVariants: [] };
    });
  } catch (e) {
    if (e instanceof ImportRefused) {
      return {
        inserted: 0,
        updated: 0,
        conflicts: e.conflicts,
        caseVariants: e.caseVariants,
      };
    }
    throw e;
  }
}
