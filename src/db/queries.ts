import "server-only";
import { sql } from "./index";
import type { SpecBag, PriceTier, ProductDocument } from "./schema";

export type CategoryRow = {
  id: number;
  slug: string;
  path: string;
  depth: number;
  parentId: number | null;
  nameEn: string;
  nameFa: string;
  icon: string;
  imageUrl: string;
  isVisible: boolean;
  productCount: number;
};

/**
 * One category, read on its own, carrying the description callout's content.
 *
 * Deliberately not part of `CategoryRow`. `CATEGORY_COLS` is shared by the
 * child, ancestor and search reads, and a 2,000-character description in two
 * locales would ship up to ~100 KB per category page for cards that render
 * none of it. Anything that needs the description reads the single row.
 */
export type CategoryDetailRow = CategoryRow & {
  aboutEn: string;
  aboutFa: string;
  diagramUrl: string;
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
  imageUrl: string;
  /** Second image slot; empty means the callout falls back to `imageUrl`. */
  diagramUrl: string;
  isVisible: boolean;
  productCount: number;
};

/** Family-page metadata that is already available from the owning category join. */
export type FamilyDetailRow = FamilyRow & { categoryPath: string };

export type SpecDefRow = {
  key: string;
  labelEn: string;
  labelFa: string;
  unit: string;
  kind: "number" | "text";
  filterable: boolean;
  sort: number;
  /** `table` is a spec-table column; `detail` shows only in the expanded row. */
  inTable: boolean;
  inDetail: boolean;
  /** Shown on the collapsed phone card. */
  mobile: boolean;
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

/** A product plus what only the expanded row needs. Read on the family page. */
export type ProductDetailRow = ProductRow & {
  imageUrl: string;
  documents: ProductDocument[];
};

export type FacetValue = { value: string; num: number | null; count: number };
export type Facet = { key: string; values: FacetValue[] };

export type ProductSetSummary = {
  total: number;
  hasStock: boolean;
  maxLeadDays: number;
  standards: string[];
};

/** Active filters parsed from the query string: specKey -> selected values. */
export type Filters = Record<string, string[]>;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Public category rows carry a count of products that can actually be reached.
 *
 * The stored `product_count` intentionally remains the administrative total.
 * Reusing it after a family or branch is hidden would advertise products that
 * the following page refuses to show, so public counts are derived from the
 * visible descendant families instead.
 */
const CATEGORY_COLS = sql`
  c.id, c.slug, c.path, c.depth, c.parent_id AS "parentId",
  c.name_en AS "nameEn", c.name_fa AS "nameFa", c.icon,
  c.image_url AS "imageUrl", c.is_visible AS "isVisible",
  COALESCE((
    SELECT SUM(vf.product_count)::int
    FROM product_families vf
    JOIN categories vc ON vc.id = vf.category_id
    WHERE vf.is_visible
      AND (vc.path = c.path OR vc.path LIKE c.path || '/%')
      AND NOT EXISTS (
        SELECT 1 FROM categories hidden
        WHERE NOT hidden.is_visible
          AND (vc.path = hidden.path OR vc.path LIKE hidden.path || '/%')
      )
  ), 0)::int AS "productCount"
`;

/** A hidden category hides itself and every descendant, even if they are true. */
const CATEGORY_VISIBLE = sql`
  c.is_visible
  AND NOT EXISTS (
    SELECT 1 FROM categories hidden
    WHERE NOT hidden.is_visible
      AND (c.path = hidden.path OR c.path LIKE hidden.path || '/%')
  )
`;

const FAMILY_VISIBLE = sql`f.is_visible AND ${CATEGORY_VISIBLE}`;

export async function getTopCategories(): Promise<CategoryRow[]> {
  return sql<CategoryRow[]>`
    SELECT ${CATEGORY_COLS}
    FROM categories c
    WHERE c.depth = 0 AND ${CATEGORY_VISIBLE}
    ORDER BY c.sort
  `;
}

/**
 * The one category read that also carries the description and its diagram.
 * Every other category query stays lean — see `CategoryDetailRow`.
 */
export async function getCategoryByPath(path: string): Promise<CategoryDetailRow | null> {
  const rows = await sql<CategoryDetailRow[]>`
    SELECT ${CATEGORY_COLS},
           c.about_en AS "aboutEn", c.about_fa AS "aboutFa",
           c.diagram_url AS "diagramUrl"
    FROM categories c
    WHERE c.path = ${path} AND ${CATEGORY_VISIBLE}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getChildren(parentId: number): Promise<CategoryRow[]> {
  return sql<CategoryRow[]>`
    SELECT ${CATEGORY_COLS}
    FROM categories c
    WHERE c.parent_id = ${parentId} AND ${CATEGORY_VISIBLE}
    ORDER BY c.sort
  `;
}

/** Ancestor chain for breadcrumbs, root first, excluding the category itself. */
export async function getAncestors(path: string): Promise<CategoryRow[]> {
  const parts = path.split("/");
  const paths = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
  if (paths.length === 0) return [];
  return sql<CategoryRow[]>`
    SELECT ${CATEGORY_COLS}
    FROM categories c
    WHERE c.path = ANY(${paths}) AND ${CATEGORY_VISIBLE}
    ORDER BY c.depth
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
  f.icon, f.image_url AS "imageUrl", f.diagram_url AS "diagramUrl",
  f.is_visible AS "isVisible",
  f.product_count AS "productCount"
`;

/** Families anywhere at or below a category, so mid-tree pages are never empty. */
export async function getFamiliesInSubtree(path: string): Promise<FamilyRow[]> {
  return sql<FamilyRow[]>`
    SELECT ${FAMILY_COLS}
    FROM product_families f
    JOIN categories c ON c.id = f.category_id
    WHERE (c.path = ${path} OR c.path LIKE ${path + "/%"})
      AND ${FAMILY_VISIBLE}
    ORDER BY c.sort, f.sort
  `;
}

/**
 * The first `perCategory` families under each top-level category, in one query,
 * for the home page tiles. `rootPath` is the top-level category's path, which
 * is the first segment of the owning category's path — the caller groups on it
 * rather than issuing one query per category.
 */
export async function getFeaturedFamilies(
  perCategory: number,
): Promise<(FamilyRow & { rootPath: string })[]> {
  return sql<(FamilyRow & { rootPath: string })[]>`
    SELECT * FROM (
      SELECT ${FAMILY_COLS},
             split_part(c.path, '/', 1) AS "rootPath",
             row_number() OVER (
               PARTITION BY split_part(c.path, '/', 1)
               ORDER BY c.sort, f.sort
             ) AS rn
      FROM product_families f
      JOIN categories c ON c.id = f.category_id
      WHERE ${FAMILY_VISIBLE}
    ) ranked
    WHERE rn <= ${perCategory}
    ORDER BY "rootPath", rn
  `;
}

export async function getFamilyBySlug(slug: string): Promise<FamilyDetailRow | null> {
  const rows = await sql<FamilyDetailRow[]>`
    SELECT ${FAMILY_COLS}, c.path AS "categoryPath"
    FROM product_families f
    JOIN categories c ON c.id = f.category_id
    WHERE f.slug = ${slug} AND ${FAMILY_VISIBLE}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getSpecDefs(familyId: number): Promise<SpecDefRow[]> {
  return sql<SpecDefRow[]>`
    SELECT key, label_en AS "labelEn", label_fa AS "labelFa", unit, kind,
           filterable, sort, in_table AS "inTable", in_detail AS "inDetail", mobile
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

/** Whole-result facts used above a bounded family table. */
export async function getProductSetSummary(
  familyId: number,
  filters: Filters,
): Promise<ProductSetSummary> {
  const rows = await sql<ProductSetSummary[]>`
    SELECT count(*)::int AS total,
           COALESCE(bool_or(p.in_stock), false) AS "hasStock",
           COALESCE(max(p.lead_days), 0)::int AS "maxLeadDays",
           COALESCE(
             array_agg(
               DISTINCT NULLIF(p.specs->>'spec', '')
               ORDER BY NULLIF(p.specs->>'spec', '')
             ) FILTER (WHERE NULLIF(p.specs->>'spec', '') IS NOT NULL),
             ARRAY[]::text[]
           ) AS standards
    FROM products p
    WHERE ${filterClause(familyId, filters)}
  `;
  return rows[0] ?? { total: 0, hasStock: false, maxLeadDays: 0, standards: [] };
}

/**
 * A bounded, server-filtered family window. Passing no limit is reserved for
 * the route's explicit all-products mode. A part-number deep link is pinned to
 * the first row so search/cart links still reach their product without forcing
 * the other thousands of rows into the initial document.
 */
export async function getProducts(
  familyId: number,
  filters: Filters,
  limit: number | null,
  pinnedPartNumber: string | null = null,
): Promise<ProductDetailRow[]> {
  return sql<ProductDetailRow[]>`
    SELECT p.id, p.part_number AS "partNumber", p.specs,
           p.price_tiers AS "priceTiers", p.price_cents AS "priceCents",
           p.pack_qty AS "packQty", p.lead_days AS "leadDays",
           p.in_stock AS "inStock", p.image_url AS "imageUrl", p.documents
    FROM products p
    WHERE ${filterClause(familyId, filters)}
    ORDER BY CASE
               WHEN ${pinnedPartNumber}::text IS NOT NULL
                AND upper(p.part_number) = upper(${pinnedPartNumber})
               THEN 0 ELSE 1
             END,
             p.sort
    LIMIT ${limit}
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
    WHERE v.family_id = ${familyId}
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

  const [cats, fams, prods] = await Promise.all([
    sql<{ path: string; nameEn: string; nameFa: string; count: number }[]>`
      WITH ranked AS (
        SELECT ${CATEGORY_COLS},
               greatest(
                 catalog_search_rank(${term}, c.name_en),
                 catalog_search_rank(${term}, c.name_fa)
               ) AS relevance
        FROM categories c
        WHERE ${CATEGORY_VISIBLE}
      )
      SELECT path, "nameEn", "nameFa", "productCount" AS count
      FROM ranked
      WHERE relevance > 0
      ORDER BY relevance DESC, count DESC
      LIMIT ${limit}
    `,
    sql<{ slug: string; nameEn: string; nameFa: string; count: number }[]>`
      WITH ranked AS (
        SELECT f.slug, f.name_en AS "nameEn", f.name_fa AS "nameFa",
               f.product_count AS count,
               greatest(
                 catalog_search_rank(${term}, f.name_en),
                 catalog_search_rank(${term}, f.name_fa)
               ) AS relevance
        FROM product_families f
        JOIN categories c ON c.id = f.category_id
        WHERE ${FAMILY_VISIBLE}
      )
      SELECT slug, "nameEn", "nameFa", count
      FROM ranked
      WHERE relevance > 0
      ORDER BY relevance DESC, count DESC
      LIMIT ${limit}
    `,
    // Part-number lookups are the highest-intent query a procurement buyer
    // makes. Exact and normalized prefixes still lead, but a transposed or
    // missing character can now recover a nearby part number too.
    sql<{ partNumber: string; slug: string; nameEn: string; nameFa: string }[]>`
      WITH candidates AS MATERIALIZED (
        SELECT p.part_number AS "partNumber", f.slug,
               f.name_en AS "nameEn", f.name_fa AS "nameFa"
        FROM products p
        JOIN product_families f ON f.id = p.family_id
        JOIN categories c ON c.id = f.category_id
        WHERE (p.part_number ILIKE ${term + "%"}
           OR p.part_number % ${term})
          AND ${FAMILY_VISIBLE}
      ), ranked AS (
        SELECT candidates.*,
               catalog_search_rank(${term}, "partNumber") AS relevance
        FROM candidates
      )
      SELECT "partNumber", slug, "nameEn", "nameFa"
      FROM ranked
      WHERE relevance > 0
      ORDER BY relevance DESC, "partNumber"
      LIMIT 5
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

  const [families, categories, products] = await Promise.all([
    sql<(FamilyRow & { categoryPath: string })[]>`
      WITH ranked AS (
        SELECT ${FAMILY_COLS}, c.path AS "categoryPath",
               greatest(
                 catalog_search_rank(${term}, f.name_en),
                 catalog_search_rank(${term}, f.name_fa),
                 catalog_search_rank(${term}, f.desc_en) * 0.8,
                 catalog_search_rank(${term}, f.desc_fa) * 0.8
               ) AS relevance
        FROM product_families f
        JOIN categories c ON c.id = f.category_id
        WHERE ${FAMILY_VISIBLE}
      )
      SELECT id, slug, "categoryId", "nameEn", "nameFa", "descEn", "descFa",
             "aboutEn", "aboutFa", "groupEn", "groupFa", icon, "imageUrl",
             "diagramUrl", "isVisible",
             "productCount", "categoryPath"
      FROM ranked
      WHERE relevance > 0
      ORDER BY relevance DESC, "productCount" DESC
      LIMIT 40
    `,
    sql<CategoryRow[]>`
      WITH ranked AS (
        SELECT ${CATEGORY_COLS},
               greatest(
                 catalog_search_rank(${term}, c.name_en),
                 catalog_search_rank(${term}, c.name_fa)
               ) AS relevance
        FROM categories c
        WHERE ${CATEGORY_VISIBLE}
      )
      SELECT id, slug, path, depth, "parentId", "nameEn", "nameFa", icon,
             "imageUrl", "isVisible", "productCount"
      FROM ranked
      WHERE relevance > 0
      ORDER BY relevance DESC, "productCount" DESC
      LIMIT 12
    `,
    sql<(ProductRow & { familySlug: string; familyEn: string; familyFa: string })[]>`
      WITH family_matches AS MATERIALIZED (
        SELECT id, relevance
        FROM (
          SELECT f.id,
                 greatest(
                   catalog_search_rank(${term}, f.name_en),
                   catalog_search_rank(${term}, f.name_fa),
                   catalog_search_rank(${term}, f.desc_en) * 0.8,
                   catalog_search_rank(${term}, f.desc_fa) * 0.8
                 ) AS relevance
          FROM product_families f
          JOIN categories c ON c.id = f.category_id
          WHERE ${FAMILY_VISIBLE}
        ) scored
        WHERE relevance > 0
      ), candidate_scores AS MATERIALIZED (
        -- Each branch has its own usable index. Keeping these as a UNION is
        -- much faster than one large OR, which makes PostgreSQL scan and
        -- normalize all 34k product documents before it can rank any of them.
        SELECT p.id, fm.relevance, 0::real AS part_relevance
        FROM family_matches fm
        JOIN products p ON p.family_id = fm.id

        UNION ALL

        SELECT p.id,
               catalog_search_rank(${term}, p.part_number) AS relevance,
               catalog_search_rank(${term}, p.part_number) AS part_relevance
        FROM products p
        WHERE p.part_number ILIKE ${term + "%"}
           OR p.part_number % ${term}

        UNION ALL

        SELECT p.id, 0.82::real AS relevance, 0::real AS part_relevance
        FROM products p
        WHERE to_tsvector('simple', catalog_search_words(p.search_text))
                @@ catalog_prefix_tsquery(${term})

        UNION ALL

        -- Keep the original token boundaries as a complementary path. The
        -- normalized index finds "oilresistant"; this one finds a buyer who
        -- types the same phrase as two words, "oil resistant".
        SELECT p.id, 0.82::real AS relevance, 0::real AS part_relevance
        FROM products p
        WHERE to_tsvector('simple', p.search_text)
                @@ catalog_prefix_tsquery(${term})
      ), ranked AS (
        SELECT id, max(relevance) AS relevance,
               max(part_relevance) AS part_relevance
        FROM candidate_scores
        GROUP BY id
        HAVING max(relevance) > 0
      )
      SELECT p.id, p.part_number AS "partNumber", p.specs,
             p.price_tiers AS "priceTiers", p.price_cents AS "priceCents",
             p.pack_qty AS "packQty", p.lead_days AS "leadDays",
             p.in_stock AS "inStock", f.slug AS "familySlug",
             f.name_en AS "familyEn", f.name_fa AS "familyFa"
      FROM ranked r
      JOIN products p ON p.id = r.id
      JOIN product_families f ON f.id = p.family_id
      JOIN categories c ON c.id = f.category_id
      WHERE ${FAMILY_VISIBLE}
      ORDER BY r.relevance DESC, r.part_relevance DESC,
               f.product_count DESC, p.sort
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

export type SubtreeProduct = ProductRow & {
  familyId: number;
  familySlug: string;
  familyEn: string;
  familyFa: string;
  icon: string;
  familyImageUrl: string;
};

/**
 * Spec columns for several families at once, keyed by family. A mixed-family
 * list still has to describe each part — without this every card in the
 * "list of products" view renders as just a name and a part number, and
 * consecutive sizes look identical.
 */
export async function getSpecDefsForFamilies(
  familyIds: number[],
): Promise<Map<number, SpecDefRow[]>> {
  const out = new Map<number, SpecDefRow[]>();
  if (familyIds.length === 0) return out;
  const rows = await sql<(SpecDefRow & { familyId: number })[]>`
    SELECT family_id AS "familyId", key, label_en AS "labelEn",
           label_fa AS "labelFa", unit, kind, filterable, sort,
           in_table AS "inTable", in_detail AS "inDetail", mobile
    FROM spec_defs WHERE family_id = ANY(${familyIds}) ORDER BY family_id, sort
  `;
  for (const r of rows) {
    if (!out.has(r.familyId)) out.set(r.familyId, []);
    out.get(r.familyId)!.push(r);
  }
  return out;
}

/**
 * Every SKU at or below a category, for the "list of products" view. The
 * reference app offers this on mobile so a buyer can scan actual parts without
 * first drilling into a family.
 */
export async function getProductsInSubtree(
  path: string,
  limit: number,
  offset: number,
): Promise<SubtreeProduct[]> {
  return sql<SubtreeProduct[]>`
    SELECT p.id, p.part_number AS "partNumber", p.specs,
           p.price_tiers AS "priceTiers", p.price_cents AS "priceCents",
           p.pack_qty AS "packQty", p.lead_days AS "leadDays",
           p.in_stock AS "inStock",
           f.id AS "familyId", f.slug AS "familySlug", f.name_en AS "familyEn",
           f.name_fa AS "familyFa", f.icon, f.image_url AS "familyImageUrl"
    FROM products p
    JOIN product_families f ON f.id = p.family_id
    JOIN categories c ON c.id = f.category_id
    WHERE (c.path = ${path} OR c.path LIKE ${path + "/%"})
      AND ${FAMILY_VISIBLE}
    ORDER BY f.sort, p.sort
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function countProductsInSubtree(path: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM products p
    JOIN product_families f ON f.id = p.family_id
    JOIN categories c ON c.id = f.category_id
    WHERE (c.path = ${path} OR c.path LIKE ${path + "/%"})
      AND ${FAMILY_VISIBLE}
  `;
  return rows[0]?.n ?? 0;
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
    FROM products p
    JOIN product_families f ON f.id = p.family_id
    JOIN categories c ON c.id = f.category_id
    WHERE upper(p.part_number) = ANY(${upper})
      AND ${FAMILY_VISIBLE}
  `;
}
