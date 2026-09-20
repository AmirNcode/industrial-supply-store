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

async function cleanUp(slug: string, familyNumber: number): Promise<void> {
  await sql`DELETE FROM categories WHERE slug = ${slug}`;
  await sql`DELETE FROM part_number_registry WHERE family_number = ${familyNumber}`;
}

test("allocates sequential codes and never reuses a slot", async () => {
  const slug = `pn-seq-${Date.now()}`;
  const familyId = await makeFamily(slug);

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

  await cleanUp(slug, familyNumber);
});

test("two concurrent allocations never mint the same code", async () => {
  const slug = `pn-race-${Date.now()}`;
  const familyId = await makeFamily(slug);
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

  await cleanUp(slug, familyNumber);
});

test("reserves TEMEX codes that arrived in a file, ignoring legacy ones", async () => {
  const slug = `pn-existing-${Date.now()}`;
  const familyId = await makeFamily(slug);
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

  await cleanUp(slug, familyNumber);
});

test("re-registering the same codes is a no-op", async () => {
  const slug = `pn-idem-${Date.now()}`;
  const familyId = await makeFamily(slug);
  const familyNumber = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));
  const codes = [`${familyNumber}A001`, `${familyNumber}A002`];

  await sql.begin((tx) => registerExistingPartNumbers(tx, familyId, codes));
  await sql.begin((tx) => registerExistingPartNumbers(tx, familyId, codes));

  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM part_number_registry WHERE family_number = ${familyNumber}
  `;
  assert.equal(n, 2);

  await cleanUp(slug, familyNumber);
});
