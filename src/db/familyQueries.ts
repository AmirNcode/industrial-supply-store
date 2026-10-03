import "server-only";
import { sql } from "./index";
import {
  categoryNodeKey,
  familyNodeKey,
  normalizeTaxonomyName,
  type AdminTaxonomyNode,
} from "@/lib/adminTaxonomy";

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

/** The description callout's editable content, identical on both entity types. */
export type CatalogDescriptionFields = {
  aboutEn: string;
  aboutFa: string;
  /** Empty means the callout falls back to `imageUrl` at thumbnail size. */
  diagramUrl: string;
};

type CatalogCategoryBaseRow = {
  id: number;
  path: string;
  nameEn: string;
  nameFa: string;
  icon: string;
  imageUrl: string;
  isVisible: boolean;
};

export type CatalogCategoryEditorRow = CatalogCategoryBaseRow & CatalogDescriptionFields;

export type CatalogFamilyEditorRow = {
  id: number;
  categoryId: number;
  nameEn: string;
  nameFa: string;
  icon: string;
  imageUrl: string;
  isVisible: boolean;
} & CatalogDescriptionFields;

export type CatalogCategoryEditor = {
  category: CatalogCategoryEditorRow;
  children: CatalogCategoryEditorRow[];
  families: CatalogFamilyEditorRow[];
};

/**
 * The complete admin tree in one database round trip.
 *
 * Category product counts are already denormalised subtree totals. Family
 * counts and stock are aggregated once here, rather than queried per row by
 * the client workbench.
 */
export async function getAdminTaxonomyNodes(): Promise<AdminTaxonomyNode[]> {
  type RawNode = Omit<AdminTaxonomyNode, "key" | "kind"> & {
    kind: "category" | "family";
  };

  const rows = await sql<RawNode[]>`
    WITH ordered AS (
      SELECT p.family_id, count(DISTINCT p.id)::int AS product_count
      FROM products p
      JOIN order_items i ON i.product_id = p.id
      GROUP BY p.family_id
    ), family_rollup AS (
      SELECT anc.id AS category_id, count(f.id)::int AS family_count,
             COALESCE(sum(o.product_count), 0)::int AS ordered_products
      FROM categories anc
      LEFT JOIN categories child
        ON child.path = anc.path OR child.path LIKE anc.path || '/%'
      LEFT JOIN product_families f ON f.category_id = child.id
      LEFT JOIN ordered o ON o.family_id = f.id
      GROUP BY anc.id
    ), inventory AS (
      SELECT family_id,
             COALESCE(sum(inventory_available), 0)::int AS available,
             COALESCE(sum(inventory_on_hold), 0)::int AS on_hold,
             COALESCE(sum(inventory_sold), 0)::int AS sold
      FROM products
      GROUP BY family_id
    )
    SELECT 'category'::text AS kind, c.id, c.parent_id AS "parentId",
           c.depth, c.slug, c.path, c.sort,
           c.name_en AS "nameEn", c.name_fa AS "nameFa",
           c.image_url AS "imageUrl", c.diagram_url AS "diagramUrl",
           c.about_en AS "aboutEn",
           c.about_fa AS "aboutFa", c.is_visible AS "isVisible",
           c.product_count AS "productCount",
           COALESCE(fr.family_count, 0)::int AS "familyCount",
           0::int AS "inventoryAvailable", 0::int AS "inventoryOnHold",
           0::int AS "inventorySold",
           COALESCE(fr.ordered_products, 0)::int AS "orderedProducts"
    FROM categories c
    LEFT JOIN family_rollup fr ON fr.category_id = c.id

    UNION ALL

    SELECT 'family'::text AS kind, f.id, f.category_id AS "parentId",
           c.depth + 1 AS depth, f.slug, c.path || '/' || f.slug AS path,
           f.sort, f.name_en AS "nameEn", f.name_fa AS "nameFa",
           f.image_url AS "imageUrl", f.diagram_url AS "diagramUrl",
           f.about_en AS "aboutEn",
           f.about_fa AS "aboutFa", f.is_visible AS "isVisible",
           f.product_count AS "productCount", 0::int AS "familyCount",
           COALESCE(i.available, 0)::int AS "inventoryAvailable",
           COALESCE(i.on_hold, 0)::int AS "inventoryOnHold",
           COALESCE(i.sold, 0)::int AS "inventorySold",
           COALESCE(o.product_count, 0)::int AS "orderedProducts"
    FROM product_families f
    JOIN categories c ON c.id = f.category_id
    LEFT JOIN inventory i ON i.family_id = f.id
    LEFT JOIN ordered o ON o.family_id = f.id
  `;

  return rows.map((row) => ({
    ...row,
    key: row.kind === "category" ? categoryNodeKey(row.id) : familyNodeKey(row.id),
  }));
}

/** Everything editable from one category's media page. */
export async function getCatalogCategoryEditor(
  categoryId: number,
): Promise<CatalogCategoryEditor | null> {
  if (!Number.isInteger(categoryId) || categoryId <= 0) return null;

  const [category] = await sql<CatalogCategoryEditorRow[]>`
    SELECT id, path, name_en AS "nameEn", name_fa AS "nameFa", icon,
           image_url AS "imageUrl", is_visible AS "isVisible",
           about_en AS "aboutEn", about_fa AS "aboutFa",
           diagram_url AS "diagramUrl"
    FROM categories WHERE id = ${categoryId}
  `;
  if (!category) return null;

  const [children, families] = await Promise.all([
    sql<CatalogCategoryEditorRow[]>`
      SELECT id, path, name_en AS "nameEn", name_fa AS "nameFa", icon,
             image_url AS "imageUrl", is_visible AS "isVisible",
             about_en AS "aboutEn", about_fa AS "aboutFa",
             diagram_url AS "diagramUrl"
      FROM categories WHERE parent_id = ${categoryId} ORDER BY sort, id
    `,
    sql<CatalogFamilyEditorRow[]>`
      SELECT id, category_id AS "categoryId", name_en AS "nameEn",
             name_fa AS "nameFa", icon, image_url AS "imageUrl",
             is_visible AS "isVisible",
             about_en AS "aboutEn", about_fa AS "aboutFa",
             diagram_url AS "diagramUrl"
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
  /** Same rule as `imageUrl`, for the second slot. */
  diagramUrl: string | undefined;
  aboutEn: string;
  aboutFa: string;
  isVisible: boolean;
};

export async function updateCatalogCategory(input: CatalogEntityUpdate): Promise<boolean> {
  const preserveImage = input.imageUrl === undefined;
  const preserveDiagram = input.diagramUrl === undefined;
  const rows = await sql<{ id: number }[]>`
    UPDATE categories
    SET name_en = ${input.nameEn}, name_fa = ${input.nameFa},
        about_en = ${input.aboutEn}, about_fa = ${input.aboutFa},
        image_url = CASE WHEN ${preserveImage} THEN image_url ELSE ${input.imageUrl ?? ""} END,
        diagram_url = CASE WHEN ${preserveDiagram} THEN diagram_url ELSE ${input.diagramUrl ?? ""} END,
        is_visible = ${input.isVisible}
    WHERE id = ${input.id}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function updateCatalogFamily(input: CatalogEntityUpdate): Promise<boolean> {
  const preserveImage = input.imageUrl === undefined;
  const preserveDiagram = input.diagramUrl === undefined;
  const rows = await sql<{ id: number }[]>`
    UPDATE product_families
    SET name_en = ${input.nameEn}, name_fa = ${input.nameFa},
        about_en = ${input.aboutEn}, about_fa = ${input.aboutFa},
        image_url = CASE WHEN ${preserveImage} THEN image_url ELSE ${input.imageUrl ?? ""} END,
        diagram_url = CASE WHEN ${preserveDiagram} THEN diagram_url ELSE ${input.diagramUrl ?? ""} END,
        is_visible = ${input.isVisible}
    WHERE id = ${input.id}
    RETURNING id
  `;
  return rows.length > 0;
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

export type CreateCategoryResult =
  | { ok: true; id: number; path: string }
  | {
      ok: false;
      reason: "no-name" | "no-parent" | "has-families" | "duplicate-name";
    };

/**
 * Append a category at one sibling scope while enforcing the no-mixed-children
 * rule in the same transaction as the insert.
 */
export async function createCategory(
  parentId: number | null,
  nameEn: string,
  nameFa: string,
): Promise<CreateCategoryResult> {
  const en = nameEn.trim().replace(/\s+/g, " ");
  if (!en) return { ok: false, reason: "no-name" };
  const fa = nameFa.trim().replace(/\s+/g, " ") || en;
  const normalized = normalizeTaxonomyName(en);

  return sql.begin(async (tx) => {
    // Serialise taxonomy creation so slug/path selection and the R2/R3 check
    // cannot race another category/family insert.
    await tx`SELECT pg_advisory_xact_lock(hashtext('admin-taxonomy-create'))`;

    let parent: { id: number; path: string; depth: number } | null = null;
    if (parentId !== null) {
      [parent] = await tx<{ id: number; path: string; depth: number }[]>`
        SELECT id, path, depth FROM categories WHERE id = ${parentId}
      `;
      if (!parent) return { ok: false as const, reason: "no-parent" as const };

      const [family] = await tx<{ id: number }[]>`
        SELECT id FROM product_families WHERE category_id = ${parentId} LIMIT 1
      `;
      if (family) return { ok: false as const, reason: "has-families" as const };
    }

    const [duplicate] = await tx<{ id: number }[]>`
      SELECT id FROM categories
      WHERE parent_id IS NOT DISTINCT FROM ${parentId}::int
        AND lower(regexp_replace(btrim(name_en), '\\s+', ' ', 'g')) = ${normalized}
      LIMIT 1
    `;
    if (duplicate) return { ok: false as const, reason: "duplicate-name" as const };

    const base = familySlug(en);
    const pathBase = parent ? `${parent.path}/${base}` : base;
    const existing = await tx<{ path: string }[]>`
      SELECT path FROM categories
      WHERE path = ${pathBase} OR path LIKE ${pathBase + "-%"}
    `;
    const paths = new Set(existing.map((row) => row.path));
    let suffix = 1;
    let path = pathBase;
    while (paths.has(path)) path = `${pathBase}-${++suffix}`;
    const slug = path.slice(path.lastIndexOf("/") + 1);

    const [row] = await tx<{ id: number; path: string }[]>`
      INSERT INTO categories (
        slug, parent_id, path, depth, name_en, name_fa, is_visible, sort
      ) VALUES (
        ${slug}, ${parentId}, ${path}, ${parent ? parent.depth + 1 : 0},
        ${en}, ${fa}, false,
        (
          SELECT COALESCE(max(sort), 0) + 1 FROM categories
          WHERE parent_id IS NOT DISTINCT FROM ${parentId}::int
        )
      )
      RETURNING id, path
    `;
    return { ok: true as const, id: row.id, path: row.path };
  });
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

export type TaxonomyOrderChange =
  | { kind: "category"; parentId: number | null; orderedIds: number[] }
  | { kind: "family"; parentId: number; orderedIds: number[] };

export type TaxonomyContentChange = {
  kind: "category" | "family";
  id: number;
  aboutEn: string;
  aboutFa: string;
  /** Undefined preserves the current object; a string replaces it. */
  imageUrl?: string;
  /** Same rule as `imageUrl`, for the diagram slot. */
  diagramUrl?: string;
  /**
   * Both names together or neither. The phone flow edits names on the same
   * page as the description, under the same Save all; the desktop pane never
   * sends them, so its saves leave the names exactly as they are.
   */
  names?: { nameEn: string; nameFa: string };
};

export type TaxonomyVisibilityChange = {
  kind: "category" | "family";
  id: number;
  isVisible: boolean;
};

/**
 * Commit every reversible workbench edit atomically.
 *
 * Every sibling list is exact-membership checked before the first write. A
 * stale tree therefore refuses the whole page-level Save rather than landing
 * some groups and leaving the operator to discover which ones moved.
 */
export async function saveAdminTaxonomyChanges(
  orders: readonly TaxonomyOrderChange[],
  content: readonly TaxonomyContentChange[],
  visibility: readonly TaxonomyVisibilityChange[],
): Promise<boolean> {
  return sql.begin(async (tx) => {
    for (const change of orders) {
      if (
        change.orderedIds.length === 0 ||
        new Set(change.orderedIds).size !== change.orderedIds.length
      ) {
        return false;
      }

      const current =
        change.kind === "category"
          ? await tx<{ id: number }[]>`
              SELECT id FROM categories
              WHERE parent_id IS NOT DISTINCT FROM ${change.parentId}::int
            `
          : await tx<{ id: number }[]>`
              SELECT id FROM product_families WHERE category_id = ${change.parentId}
            `;
      const actual = new Set(current.map((row) => row.id));
      if (actual.size !== change.orderedIds.length) return false;
      if (!change.orderedIds.every((id) => actual.has(id))) return false;
    }

    for (const edit of content) {
      const found =
        edit.kind === "category"
          ? await tx<{ id: number }[]>`SELECT id FROM categories WHERE id = ${edit.id}`
          : await tx<{ id: number }[]>`SELECT id FROM product_families WHERE id = ${edit.id}`;
      if (found.length !== 1) return false;
    }

    const visibilityKeys = new Set<string>();
    const categoryVisibility: TaxonomyVisibilityChange[] = [];
    const familyVisibility: TaxonomyVisibilityChange[] = [];
    for (const change of visibility) {
      const key = `${change.kind}:${change.id}`;
      if (visibilityKeys.has(key)) return false;
      visibilityKeys.add(key);
      if (change.kind === "category") categoryVisibility.push(change);
      else familyVisibility.push(change);
    }
    if (categoryVisibility.length > 0) {
      const ids = categoryVisibility.map((change) => change.id);
      const found = await tx<{ id: number }[]>`
        SELECT id FROM categories WHERE id = ANY(${ids}::int[])
      `;
      if (found.length !== ids.length) return false;
    }
    if (familyVisibility.length > 0) {
      const ids = familyVisibility.map((change) => change.id);
      const found = await tx<{ id: number }[]>`
        SELECT id FROM product_families WHERE id = ANY(${ids}::int[])
      `;
      if (found.length !== ids.length) return false;
    }

    for (const change of orders) {
      const ids = [...change.orderedIds];
      if (change.kind === "category") {
        await tx`
          UPDATE categories c SET sort = u.sort
          FROM unnest(${ids}::int[]) WITH ORDINALITY AS u(id, sort)
          WHERE c.id = u.id
            AND c.parent_id IS NOT DISTINCT FROM ${change.parentId}::int
        `;
      } else {
        await tx`
          UPDATE product_families f SET sort = u.sort
          FROM unnest(${ids}::int[]) WITH ORDINALITY AS u(id, sort)
          WHERE f.id = u.id AND f.category_id = ${change.parentId}
        `;
      }
    }

    for (const edit of content) {
      const preserveImage = edit.imageUrl === undefined;
      const preserveDiagram = edit.diagramUrl === undefined;
      const preserveNames = edit.names === undefined;
      if (edit.kind === "category") {
        await tx`
          UPDATE categories
          SET about_en = ${edit.aboutEn}, about_fa = ${edit.aboutFa},
              image_url = CASE WHEN ${preserveImage}
                THEN image_url ELSE ${edit.imageUrl ?? ""} END,
              diagram_url = CASE WHEN ${preserveDiagram}
                THEN diagram_url ELSE ${edit.diagramUrl ?? ""} END,
              name_en = CASE WHEN ${preserveNames}
                THEN name_en ELSE ${edit.names?.nameEn ?? ""} END,
              name_fa = CASE WHEN ${preserveNames}
                THEN name_fa ELSE ${edit.names?.nameFa ?? ""} END
          WHERE id = ${edit.id}
        `;
      } else {
        await tx`
          UPDATE product_families
          SET about_en = ${edit.aboutEn}, about_fa = ${edit.aboutFa},
              image_url = CASE WHEN ${preserveImage}
                THEN image_url ELSE ${edit.imageUrl ?? ""} END,
              diagram_url = CASE WHEN ${preserveDiagram}
                THEN diagram_url ELSE ${edit.diagramUrl ?? ""} END,
              name_en = CASE WHEN ${preserveNames}
                THEN name_en ELSE ${edit.names?.nameEn ?? ""} END,
              name_fa = CASE WHEN ${preserveNames}
                THEN name_fa ELSE ${edit.names?.nameFa ?? ""} END
          WHERE id = ${edit.id}
        `;
      }
    }

    // postgres-js binds a bare boolean[] as a scalar in this tagged position;
    // paired 0/1 arrays keep the update batched without relying on that cast.
    if (categoryVisibility.length > 0) {
      const ids = categoryVisibility.map((change) => change.id);
      const values = categoryVisibility.map((change) => change.isVisible ? 1 : 0);
      await tx`
        UPDATE categories c SET is_visible = (u.is_visible = 1)
        FROM unnest(${ids}::int[], ${values}::int[]) AS u(id, is_visible)
        WHERE c.id = u.id
      `;
    }
    if (familyVisibility.length > 0) {
      const ids = familyVisibility.map((change) => change.id);
      const values = familyVisibility.map((change) => change.isVisible ? 1 : 0);
      await tx`
        UPDATE product_families f SET is_visible = (u.is_visible = 1)
        FROM unnest(${ids}::int[], ${values}::int[]) AS u(id, is_visible)
        WHERE f.id = u.id
      `;
    }

    return true;
  });
}

export type CreateFamilyResult =
  | { ok: true; id: number; slug: string }
  | {
      ok: false;
      reason: "no-category" | "no-name" | "has-subcategories" | "duplicate-name";
    };

export async function createFamily(
  categoryId: number,
  nameEn: string,
  nameFa: string,
): Promise<CreateFamilyResult> {
  const en = nameEn.trim().replace(/\s+/g, " ");
  // A family with no English name has no slug and no table heading.
  if (en === "") return { ok: false, reason: "no-name" };
  const fa = nameFa.trim().replace(/\s+/g, " ") || en;
  const normalized = normalizeTaxonomyName(en);

  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('admin-taxonomy-create'))`;

    const [category] = await tx<{ id: number }[]>`
      SELECT id FROM categories WHERE id = ${categoryId}
    `;
    if (!category) return { ok: false as const, reason: "no-category" as const };

    const [child] = await tx<{ id: number }[]>`
      SELECT id FROM categories WHERE parent_id = ${categoryId} LIMIT 1
    `;
    if (child) {
      return { ok: false as const, reason: "has-subcategories" as const };
    }

    const [duplicate] = await tx<{ id: number }[]>`
      SELECT id FROM product_families
      WHERE category_id = ${categoryId}
        AND lower(regexp_replace(btrim(name_en), '\\s+', ' ', 'g')) = ${normalized}
      LIMIT 1
    `;
    if (duplicate) {
      return { ok: false as const, reason: "duplicate-name" as const };
    }

    const base = familySlug(en);
    const existing = await tx<{ slug: string }[]>`
      SELECT slug FROM product_families
      WHERE slug = ${base} OR slug LIKE ${base + "-%"}
    `;
    const slugs = new Set(existing.map((row) => row.slug));
    let suffix = 1;
    let slug = base;
    while (slugs.has(slug)) slug = `${base}-${++suffix}`;

    const [row] = await tx<{ id: number; slug: string }[]>`
      INSERT INTO product_families (slug, category_id, name_en, name_fa, sort)
      VALUES (
        ${slug}, ${categoryId}, ${en}, ${fa},
        (SELECT COALESCE(max(sort), 0) + 1
         FROM product_families WHERE category_id = ${categoryId})
      )
      RETURNING id, slug
    `;

    return { ok: true as const, id: row.id, slug: row.slug };
  });
}
