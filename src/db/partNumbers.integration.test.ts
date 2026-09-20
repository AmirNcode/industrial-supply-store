import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import postgres from "postgres";
import {
  allocatePartNumbers,
  ensureFamilyNumber,
  registerExistingPartNumbers,
} from "./partNumberQueries";

const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
after(() => sql.end());

/** A throwaway category + family. Deleting the category cascades to the family. */
async function makeFamily(slug: string): Promise<number> {
  const [category] = await sql<{ id: number }[]>`
    INSERT INTO categories (slug, path, depth, name_en, name_fa)
    VALUES (${slug}, ${slug}, 0, ${slug}, ${slug})
    RETURNING id
  `;
  const [family] = await sql<{ id: number }[]>`
    INSERT INTO product_families (slug, category_id, name_en, name_fa)
    VALUES (${slug}, ${category.id}, ${slug}, ${slug})
    RETURNING id
  `;
  return family.id;
}

async function cleanUp(slug: string): Promise<void> {
  const [family] = await sql<{ familyNumber: number | null }[]>`
    SELECT family_number AS "familyNumber" FROM product_families WHERE slug = ${slug}
  `;
  await sql`DELETE FROM categories WHERE slug = ${slug}`;
  if (family?.familyNumber != null) {
    await sql`DELETE FROM part_number_registry WHERE family_number = ${family.familyNumber}`;
  }
}

/**
 * Cleanup has to survive a failed assertion. A leaked fixture is not a silent
 * one: these families show up in the admin catalog tree, where someone then has
 * to work out what "pn-mixed-1789924939168" is and delete it by hand.
 */
async function withFamily(
  slug: string,
  body: (familyId: number) => Promise<void>,
): Promise<void> {
  const familyId = await makeFamily(slug);
  try {
    await body(familyId);
  } finally {
    await cleanUp(slug);
  }
}

test("allocates sequential codes and never reuses a slot", async () => {
  const slug = `pn-seq-${Date.now()}`;
  await withFamily(slug, async (familyId) => {

  const familyNumber = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));
  const first = await sql.begin((tx) => allocatePartNumbers(tx, familyId, 3));
  assert.deepEqual(first, [
    `${familyNumber}A001`,
    `${familyNumber}A002`,
    `${familyNumber}A003`,
  ]);

  const next = await sql.begin((tx) => allocatePartNumbers(tx, familyId, 1));
  assert.deepEqual(next, [`${familyNumber}A004`]);

  // Losing the product must not return its code to the pool.
  await sql`
    DELETE FROM part_number_registry
    WHERE family_number = ${familyNumber} AND variant_ordinal = 1
  `;
  const afterDelete = await sql.begin((tx) => allocatePartNumbers(tx, familyId, 1));
  assert.deepEqual(afterDelete, [`${familyNumber}A005`]);

  });
});

test("two concurrent allocations never mint the same code", async () => {
  const slug = `pn-race-${Date.now()}`;
  await withFamily(slug, async (familyId) => {
  const familyNumber = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));

  const [a, b] = await Promise.all([
    sql.begin((tx) => allocatePartNumbers(tx, familyId, 50)),
    sql.begin((tx) => allocatePartNumbers(tx, familyId, 50)),
  ]);

  assert.equal(new Set([...a, ...b]).size, 100, "duplicate code under concurrency");
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM part_number_registry WHERE family_number = ${familyNumber}
  `;
  assert.equal(n, 100);

  });
});

test("reserves TEMEX codes that arrived in a file, ignoring legacy ones", async () => {
  const slug = `pn-existing-${Date.now()}`;
  await withFamily(slug, async (familyId) => {
  const familyNumber = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));

  await sql.begin((tx) =>
    registerExistingPartNumbers(tx, familyId, [`${familyNumber}A007`, "2490T1"]),
  );
  const rows = await sql<{ partNumber: string }[]>`
    SELECT part_number AS "partNumber" FROM part_number_registry
    WHERE family_number = ${familyNumber} ORDER BY id
  `;
  // A legacy supplier code occupies no slot in this scheme; inventing one
  // would block a real code later.
  assert.deepEqual(
    rows.map((r) => r.partNumber),
    [`${familyNumber}A007`],
  );

  // The counter has to clear what the file brought in, or the next allocation
  // collides with a code that already exists.
  const next = await sql.begin((tx) => allocatePartNumbers(tx, familyId, 1));
  assert.deepEqual(next, [`${familyNumber}A008`]);

  });
});

test("re-registering the same codes is a no-op", async () => {
  const slug = `pn-idem-${Date.now()}`;
  await withFamily(slug, async (familyId) => {
  const familyNumber = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));
  const codes = [`${familyNumber}A001`, `${familyNumber}A002`];

  await sql.begin((tx) => registerExistingPartNumbers(tx, familyId, codes));
  await sql.begin((tx) => registerExistingPartNumbers(tx, familyId, codes));

  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM part_number_registry WHERE family_number = ${familyNumber}
  `;
  assert.equal(n, 2);

  });
});

test("an import row with no part number is given a minted code", async () => {
  const slug = `pn-import-${Date.now()}`;
  await withFamily(slug, async (familyId) => {
  const { writeImport } = await import("./importQueries");

  const blank = {
    partNumber: "",
    specs: {},
    priceCents: 100,
    packQty: 1,
    leadDays: 0,
    inStock: true,
    inventoryAvailable: 0,
    inventoryOnHold: 0,
    inventorySold: 0,
  };
  const result = await writeImport(familyId, [blank]);
  assert.equal(result.inserted, 1);

  const [{ familyNumber }] = await sql<{ familyNumber: number }[]>`
    SELECT family_number AS "familyNumber" FROM product_families WHERE id = ${familyId}
  `;
  const [product] = await sql<{ partNumber: string }[]>`
    SELECT part_number AS "partNumber" FROM products WHERE family_id = ${familyId}
  `;
  assert.equal(product.partNumber, `${familyNumber}A001`);
  // The caller reads the minted code back off the row it passed in.
  assert.equal(blank.partNumber, `${familyNumber}A001`);

  });
});

test("an import mixing supplied and blank part numbers keeps both", async () => {
  const slug = `pn-mixed-${Date.now()}`;
  await withFamily(slug, async (familyId) => {
  const { writeImport } = await import("./importQueries");
  const common = {
    specs: {},
    priceCents: 100,
    packQty: 1,
    leadDays: 0,
    inStock: true,
    inventoryAvailable: 0,
    inventoryOnHold: 0,
    inventorySold: 0,
  };

  // Unique on purpose: a real catalog code like 2490T1 belongs to another
  // family, and the importer rightly refuses the whole file for that.
  const legacy = `LEGACY-${Date.now()}`;
  await writeImport(familyId, [
    { ...common, partNumber: legacy },
    { ...common, partNumber: "" },
  ]);

  const [{ familyNumber }] = await sql<{ familyNumber: number }[]>`
    SELECT family_number AS "familyNumber" FROM product_families WHERE id = ${familyId}
  `;
  const rows = await sql<{ partNumber: string }[]>`
    SELECT part_number AS "partNumber" FROM products WHERE family_id = ${familyId} ORDER BY id
  `;
  assert.deepEqual(
    rows.map((r) => r.partNumber),
    [legacy, `${familyNumber}A001`],
  );

  });
});

test("a deleted family's number is not handed to the next family", async () => {
  const goneSlug = `pn-gone-${Date.now()}`;
  const nextSlug = `pn-next-${Date.now()}`;
  const goneId = await makeFamily(goneSlug);
  const goneNumber = await sql.begin((tx) => allocatePartNumbers(tx, goneId, 1)).then(
    ([code]) => Number(code.slice(0, 4)),
  );

  // Deleting the family leaves its reservations behind on purpose, so the
  // number it used must not come back around to a different family.
  await sql`DELETE FROM categories WHERE slug = ${goneSlug}`;

  try {
    const nextId = await makeFamily(nextSlug);
    const nextNumber = await sql.begin((tx) => ensureFamilyNumber(tx, nextId));
    assert.notEqual(nextNumber, goneNumber);
    // And the allocation that follows must succeed rather than hit the
    // registry's unique index.
    const [code] = await sql.begin((tx) => allocatePartNumbers(tx, nextId, 1));
    assert.equal(code, `${nextNumber}A001`);
    await sql`DELETE FROM part_number_registry WHERE family_number = ${nextNumber}`;
  } finally {
    await sql`DELETE FROM categories WHERE slug = ${nextSlug}`;
    await sql`DELETE FROM part_number_registry WHERE family_number = ${goneNumber}`;
  }
});

test("a family number the catalog already uses as a prefix is skipped", async () => {
  const slug = `pn-prefix-${Date.now()}`;
  await withFamily(slug, async (familyId) => {
    // The seeded catalog carries supplier codes shaped exactly like ours, so
    // the next free number by counting alone can already be in use.
    const [{ candidate }] = await sql<{ candidate: number }[]>`
      SELECT GREATEST(
        COALESCE((SELECT MAX(family_number) FROM product_families), 999),
        COALESCE((SELECT MAX(family_number) FROM part_number_registry), 999)
      )::int + 1 AS candidate
    `;
    const blocker = `${candidate}A500`;
    const [other] = await sql<{ id: number }[]>`
      SELECT id FROM product_families WHERE id <> ${familyId} LIMIT 1
    `;
    await sql`
      INSERT INTO products (part_number, family_id, specs, price_cents, pack_qty,
                            lead_days, in_stock, search_text, sort)
      VALUES (${blocker}, ${other.id}, '{}'::jsonb, 100, 1, 0, true, ${blocker}, 0)
    `;
    try {
      const assigned = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));
      assert.notEqual(assigned, candidate);
      const [code] = await sql.begin((tx) => allocatePartNumbers(tx, familyId, 1));
      assert.equal(code, `${assigned}A001`);
      await sql`DELETE FROM part_number_registry WHERE family_number = ${assigned}`;
    } finally {
      await sql`DELETE FROM products WHERE part_number = ${blocker}`;
    }
  });
});

test("allocation steps over a supplier code that landed inside the family's range", async () => {
  const slug = `pn-clash-${Date.now()}`;
  await withFamily(slug, async (familyId) => {
    const familyNumber = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));
    const [other] = await sql<{ id: number }[]>`
      SELECT id FROM product_families WHERE id <> ${familyId} LIMIT 1
    `;
    const blocker = `${familyNumber}A001`;
    await sql`
      INSERT INTO products (part_number, family_id, specs, price_cents, pack_qty,
                            lead_days, in_stock, search_text, sort)
      VALUES (${blocker}, ${other.id}, '{}'::jsonb, 100, 1, 0, true, ${blocker}, 0)
    `;
    try {
      const [code] = await sql.begin((tx) => allocatePartNumbers(tx, familyId, 1));
      assert.equal(code, `${familyNumber}A002`);
    } finally {
      await sql`DELETE FROM products WHERE part_number = ${blocker}`;
      await sql`DELETE FROM part_number_registry WHERE family_number = ${familyNumber}`;
    }
  });
});
