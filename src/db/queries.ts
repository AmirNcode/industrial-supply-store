import "server-only";
import { sql } from "./index";
import type { SpecBag, PriceTier } from "./schema";

export type CategoryRow = {
  id: number;
  slug: string;
  path: string;
  depth: number;
  parentId: number | null;
  nameEn: string;
  nameFa: string;
  icon: string;
  productCount: number;
};

export type FamilyRow = {
  id: number;
  slug: string;
  categoryId: number;
  nameEn: string;
  nameFa: string;
  descEn: string;
  descFa: string;
  aboutEn: string;
  aboutFa: string;
  groupEn: string;
  groupFa: string;
  icon: string;
  productCount: number;
};

export type SpecDefRow = {
  key: string;
  labelEn: string;
  labelFa: string;
  unit: string;
  kind: "number" | "text";
  filterable: boolean;
  sort: number;
};

export type ProductRow = {
  id: number;
  partNumber: string;
  specs: SpecBag;
  priceCents: number;
  priceTiers: PriceTier[];
  packQty: number;
  leadDays: number;
  inStock: boolean;
};

export type FacetValue = { value: string; num: number | null; count: number };
export type Facet = { key: string; values: FacetValue[] };

/** Active filters parsed from the query string: specKey -> selected values. */
export type Filters = Record<string, string[]>;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function getTopCategories(): Promise<CategoryRow[]> {
  return sql<CategoryRow[]>`
    SELECT id, slug, path, depth, parent_id AS "parentId",
           name_en AS "nameEn", name_fa AS "nameFa", icon,
           product_count AS "productCount"
    FROM categories WHERE depth = 0 ORDER BY sort
  `;
}

export async function getCategoryByPath(path: string): Promise<CategoryRow | null> {
  const rows = await sql<CategoryRow[]>`
    SELECT id, slug, path, depth, parent_id AS "parentId",
           name_en AS "nameEn", name_fa AS "nameFa", icon,
           product_count AS "productCount"
    FROM categories WHERE path = ${path} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getChildren(parentId: number): Promise<CategoryRow[]> {
  return sql<CategoryRow[]>`
    SELECT id, slug, path, depth, parent_id AS "parentId",
           name_en AS "nameEn", name_fa AS "nameFa", icon,
           product_count AS "productCount"
    FROM categories WHERE parent_id = ${parentId} ORDER BY sort
  `;
}

/**
 * Every category down to `maxDepth`, in one query, for building the home grid.
 * Cheap enough (under 100 rows) that fetching the whole tree beats N queries.
 */
export async function getCategoriesToDepth(maxDepth: number): Promise<CategoryRow[]> {
  return sql<CategoryRow[]>`
    SELECT id, slug, path, depth, parent_id AS "parentId",
           name_en AS "nameEn", name_fa AS "nameFa", icon,
           product_count AS "productCount"
    FROM categories WHERE depth <= ${maxDepth} ORDER BY depth, sort
  `;
}

/** Ancestor chain for breadcrumbs, root first, excluding the category itself. */
export async function getAncestors(path: string): Promise<CategoryRow[]> {
  const parts = path.split("/");
  const paths = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
  if (paths.length === 0) return [];
  return sql<CategoryRow[]>`
    SELECT id, slug, path, depth, parent_id AS "parentId",
           name_en AS "nameEn", name_fa AS "nameFa", icon,
           product_count AS "productCount"
    FROM categories WHERE path = ANY(${paths}) ORDER BY depth
  `;
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

const FAMILY_COLS = sql`
  f.id, f.slug, f.category_id AS "categoryId",
  f.name_en AS "nameEn", f.name_fa AS "nameFa",
  f.desc_en AS "descEn", f.desc_fa AS "descFa",
  f.about_en AS "aboutEn", f.about_fa AS "aboutFa",
  f.group_en AS "groupEn", f.group_fa AS "groupFa",
  f.icon, f.product_count AS "productCount"
`;

/** Families anywhere at or below a category, so mid-tree pages are never empty. */
export async function getFamiliesInSubtree(path: string): Promise<FamilyRow[]> {
  return sql<FamilyRow[]>`
    SELECT ${FAMILY_COLS}
    FROM product_families f
    JOIN categories c ON c.id = f.category_id
    WHERE c.path = ${path} OR c.path LIKE ${path + "/%"}
    ORDER BY c.sort, f.sort
  `;
}

export async function getFamilyBySlug(slug: string): Promise<FamilyRow | null> {
  const rows = await sql<FamilyRow[]>`
    SELECT ${FAMILY_COLS} FROM product_families f WHERE f.slug = ${slug} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getSpecDefs(familyId: number): Promise<SpecDefRow[]> {
  return sql<SpecDefRow[]>`
    SELECT key, label_en AS "labelEn", label_fa AS "labelFa", unit, kind,
           filterable, sort
    FROM spec_defs WHERE family_id = ${familyId} ORDER BY sort
  `;
}

// ---------------------------------------------------------------------------
// Filtering and faceting
// ---------------------------------------------------------------------------

/**
 * Every active filter becomes its own EXISTS against the facet index. Values
 * within one spec are OR'd, different specs are AND'd — the standard behavior
 * a buyer expects from "Buna-N or Viton, in 70A".
 */
function filterClause(familyId: number, filters: Filters) {
  const entries = Object.entries(filters).filter(([, v]) => v.length > 0);
  if (entries.length === 0) return sql`p.family_id = ${familyId}`;
  let clause = sql`p.family_id = ${familyId}`;
  for (const [key, values] of entries) {
    clause = sql`${clause} AND EXISTS (
      SELECT 1 FROM product_spec_values v
      WHERE v.product_id = p.id AND v.spec_key = ${key}
        AND v.val_text = ANY(${values})
    )`;
  }
  return clause;
}

export async function countProducts(
  familyId: number,
  filters: Filters,
): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM products p WHERE ${filterClause(familyId, filters)}
  `;
  return rows[0]?.n ?? 0;
}

export async function getProducts(
  familyId: number,
  filters: Filters,
  limit: number,
  offset: number,
): Promise<ProductRow[]> {
  return sql<ProductRow[]>`
    SELECT p.id, p.part_number AS "partNumber", p.specs,
           p.price_tiers AS "priceTiers", p.price_cents AS "priceCents",
           p.pack_qty AS "packQty", p.lead_days AS "leadDays",
           p.in_stock AS "inStock"
    FROM products p
    WHERE ${filterClause(familyId, filters)}
    ORDER BY p.sort
    LIMIT ${limit} OFFSET ${offset}
  `;
}

/**
 * Facet counts over the *currently filtered* set, which is why values vanish as
 * the buyer narrows — the same behavior as the reference site. Computing them
 * against the unfiltered set instead would show options that yield zero results.
 */
export async function getFacets(
  familyId: number,
  filters: Filters,
): Promise<Facet[]> {
  const rows = await sql<
    { specKey: string; valText: string; valNum: number | null; n: number }[]
  >`
    WITH matched AS (
      SELECT p.id FROM products p WHERE ${filterClause(familyId, filters)}
    )
    SELECT v.spec_key AS "specKey", v.val_text AS "valText",
           v.val_num AS "valNum", count(*)::int AS n
    FROM product_spec_values v
    JOIN matched m ON m.id = v.product_id
    GROUP BY 1, 2, 3
    ORDER BY v.spec_key, v.val_num NULLS LAST, v.val_text
  `;

  const byKey = new Map<string, FacetValue[]>();
  for (const r of rows) {
    if (!byKey.has(r.specKey)) byKey.set(r.specKey, []);
    byKey.get(r.specKey)!.push({ value: r.valText, num: r.valNum, count: r.n });
  }
  return [...byKey.entries()].map(([key, values]) => ({ key, values }));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type Suggestion =
  | { type: "category"; path: string; nameEn: string; nameFa: string; count: number }
  | { type: "family"; slug: string; nameEn: string; nameFa: string; count: number }
  | { type: "product"; partNumber: string; slug: string; nameEn: string; nameFa: string };

export async function suggest(q: string, limit = 8): Promise<Suggestion[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;

  const [cats, fams, prods] = await Promise.all([
    sql<{ path: string; nameEn: string; nameFa: string; count: number }[]>`
      SELECT path, name_en AS "nameEn", name_fa AS "nameFa",
             product_count AS count
      FROM categories
      WHERE name_en ILIKE ${like} OR name_fa ILIKE ${like}
      ORDER BY product_count DESC LIMIT ${limit}
    `,
    sql<{ slug: string; nameEn: string; nameFa: string; count: number }[]>`
      SELECT slug, name_en AS "nameEn", name_fa AS "nameFa",
             product_count AS count
      FROM product_families
      WHERE name_en ILIKE ${like} OR name_fa ILIKE ${like}
      ORDER BY product_count DESC LIMIT ${limit}
    `,
    // Part-number lookups are the highest-intent query a procurement buyer makes,
    // so they are matched by prefix and surfaced separately.
    sql<{ partNumber: string; slug: string; nameEn: string; nameFa: string }[]>`
      SELECT p.part_number AS "partNumber", f.slug,
             f.name_en AS "nameEn", f.name_fa AS "nameFa"
      FROM products p JOIN product_families f ON f.id = p.family_id
      WHERE p.part_number ILIKE ${term + "%"}
      ORDER BY p.part_number LIMIT 5
    `,
  ]);

  return [
    ...prods.map((p) => ({ type: "product" as const, ...p })),
    ...cats.map((c) => ({ type: "category" as const, ...c })),
    ...fams.map((f) => ({ type: "family" as const, ...f })),
  ];
}

export type SearchResults = {
  families: (FamilyRow & { categoryPath: string })[];
  categories: CategoryRow[];
  products: (ProductRow & { familySlug: string; familyEn: string; familyFa: string })[];
  total: number;
};

export async function search(q: string): Promise<SearchResults> {
  const term = q.trim();
  if (!term) return { families: [], categories: [], products: [], total: 0 };
  const like = `%${term}%`;

  const [families, categories, products] = await Promise.all([
    sql<(FamilyRow & { categoryPath: string })[]>`
      SELECT ${FAMILY_COLS}, c.path AS "categoryPath"
      FROM product_families f
      JOIN categories c ON c.id = f.category_id
      WHERE f.name_en ILIKE ${like} OR f.name_fa ILIKE ${like}
         OR f.desc_en ILIKE ${like} OR f.desc_fa ILIKE ${like}
      ORDER BY f.product_count DESC LIMIT 40
    `,
    sql<CategoryRow[]>`
      SELECT id, slug, path, depth, parent_id AS "parentId",
             name_en AS "nameEn", name_fa AS "nameFa", icon,
             product_count AS "productCount"
      FROM categories
      WHERE name_en ILIKE ${like} OR name_fa ILIKE ${like}
      ORDER BY product_count DESC LIMIT 12
    `,
    sql<(ProductRow & { familySlug: string; familyEn: string; familyFa: string })[]>`
      SELECT p.id, p.part_number AS "partNumber", p.specs,
             p.price_tiers AS "priceTiers", p.price_cents AS "priceCents",
             p.pack_qty AS "packQty", p.lead_days AS "leadDays",
             p.in_stock AS "inStock",
             f.slug AS "familySlug", f.name_en AS "familyEn", f.name_fa AS "familyFa"
      FROM products p JOIN product_families f ON f.id = p.family_id
      WHERE p.part_number ILIKE ${term + "%"}
         OR to_tsvector('simple', p.search_text) @@ plainto_tsquery('simple', ${term})
      ORDER BY (p.part_number ILIKE ${term + "%"}) DESC, p.sort
      LIMIT 60
    `,
  ]);

  return {
    families,
    categories,
    products,
    total: families.length + categories.length + products.length,
  };
}

/** Exact part-number lookup used by quick order. */
export async function findByPartNumbers(
  partNumbers: string[],
): Promise<(ProductRow & { familyEn: string; familyFa: string })[]> {
  if (partNumbers.length === 0) return [];
  const upper = partNumbers.map((p) => p.toUpperCase());
  return sql<(ProductRow & { familyEn: string; familyFa: string })[]>`
    SELECT p.id, p.part_number AS "partNumber", p.specs,
           p.price_tiers AS "priceTiers", p.price_cents AS "priceCents",
           p.pack_qty AS "packQty", p.lead_days AS "leadDays",
           p.in_stock AS "inStock",
           f.name_en AS "familyEn", f.name_fa AS "familyFa"
    FROM products p JOIN product_families f ON f.id = p.family_id
    WHERE upper(p.part_number) = ANY(${upper})
  `;
}
