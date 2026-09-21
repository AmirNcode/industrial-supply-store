import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  allocatePartNumbers,
  ensureFamilyNumber,
  registerExistingPartNumbers,
  PartNumberUnavailable,
  FamilyCapacityExhausted,
} from "./partNumberQueries";
import { writeImport } from "./importQueries";
import { processCatalogImport } from "@/lib/catalogImport";
import { MAX_VARIANTS_PER_FAMILY } from "@/lib/partNumber";
import { sql as appSql } from "./index";

const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
after(async () => { await sql.end(); await appSql.end(); });

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

test("unbound reservations cannot be claimed again", async () => {
  const slug = `pn-idem-${Date.now()}`;
  await withFamily(slug, async (familyId) => {
  const familyNumber = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));
  const codes = [`${familyNumber}A001`, `${familyNumber}A002`];

  await sql.begin((tx) => registerExistingPartNumbers(tx, familyId, codes));
  await assert.rejects(
    sql.begin((tx) => registerExistingPartNumbers(tx, familyId, codes)),
    PartNumberUnavailable,
  );

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
  let goneNumber: number | undefined;
  try {
    const goneId = await makeFamily(goneSlug);
    const [goneCode] = await sql.begin((tx) => allocatePartNumbers(tx, goneId, 1));
    goneNumber = Number(goneCode.slice(0, 4));
    await sql`DELETE FROM categories WHERE slug = ${goneSlug}`;
    await withFamily(nextSlug, async (nextId) => {
      const nextNumber = await sql.begin((tx) => ensureFamilyNumber(tx, nextId));
      assert.notEqual(nextNumber, goneNumber);
      const [code] = await sql.begin((tx) => allocatePartNumbers(tx, nextId, 1));
      assert.equal(code, `${nextNumber}A001`);
    });
  } finally {
    await cleanUp(goneSlug);
    if (goneNumber !== undefined) {
      await sql`DELETE FROM part_number_registry WHERE family_number = ${goneNumber}`;
    }
  }
});

test("a family number the catalog already uses as a prefix is skipped", async () => {
  const slug = `pn-prefix-${Date.now()}`;
  await withFamily(slug, async (familyId) => {
    // The seeded catalog carries supplier codes shaped exactly like ours, so
    // the next free number by counting alone can already be in use.
    const [{ candidate }] = await sql<{ candidate: number }[]>`
      SELECT n AS candidate FROM generate_series(1000, 9999) n
      WHERE NOT EXISTS (SELECT 1 FROM products WHERE left(part_number, 4) = n::text)
        AND NOT EXISTS (SELECT 1 FROM product_families WHERE family_number = n)
        AND NOT EXISTS (SELECT 1 FROM part_number_registry WHERE family_number = n)
      ORDER BY n LIMIT 1
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

function importRow(partNumber = "", priceCents = 100) {
  return { partNumber, specs: {}, priceCents, packQty: 1, leadDays: 0, inStock: true,
    inventoryAvailable: 0, inventoryOnHold: 0, inventorySold: 0 };
}

test("new-product writes refuse an existing code without changing its data", async () => {
  await withFamily(`pn-create-${Date.now()}`, async (familyId) => {
    const row = importRow();
    await writeImport(familyId, [row], undefined, { insertOnly: true });
    await assert.rejects(writeImport(familyId, [importRow(row.partNumber, 9999)], undefined, { insertOnly: true }),
      (error: unknown) => error instanceof PartNumberUnavailable && error.reason === "existing");
    const [stored] = await sql`SELECT price_cents FROM products WHERE part_number = ${row.partNumber}`;
    assert.equal(stored.price_cents, 100);
    const updated = await writeImport(familyId, [importRow(row.partNumber, 250)]);
    assert.equal(updated.updated, 1, "normal CSV updates still work");
  });
});

test("a product deletion leaves a reservation that refuses explicit reuse", async () => {
  await withFamily(`pn-tombstone-${Date.now()}`, async (familyId) => {
    const row = importRow();
    await writeImport(familyId, [row]);
    const [binding] = await sql`
      SELECT p.id, r.product_id FROM products p JOIN part_number_registry r ON r.part_number = p.part_number
      WHERE p.part_number = ${row.partNumber}
    `;
    assert.equal(binding.product_id, binding.id);
    await sql`DELETE FROM products WHERE id = ${binding.id}`;
    await assert.rejects(writeImport(familyId, [importRow(row.partNumber)]), PartNumberUnavailable);
    const [reservation] = await sql`SELECT product_id FROM part_number_registry WHERE part_number = ${row.partNumber}`;
    assert.equal(reservation.product_id, null);
    const next = importRow();
    await writeImport(familyId, [next]);
    assert.notEqual(next.partNumber, row.partNumber);
  });
});

test("supplied TEMEX codes are reserved before blank rows in the same import", async () => {
  await withFamily(`pn-explicit-${Date.now()}`, async (familyId) => {
    const prefix = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));
    const rows = [importRow(), importRow(`${prefix}A001`)];
    const result = await writeImport(familyId, rows);
    assert.equal(result.inserted, 2);
    assert.deepEqual(rows.map((row) => row.partNumber), [`${prefix}A002`, `${prefix}A001`]);
    const bindings = await sql`SELECT product_id FROM part_number_registry WHERE family_number = ${prefix}`;
    assert.ok(bindings.every((binding) => binding.product_id !== null));
  });
});

test("first allocations in different families both succeed concurrently", async () => {
  await withFamily(`pn-first-a-${Date.now()}`, async (firstId) => {
    await withFamily(`pn-first-b-${Date.now()}`, async (secondId) => {
      const [a, b] = await Promise.all([
        sql.begin((tx) => allocatePartNumbers(tx, firstId, 1)),
        sql.begin((tx) => allocatePartNumbers(tx, secondId, 1)),
      ]);
      assert.notEqual(a[0].slice(0, 4), b[0].slice(0, 4));
    });
  });
});

test("simultaneous new-product submissions cannot overwrite one another", async () => {
  await withFamily(`pn-create-race-${Date.now()}`, async (familyId) => {
    const code = `SUPPLIER-${Date.now()}`;
    const results = await Promise.allSettled([
      writeImport(familyId, [importRow(code, 123)], undefined, { insertOnly: true }),
      writeImport(familyId, [importRow(code, 987)], undefined, { insertOnly: true }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const refused = results.find((r) => r.status === "rejected");
    assert.ok(refused?.status === "rejected" && refused.reason instanceof PartNumberUnavailable);
    const [stored] = await sql`SELECT price_cents FROM products WHERE part_number = ${code}`;
    assert.ok([123, 987].includes(stored.price_cents));
  });
});

test("a rolled-back allocation does not consume a code or mutate the input", async () => {
  await withFamily(`pn-rollback-${Date.now()}`, async (familyId) => {
    const row = { ...importRow(), packQty: 0 };
    await assert.rejects(writeImport(familyId, [row]));
    assert.equal(row.partNumber, "");
    row.packQty = 1;
    await writeImport(familyId, [row]);
    assert.ok(row.partNumber.endsWith("A001"));
  });
});

test("capacity failure rolls back all reservations in the batch", async () => {
  await withFamily(`pn-full-${Date.now()}`, async (familyId) => {
    const prefix = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));
    await sql`UPDATE product_families SET next_variant_ordinal = ${MAX_VARIANTS_PER_FAMILY} WHERE id = ${familyId}`;
    const rows = [importRow(), importRow()];
    await assert.rejects(writeImport(familyId, rows), FamilyCapacityExhausted);
    assert.deepEqual(rows.map((r) => r.partNumber), ["", ""]);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM part_number_registry WHERE family_number = ${prefix}`;
    assert.equal(n, 0);
  });
});

test("supplied lowercase codes in another family's range keep permanent reservations", async () => {
  await withFamily(`pn-owner-${Date.now()}`, async (ownerId) => {
    const prefix = await sql.begin((tx) => ensureFamilyNumber(tx, ownerId));
    await withFamily(`pn-supplier-${Date.now()}`, async (supplierId) => {
      const row = importRow(`${prefix}a007`);
      await writeImport(supplierId, [row]);
      await writeImport(supplierId, [importRow(row.partNumber, 200)]);
      const [registry] = await sql`SELECT product_id FROM part_number_registry WHERE part_number = ${row.partNumber.toUpperCase()}`;
      assert.ok(registry.product_id);
      await sql`DELETE FROM products WHERE id = ${registry.product_id}`;
      await assert.rejects(writeImport(supplierId, [importRow(row.partNumber.toUpperCase())]), PartNumberUnavailable);
      const generated = importRow();
      await writeImport(ownerId, [generated]);
      assert.equal(generated.partNumber, `${prefix}A008`);
    });
  });
});

test("CSV review counts valid blank rows even when another row is invalid", async () => {
  await withFamily(`pn-preview-${Date.now()}`, async (familyId) => {
    const text = "part_number,price_usd\n,10\n,not-a-price\n";
    const result = await processCatalogImport({ familyId, text, stage: "review" });
    assert.equal(result.kind, "review");
    if (result.kind !== "review") return;
    assert.equal(result.goodRows, 1);
    assert.equal(result.blankRows, 1);
    assert.equal(result.rowProblems.length, 1);
    const again = await processCatalogImport({ familyId, text, stage: "apply",
      rawPlan: JSON.stringify({ ...result.plan, skipBadRows: true, autoNumber: false }) });
    assert.equal(again.kind, "review", "missing consent must retain the upload and review screen");
    if (again.kind !== "review") return;
    assert.equal(again.blankRows, 1);
    assert.equal(again.plan.skipBadRows, true);
  });
});

test("remapping the part-number column returns an accurate review instead of losing the upload", async () => {
  await withFamily(`pn-remap-${Date.now()}`, async (familyId) => {
    const text = "part_number,price_usd\nSUPPLIER-1,10\n";
    const result = await processCatalogImport({ familyId, text, stage: "review" });
    assert.equal(result.kind, "review");
    if (result.kind !== "review") return;
    const plan = { ...result.plan, headers: result.plan.headers.map((h) => h.header === "part_number"
      ? { role: "ignore", header: h.header } : h) };
    const again = await processCatalogImport({ familyId, text, stage: "apply", rawPlan: JSON.stringify(plan) });
    assert.equal(again.kind, "review");
    if (again.kind !== "review") return;
    assert.equal(again.blankRows, 1);
    assert.equal(again.plan.headers[0].role, "ignore");
  });
});

test("the pending migration attaches old live reservations without renumbering products", async () => {
  await withFamily(`pn-migration-${Date.now()}`, async (familyId) => {
    const row = importRow();
    await writeImport(familyId, [row]);
    const [before] = await sql`SELECT id, part_number FROM products WHERE family_id = ${familyId}`;
    await sql`UPDATE part_number_registry SET product_id = NULL WHERE part_number = ${row.partNumber}`;
    const migration = await readFile(new URL("../../supabase/migrations/20260920120000_add_temex_part_numbers.sql", import.meta.url), "utf8");
    await sql.begin((tx) => tx.unsafe(migration));
    const [after] = await sql`
      SELECT p.id, p.part_number, r.product_id FROM products p
      JOIN part_number_registry r ON r.part_number = p.part_number WHERE p.id = ${before.id}
    `;
    assert.equal(after.part_number, before.part_number);
    assert.equal(after.product_id, before.id);
    assert.equal((await writeImport(familyId, [importRow(row.partNumber, 200)])).updated, 1);
  });
});
