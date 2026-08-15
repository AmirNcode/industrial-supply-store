import "server-only";
import { sql } from "./index";

/**
 * Creating a product family from the admin panel.
 *
 * Families were seeder-only, which made the column importer unusable for the
 * thing it was built for: a supplier's first file describes a product type the
 * catalog has never held, so there is nothing to import *into*. This is the
 * smallest form that closes that — a name, a category, and nothing else.
 * Everything a family can otherwise carry (blurb, icon, grouping) has a
 * sensible default and is editable later.
 */

export type CategoryChoice = {
  id: number;
  path: string;
  nameEn: string;
  nameFa: string;
};

export type CatalogCategoryEditorRow = {
  id: number;
  path: string;
  nameEn: string;
  nameFa: string;
  icon: string;
  imageUrl: string;
  isVisible: boolean;
};

export type CatalogCategoryListRow = CatalogCategoryEditorRow & {
  depth: number;
  productCount: number;
};

export type CatalogFamilyEditorRow = {
  id: number;
  categoryId: number;
  nameEn: string;
  nameFa: string;
  icon: string;
  imageUrl: string;
  isVisible: boolean;
};

export type CatalogCategoryEditor = {
  category: CatalogCategoryEditorRow;
  children: CatalogCategoryEditorRow[];
  families: CatalogFamilyEditorRow[];
};

/** Every taxonomy node, including branch categories that own no family rows. */
export async function getCatalogCategoriesForAdmin(): Promise<CatalogCategoryListRow[]> {
  return sql<CatalogCategoryListRow[]>`
    SELECT id, path, depth, name_en AS "nameEn", name_fa AS "nameFa", icon,
           image_url AS "imageUrl", is_visible AS "isVisible",
           product_count AS "productCount"
    FROM categories
    ORDER BY path
  `;
}

/** Everything editable from one category's media page. */
export async function getCatalogCategoryEditor(
  categoryId: number,
): Promise<CatalogCategoryEditor | null> {
  if (!Number.isInteger(categoryId) || categoryId <= 0) return null;

  const [category] = await sql<CatalogCategoryEditorRow[]>`
    SELECT id, path, name_en AS "nameEn", name_fa AS "nameFa", icon,
           image_url AS "imageUrl", is_visible AS "isVisible"
    FROM categories WHERE id = ${categoryId}
  `;
  if (!category) return null;

  const [children, families] = await Promise.all([
    sql<CatalogCategoryEditorRow[]>`
      SELECT id, path, name_en AS "nameEn", name_fa AS "nameFa", icon,
             image_url AS "imageUrl", is_visible AS "isVisible"
      FROM categories WHERE parent_id = ${categoryId} ORDER BY sort, id
    `,
    sql<CatalogFamilyEditorRow[]>`
      SELECT id, category_id AS "categoryId", name_en AS "nameEn",
             name_fa AS "nameFa", icon, image_url AS "imageUrl",
             is_visible AS "isVisible"
      FROM product_families WHERE category_id = ${categoryId} ORDER BY sort, id
    `,
  ]);

  return { category, children, families };
}

export type CatalogEntityUpdate = {
  id: number;
  nameEn: string;
  nameFa: string;
  /** Undefined preserves the current image; an empty string explicitly clears it. */
  imageUrl: string | undefined;
  isVisible: boolean;
};

export async function updateCatalogCategory(input: CatalogEntityUpdate): Promise<boolean> {
  const preserveImage = input.imageUrl === undefined;
  const rows = await sql<{ id: number }[]>`
    UPDATE categories
    SET name_en = ${input.nameEn}, name_fa = ${input.nameFa},
        image_url = CASE WHEN ${preserveImage} THEN image_url ELSE ${input.imageUrl ?? ""} END,
        is_visible = ${input.isVisible}
    WHERE id = ${input.id}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function updateCatalogFamily(input: CatalogEntityUpdate): Promise<boolean> {
  const preserveImage = input.imageUrl === undefined;
  const rows = await sql<{ id: number }[]>`
    UPDATE product_families
    SET name_en = ${input.nameEn}, name_fa = ${input.nameFa},
        image_url = CASE WHEN ${preserveImage} THEN image_url ELSE ${input.imageUrl ?? ""} END,
        is_visible = ${input.isVisible}
    WHERE id = ${input.id}
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Categories a family may hang off — the leaves.
 *
 * A family under a branch category would sit alongside that branch's
 * subcategories in the navigation, which has no meaning: the taxonomy's
 * invariant is that products live at the bottom.
 */
export async function getLeafCategories(): Promise<CategoryChoice[]> {
  return sql<CategoryChoice[]>`
    SELECT c.id, c.path, c.name_en AS "nameEn", c.name_fa AS "nameFa"
    FROM categories c
    WHERE NOT EXISTS (SELECT 1 FROM categories k WHERE k.parent_id = c.id)
    ORDER BY c.path
  `;
}

/** A slug: lowercase, hyphenated, ASCII. */
export function familySlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "family"
  );
}

/**
 * What deleting would destroy, so the confirmation can say so.
 *
 * Orders are counted but not blocked on: `order_items` keeps its own copy of
 * the part number, family name and specs, and its `product_id` is ON DELETE SET
 * NULL, so a past order stays readable and correctly priced after the product
 * it referenced is gone. The count is shown because "12 products, 3 of them on
 * past orders" is a different decision from "12 products".
 */
export type DeleteImpact = {
  families: number;
  products: number;
  orderedProducts: number;
};

export async function getFamilyImpact(familyId: number): Promise<DeleteImpact | null> {
  const [row] = await sql<DeleteImpact[]>`
    SELECT 1::int AS families,
           count(p.id)::int AS products,
           count(DISTINCT p.id) FILTER (WHERE i.id IS NOT NULL)::int AS "orderedProducts"
    FROM product_families f
    LEFT JOIN products p ON p.family_id = f.id
    LEFT JOIN order_items i ON i.product_id = p.id
    WHERE f.id = ${familyId}
    GROUP BY f.id
  `;
  return row ?? null;
}

export async function getCategoryImpact(categoryId: number): Promise<DeleteImpact | null> {
  const [exists] = await sql<{ path: string }[]>`
    SELECT path FROM categories WHERE id = ${categoryId}
  `;
  if (!exists) return null;

  // The whole subtree, not just the category itself — deleting a branch takes
  // its children with it, and the confirmation has to say how much that is.
  const [row] = await sql<DeleteImpact[]>`
    SELECT count(DISTINCT f.id)::int AS families,
           count(p.id)::int AS products,
           count(DISTINCT p.id) FILTER (WHERE i.id IS NOT NULL)::int AS "orderedProducts"
    FROM categories c
    LEFT JOIN product_families f ON f.category_id = c.id
    LEFT JOIN products p ON p.family_id = f.id
    LEFT JOIN order_items i ON i.product_id = p.id
    WHERE c.path = ${exists.path} OR c.path LIKE ${exists.path + "/%"}
  `;
  return row ?? { families: 0, products: 0, orderedProducts: 0 };
}

/**
 * Delete a family and everything under it.
 *
 * `products`, `spec_defs` and `product_spec_values` all cascade from the
 * foreign keys, so this one statement is the whole deletion. The category
 * counts are then rebuilt, because they are denormalised onto every ancestor.
 */
export async function deleteFamily(familyId: number): Promise<boolean> {
  return sql.begin(async (tx) => {
    const gone = await tx`DELETE FROM product_families WHERE id = ${familyId} RETURNING id`;
    if (gone.length === 0) return false;
    await recountCategories(tx);
    return true;
  });
}

/**
 * Delete a category, its descendants, and their families and products.
 *
 * `categories.parent_id` cascades to children and `product_families.category_id`
 * cascades to families, so deleting the row is enough — but only if the
 * subtree is deleted from the top. Deleted by path prefix rather than relying
 * on recursion so the intent is visible in the statement.
 */
export async function deleteCategory(categoryId: number): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [c] = await tx<{ path: string }[]>`
      SELECT path FROM categories WHERE id = ${categoryId}
    `;
    if (!c) return false;
    await tx`
      DELETE FROM categories
      WHERE path = ${c.path} OR path LIKE ${c.path + "/%"}
    `;
    await recountCategories(tx);
    return true;
  });
}

/** The seeder's roll-up: every ancestor carries the count of its subtree. */
async function recountCategories(tx: Parameters<Parameters<typeof sql.begin>[1]>[0]) {
  await tx`UPDATE categories SET product_count = 0`;
  await tx`
    UPDATE categories c SET product_count = COALESCE(sub.n, 0)
    FROM (
      SELECT anc.id, SUM(f.product_count) AS n
      FROM categories anc
      JOIN categories d ON d.path = anc.path OR d.path LIKE anc.path || '/%'
      JOIN product_families f ON f.category_id = d.id
      GROUP BY anc.id
    ) sub
    WHERE c.id = sub.id
  `;
}

/**
 * Move a family one place up or down among its category's families.
 *
 * The whole category is renumbered rather than two rows swapped. `sort`
 * defaults to 0, so a seeded category is a run of ties that `ORDER BY sort, id`
 * breaks by id — swapping two zeros would reorder nothing. Renumbering from the
 * order the catalog actually renders makes the first move on such a category
 * take effect, and every later one is then a plain swap.
 *
 * Returns false at either end of the list, which the buttons already prevent;
 * this is the same answer for a hand-made POST.
 */
export async function moveFamily(familyId: number, delta: -1 | 1): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [family] = await tx<{ categoryId: number }[]>`
      SELECT category_id AS "categoryId" FROM product_families WHERE id = ${familyId}
    `;
    if (!family) return false;

    const siblings = await tx<{ id: number }[]>`
      SELECT id FROM product_families
      WHERE category_id = ${family.categoryId}
      ORDER BY sort, id
    `;
    const from = siblings.findIndex((f) => f.id === familyId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= siblings.length) return false;

    const ids = siblings.map((f) => f.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];

    await tx`
      UPDATE product_families f SET sort = u.sort
      FROM unnest(${ids}::int[]) WITH ORDINALITY AS u(id, sort)
      WHERE f.id = u.id
    `;
    return true;
  });
}

export type CreateFamilyResult =
  | { ok: true; id: number; slug: string }
  | { ok: false; reason: "no-category" | "no-name" };

export async function createFamily(
  categoryId: number,
  nameEn: string,
  nameFa: string,
): Promise<CreateFamilyResult> {
  const en = nameEn.trim();
  // A family with no English name has no slug and no table heading.
  if (en === "") return { ok: false, reason: "no-name" };

  const [category] = await sql<{ id: number }[]>`
    SELECT id FROM categories WHERE id = ${categoryId}
  `;
  if (!category) return { ok: false, reason: "no-category" };

  const base = familySlug(en);

  const [row] = await sql<{ id: number; slug: string }[]>`
    INSERT INTO product_families (slug, category_id, name_en, name_fa, sort)
    SELECT
      -- The slug is unique across the whole catalog, so a second "Gate Valve"
      -- under a different category needs a suffix rather than a failed insert.
      CASE WHEN NOT EXISTS (SELECT 1 FROM product_families WHERE slug = ${base})
           THEN ${base}
           ELSE ${base} || '-' || (
             SELECT count(*) + 1 FROM product_families WHERE slug LIKE ${base + "%"}
           )::text
      END,
      ${categoryId}, ${en},
      -- An empty Persian name would render as a blank heading on the Persian
      -- site; the English one is wrong but legible, and editable afterwards.
      ${nameFa.trim() || en},
      (SELECT COALESCE(MAX(sort), 0) + 1 FROM product_families WHERE category_id = ${categoryId})
    RETURNING id, slug
  `;

  return { ok: true, id: row.id, slug: row.slug };
}
