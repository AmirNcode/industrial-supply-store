import "server-only";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import type { ImportSpecDef, ImportRow } from "@/lib/importCsv";
import { plannedAliases, plannedDefs, type ImportPlan } from "@/lib/columnPlan";
import type { FieldAliases } from "./schema";
import { reconcileInventoryForProducts } from "./dataIntegrity";

/**
 * A family's spec column, in full.
 *
 * `filterable` is what the write half needs — only a filterable spec becomes a
 * row in `product_spec_values`, which is the facet index. The labels and the
 * two placement flags are what the analyzer needs, so a header matching an
 * existing column can keep the settings someone already chose for it.
 */
export type FamilySpecDef = ImportSpecDef & {
  labelEn: string;
  labelFa: string;
  unit: string;
  filterable: boolean;
  inTable: boolean;
  inDetail: boolean;
  csvAlias: string | null;
};

export type FamilyForImport = {
  id: number;
  slug: string;
  nameEn: string;
  nameFa: string;
  categoryId: number;
  categoryNameEn: string;
  categoryNameFa: string;
  categoryPath: string;
  fieldAliases: FieldAliases;
  defs: FamilySpecDef[];
};

export async function getFamilyForImport(id: number): Promise<FamilyForImport | null> {
  if (!Number.isInteger(id) || id <= 0) return null;

  const [families, defs] = await Promise.all([
    sql<Omit<FamilyForImport, "defs">[]>`
      SELECT f.id, f.slug, f.name_en AS "nameEn", f.name_fa AS "nameFa",
             f.field_aliases AS "fieldAliases",
             c.id AS "categoryId", c.name_en AS "categoryNameEn",
             c.name_fa AS "categoryNameFa", c.path AS "categoryPath"
      FROM product_families f
      JOIN categories c ON c.id = f.category_id
      WHERE f.id = ${id}
    `,
    sql<FamilySpecDef[]>`
      SELECT key, label_en AS "labelEn", label_fa AS "labelFa", unit, kind,
             filterable, in_table AS "inTable", in_detail AS "inDetail",
             csv_alias AS "csvAlias"
      FROM spec_defs WHERE family_id = ${id} ORDER BY sort, id
    `,
  ]);
  const family = families[0];
  if (!family) return null;
  return { ...family, defs };
}

/**
 * How many products would lose a value if a column were deleted.
 *
 * Shown next to each removable column so "delete this column" is a decision
 * about known data rather than a guess.
 */
export async function countProductsWithSpec(
  familyId: number,
  keys: readonly string[],
): Promise<Record<string, number>> {
  if (keys.length === 0) return {};
  const rows = await sql<{ key: string; n: number }[]>`
    SELECT k.key, count(*)::int AS n
    FROM products p
    JOIN unnest(${keys as string[]}::text[]) AS k(key) ON p.specs ? k.key
    WHERE p.family_id = ${familyId}
      AND p.specs ->> k.key <> ''
    GROUP BY k.key
  `;
  const out: Record<string, number> = {};
  for (const key of keys) out[key] = 0;
  for (const r of rows) out[r.key] = r.n;
  return out;
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
  categoryImageUrl: string;
  categoryIsVisible: boolean;
  imageUrl: string;
  isVisible: boolean;
  inventoryAvailable: number;
  inventoryOnHold: number;
  inventorySold: number;
  /** Products with a past order against them, for the delete confirmation. */
  orderedProducts: number;
};

export async function getFamiliesGrouped(): Promise<FamilyListRow[]> {
  return sql<FamilyListRow[]>`
    SELECT f.id, f.slug, f.name_en AS "nameEn", f.name_fa AS "nameFa",
           f.product_count AS "productCount", f.image_url AS "imageUrl",
           f.is_visible AS "isVisible",
           c.id AS "categoryId", c.name_en AS "categoryNameEn",
           c.name_fa AS "categoryNameFa", c.image_url AS "categoryImageUrl",
           c.is_visible AS "categoryIsVisible",
           COALESCE(s.available, 0)::int AS "inventoryAvailable",
           COALESCE(s.on_hold, 0)::int   AS "inventoryOnHold",
           COALESCE(s.sold, 0)::int      AS "inventorySold",
           COALESCE(o.n, 0)::int         AS "orderedProducts"
    FROM product_families f
    JOIN categories c ON c.id = f.category_id
    -- Same shape as the stock roll-up: one pass, not a subquery per family.
    LEFT JOIN (
      SELECT p.family_id, count(DISTINCT p.id) AS n
      FROM products p JOIN order_items i ON i.product_id = p.id
      GROUP BY p.family_id
    ) o ON o.family_id = f.id
    -- Aggregated once per family rather than per product: this page lists
    -- every family, and a per-row subquery would be one scan each.
    LEFT JOIN (
      SELECT family_id,
             SUM(inventory_available) AS available,
             SUM(inventory_on_hold)   AS on_hold,
             SUM(inventory_sold)      AS sold
      FROM products GROUP BY family_id
    ) s ON s.family_id = f.id
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
  inventoryAvailable: number;
  inventoryOnHold: number;
  inventorySold: number;
  imageUrl: string;
};

export async function getProductsForExport(familyId: number): Promise<ExportProduct[]> {
  return sql<ExportProduct[]>`
    SELECT part_number AS "partNumber", specs, price_cents AS "priceCents",
           pack_qty AS "packQty", lead_days AS "leadDays", in_stock AS "inStock",
           inventory_available AS "inventoryAvailable",
           inventory_on_hold AS "inventoryOnHold",
           inventory_sold AS "inventorySold", image_url AS "imageUrl"
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
    String(p.inventoryAvailable),
    String(p.inventoryOnHold),
    String(p.inventorySold),
    p.imageUrl,
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
  /** Products deleted because `replace` mode and the file did not mention them. */
  removed: number;
  /** Either of the two lists above being non-empty means nothing was written. */
  /**
   * Rows whose uploaded on_hold/sold disagree with what the order flow says
   * they should be. Reported *after* a successful write, not instead of one:
   * the file is the operator's stated intent, and refusing it would make a
   * stale export impossible to correct. The warning is so a disagreement is
   * noticed rather than absorbed.
   */
  mismatches: InventoryMismatch[];
};

export type InventoryMismatch = {
  partNumber: string;
  column: "inventory_on_hold" | "inventory_sold";
  uploaded: number;
  computed: number;
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

/** The handle `sql.begin` hands its callback — a connection pinned to the transaction. */
type Tx = TransactionSql<Record<string, never>>;

/**
 * Bring a family's column definitions in line with a confirmed plan.
 *
 * Runs inside the caller's transaction, before any product is written, so the
 * rows land against the columns the plan describes.
 *
 * Deleting a column is four things, not one, and skipping any of them leaves
 * the catalog wrong in a way that still renders:
 *
 *   1. the `spec_defs` row — the heading disappears;
 *   2. the key inside every `products.specs` — otherwise the value is still
 *      there, invisible, and comes back if the column is ever re-added;
 *   3. the `product_spec_values` rows — the facet index, which is what filter
 *      queries actually read, so a stale row keeps offering a filter that
 *      matches a value no page displays;
 *   4. `products.search_text` — a product still findable by a spec it no
 *      longer has.
 */
async function syncColumns(tx: Tx, family: FamilyForImport, plan: ImportPlan) {
  const defs = plannedDefs(plan);
  const familyId = family.id;

  for (let i = 0; i < defs.length; i += CHUNK) {
    const chunk = defs.slice(i, i + CHUNK);
    await tx`
      INSERT INTO spec_defs (family_id, key, label_en, label_fa, unit, kind,
                             filterable, sort, in_table, in_detail, csv_alias)
      SELECT ${familyId}, u.key, u.label_en, u.label_fa, u.unit, u.kind,
             u.filterable::boolean, u.sort, u.in_table::boolean,
             u.in_detail::boolean, NULLIF(u.csv_alias, '')
      FROM unnest(
        ${chunk.map((d) => d.key)}::text[],
        ${chunk.map((d) => d.labelEn)}::text[],
        ${chunk.map((d) => d.labelFa)}::text[],
        ${chunk.map((d) => d.unit)}::text[],
        ${chunk.map((d) => d.kind)}::text[],
        -- Text then cast, as elsewhere: postgres-js infers no boolean array.
        ${chunk.map((d) => (d.filterable ? "t" : "f"))}::text[],
        ${chunk.map((d) => d.sort)}::int[],
        ${chunk.map((d) => (d.inTable ? "t" : "f"))}::text[],
        ${chunk.map((d) => (d.inDetail ? "t" : "f"))}::text[],
        ${chunk.map((d) => d.csvAlias ?? "")}::text[]
      ) AS u(key, label_en, label_fa, unit, kind, filterable, sort, in_table,
             in_detail, csv_alias)
      ON CONFLICT (family_id, key) DO UPDATE SET
        label_en = EXCLUDED.label_en,
        label_fa = EXCLUDED.label_fa,
        unit = EXCLUDED.unit,
        kind = EXCLUDED.kind,
        filterable = EXCLUDED.filterable,
        sort = EXCLUDED.sort,
        in_table = EXCLUDED.in_table,
        in_detail = EXCLUDED.in_detail,
        csv_alias = EXCLUDED.csv_alias
    `;
  }

  if (plan.dropKeys.length > 0) {
    const drop = plan.dropKeys;
    await tx`
      DELETE FROM spec_defs WHERE family_id = ${familyId} AND key = ANY(${drop}::text[])
    `;
    await tx`
      DELETE FROM product_spec_values
      WHERE family_id = ${familyId} AND spec_key = ANY(${drop}::text[])
    `;
    await tx`
      UPDATE products SET specs = specs - ${drop}::text[]
      WHERE family_id = ${familyId} AND specs ?| ${drop}::text[]
    `;
    /*
     * Rebuild the search document for the whole family.
     *
     * Products the upload does not mention keep their old `search_text`, which
     * still names the values just stripped out of `specs`. This is the same
     * document `buildSearchText` composes in TypeScript; the spec values come
     * out of jsonb in a different order, which does not matter to a full-text
     * index.
     */
    await tx`
      UPDATE products p SET search_text = left(
        concat_ws(' ', p.part_number, ${family.nameEn}, ${family.nameFa},
                  ${family.categoryNameEn}, ${family.categoryNameFa},
                  (SELECT string_agg(v.value, ' ')
                   FROM jsonb_each_text(p.specs) AS v
                   WHERE v.value <> '')),
        2000)
      WHERE p.family_id = ${familyId}
    `;
  }

  await tx`
    UPDATE product_families
    SET field_aliases = ${JSON.stringify(plannedAliases(plan))}::jsonb
    WHERE id = ${familyId}
  `;
}

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
  /**
   * Given when the upload also redefines the family's columns. The column
   * changes and the row writes share this one transaction on purpose: a family
   * whose columns changed but whose products did not — or the reverse — is a
   * catalog that renders headings with no values under them.
   */
  plan?: ImportPlan,
): Promise<ImportResult> {
  const family = await getFamilyForImport(familyId);
  if (!family) throw new Error(`No family ${familyId}`);
  if (rows.length === 0) {
    return { inserted: 0, updated: 0, removed: 0, conflicts: [], caseVariants: [], mismatches: [] };
  }

  // The facet index has to be built from the columns as the plan leaves them,
  // not as they were: a column this upload marks filterable for the first time
  // would otherwise import with no facet rows and silently filter to nothing.
  const effective = plan ? plannedDefs(plan) : family.defs;
  const filterable = new Set(effective.filter((d) => d.filterable).map((d) => d.key));
  const numeric = new Set(effective.filter((d) => d.kind === "number").map((d) => d.key));

  try {
    return await sql.begin(async (tx) => {
      if (plan) await syncColumns(tx, family, plan);

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
                                pack_qty, lead_days, in_stock, search_text,
                                inventory_available, inventory_on_hold,
                                inventory_sold, sort)
          SELECT u.part_number, ${familyId}, u.specs, u.price_cents, u.pack_qty,
                 u.lead_days, u.in_stock::boolean, u.search_text,
                 u.inv_available, u.inv_on_hold, u.inv_sold,
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
            ${chunk.map((r) => buildSearchText(r.partNumber, family, r.specs))}::text[],
            ${chunk.map((r) => r.inventoryAvailable)}::int[],
            ${chunk.map((r) => r.inventoryOnHold)}::int[],
            ${chunk.map((r) => r.inventorySold)}::int[]
          ) WITH ORDINALITY AS u(part_number, specs, price_cents, pack_qty,
                                 lead_days, in_stock, search_text,
                                 inv_available, inv_on_hold, inv_sold, ord)
          -- family_id is deliberately absent from the update list: a part
          -- number that already exists elsewhere was refused above, so
          -- reaching here means the family already matches.
          ON CONFLICT (part_number) DO UPDATE SET
            specs = EXCLUDED.specs,
            price_cents = EXCLUDED.price_cents,
            pack_qty = EXCLUDED.pack_qty,
            lead_days = EXCLUDED.lead_days,
            in_stock = EXCLUDED.in_stock,
            search_text = EXCLUDED.search_text,
            inventory_available = EXCLUDED.inventory_available,
            inventory_on_hold = EXCLUDED.inventory_on_hold,
            inventory_sold = EXCLUDED.inventory_sold
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

      /*
       * Images and documents are written separately, and only for the rows
       * that carried them.
       *
       * Both columns are `NOT NULL`, so the upsert above cannot tell "the file
       * had no such column" from "the cell was blank" — everything arrives as
       * a default. That difference is the whole point here: neither column is
       * in the template, so a routine price edit exported to Excel and uploaded
       * back mentions neither, and must leave both alone rather than erase
       * every product's documents.
       */
      const withImage = rows.filter((r) => r.imageUrl !== undefined);
      if (withImage.length > 0) {
        for (let i = 0; i < withImage.length; i += CHUNK) {
          const chunk = withImage.slice(i, i + CHUNK);
          await tx`
            UPDATE products p SET image_url = u.image_url
            FROM unnest(
              ${chunk.map((r) => r.partNumber)}::text[],
              ${chunk.map((r) => r.imageUrl as string)}::text[]
            ) AS u(part_number, image_url)
            WHERE p.part_number = u.part_number AND p.family_id = ${familyId}
          `;
        }
      }

      const withDocs = rows.filter((r) => r.documents !== undefined);
      if (withDocs.length > 0) {
        for (let i = 0; i < withDocs.length; i += CHUNK) {
          const chunk = withDocs.slice(i, i + CHUNK);
          await tx`
            UPDATE products p SET documents = u.documents::jsonb
            FROM unnest(
              ${chunk.map((r) => r.partNumber)}::text[],
              ${chunk.map((r) => JSON.stringify(r.documents))}::text[]
            ) AS u(part_number, documents)
            WHERE p.part_number = u.part_number AND p.family_id = ${familyId}
          `;
        }
      }

      /*
       * `replace` deletes what the file does not mention.
       *
       * A supplier sending a new catalog for a family is often replacing the
       * line, not amending it — the old rows have none of the new columns and
       * render as a block of blanks beside the new ones. Deleting them is the
       * only way to be rid of that, and it happens inside this transaction so a
       * failure later leaves them in place.
       *
       * Orders are unaffected: `order_items` snapshots the part number, family
       * name and specs at submission, and holds `product_id` with ON DELETE SET
       * NULL. `product_spec_values` cascades.
       */
      let removed = 0;
      if (plan?.mode === "replace") {
        const gone = await tx<{ id: number }[]>`
          DELETE FROM products
          WHERE family_id = ${familyId} AND id <> ALL(${touched}::int[])
          RETURNING id
        `;
        removed = gone.length;
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

      // Every ancestor of the family's category has to move, not just the
      // leaf. Clear first so replacing the last product in a branch sets its
      // count to zero rather than leaving the previous non-zero value behind.
      await tx`UPDATE categories SET product_count = 0`;
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

      /*
       * What the order flow says on_hold and sold should be.
       *
       * `on_hold` is everything ordered but not yet paid for; `sold` is
       * everything paid. A pre-payment cancellation counts as neither. A paid
       * order cancelled before shipping remains sold because this version has
       * no refund/restock transition; `paid_at` preserves that history after
       * the status changes to cancelled.
       */
      const computed = await tx<
        { partNumber: string; onHold: number; sold: number }[]
      >`
        SELECT p.part_number AS "partNumber",
               COALESCE(SUM(i.qty) FILTER (
                 WHERE o.status IN ('received', 'invoiced')), 0)::int AS "onHold",
               COALESCE(SUM(i.qty) FILTER (
                 WHERE o.paid_at IS NOT NULL), 0)::int AS "sold"
        FROM products p
        LEFT JOIN order_items i ON i.product_id = p.id
        LEFT JOIN orders o ON o.id = i.order_id
        WHERE p.id = ANY(${touched}::int[])
        GROUP BY p.part_number
      `;

      const mismatches: InventoryMismatch[] = [];
      const uploaded = new Map(rows.map((r) => [r.partNumber, r]));
      for (const c of computed) {
        const row = uploaded.get(c.partNumber);
        if (!row) continue;
        if (row.inventoryOnHold !== c.onHold) {
          mismatches.push({
            partNumber: c.partNumber,
            column: "inventory_on_hold",
            uploaded: row.inventoryOnHold,
            computed: c.onHold,
          });
        }
        if (row.inventorySold !== c.sold) {
          mismatches.push({
            partNumber: c.partNumber,
            column: "inventory_sold",
            uploaded: row.inventorySold,
            computed: c.sold,
          });
        }
      }

      // Orders are the source of truth for held and sold quantities. Preserve
      // the total stock the operator uploaded, but move it between the three
      // buckets according to the ledger so an import cannot reintroduce drift.
      await reconcileInventoryForProducts(tx, touched);

      return { inserted, updated, removed, conflicts: [], caseVariants: [], mismatches };
    });
  } catch (e) {
    if (e instanceof ImportRefused) {
      return {
        inserted: 0,
        updated: 0,
        removed: 0,
        conflicts: e.conflicts,
        caseVariants: e.caseVariants,
        mismatches: [],
      };
    }
    throw e;
  }
}
