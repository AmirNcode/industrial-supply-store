import "server-only";
import { sql } from "./index";
import type { ImportSpecDef } from "@/lib/importCsv";

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
