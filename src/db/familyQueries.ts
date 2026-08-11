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
