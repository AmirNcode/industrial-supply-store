import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "./index";
import {
  createCategory,
  createFamily,
  getAdminTaxonomyNodes,
  saveAdminTaxonomyChanges,
} from "./familyQueries";

function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for the taxonomy integration test");
  const { hostname } = new URL(raw);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`Refusing to run taxonomy integration tests against non-local host: ${hostname}`);
  }
}

test("taxonomy creation rules and page-level save are enforced transactionally", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  let rootId: number | null = null;

  try {
    const root = await createCategory(null, `Taxonomy Test ${suffix}`, `Taxonomy Test ${suffix}`);
    assert.equal(root.ok, true);
    if (!root.ok) return;
    rootId = root.id;

    const [storedRoot] = await sql<{ isVisible: boolean }[]>`
      SELECT is_visible AS "isVisible" FROM categories WHERE id = ${root.id}
    `;
    assert.equal(storedRoot.isVisible, false, "new empty categories must not become public dead ends");

    const child = await createCategory(root.id, "Child", "Child");
    assert.equal(child.ok, true);
    if (!child.ok) return;

    assert.deepEqual(await createFamily(root.id, "Blocked Family", "Blocked Family"), {
      ok: false,
      reason: "has-subcategories",
    });

    await sql`DELETE FROM categories WHERE id = ${child.id}`;
    const first = await createFamily(root.id, "First Family", "First Family");
    const second = await createFamily(root.id, "Second Family", "Second Family");
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;

    assert.deepEqual(await createCategory(root.id, "Blocked Child", "Blocked Child"), {
      ok: false,
      reason: "has-families",
    });
    assert.deepEqual(await createFamily(root.id, "  FIRST   family ", "duplicate"), {
      ok: false,
      reason: "duplicate-name",
    });

    const nodes = await getAdminTaxonomyNodes();
    const rootNode = nodes.find((node) => node.kind === "category" && node.id === root.id);
    assert.equal(rootNode?.familyCount, 2);

    assert.equal(
      await saveAdminTaxonomyChanges(
        [{ kind: "family", parentId: root.id, orderedIds: [second.id, first.id] }],
        [{
          kind: "category",
          id: root.id,
          aboutEn: "Saved together",
          aboutFa: "",
        }],
        [
          { kind: "category", id: root.id, isVisible: true },
          { kind: "family", id: first.id, isVisible: false },
        ],
      ),
      true,
    );
    const ordered = await sql<{ id: number }[]>`
      SELECT id FROM product_families WHERE category_id = ${root.id} ORDER BY sort, id
    `;
    assert.deepEqual(ordered.map((row) => row.id), [second.id, first.id]);
    const [savedRoot] = await sql<{ isVisible: boolean }[]>`
      SELECT is_visible AS "isVisible" FROM categories WHERE id = ${root.id}
    `;
    const [savedFamily] = await sql<{ isVisible: boolean }[]>`
      SELECT is_visible AS "isVisible" FROM product_families WHERE id = ${first.id}
    `;
    assert.equal(savedRoot.isVisible, true);
    assert.equal(savedFamily.isVisible, false);

    // One missing sibling makes the whole transaction stale; the content and
    // visibility edits beside it must not land either.
    assert.equal(
      await saveAdminTaxonomyChanges(
        [{ kind: "family", parentId: root.id, orderedIds: [first.id] }],
        [{
          kind: "category",
          id: root.id,
          aboutEn: "MUST NOT LAND",
          aboutFa: "",
        }],
        [
          { kind: "category", id: root.id, isVisible: false },
          { kind: "family", id: first.id, isVisible: true },
        ],
      ),
      false,
    );
    const [afterStale] = await sql<{ aboutEn: string; isVisible: boolean }[]>`
      SELECT about_en AS "aboutEn", is_visible AS "isVisible"
      FROM categories WHERE id = ${root.id}
    `;
    const [familyAfterStale] = await sql<{ isVisible: boolean }[]>`
      SELECT is_visible AS "isVisible" FROM product_families WHERE id = ${first.id}
    `;
    assert.equal(afterStale.aboutEn, "Saved together");
    assert.equal(afterStale.isVisible, true);
    assert.equal(familyAfterStale.isVisible, false);
  } finally {
    if (rootId !== null) {
      // Exact test-owned root; its empty families cascade with it.
      await sql`DELETE FROM categories WHERE id = ${rootId}`;
    }
  }
});

after(async () => {
  await sql.end({ timeout: 5 });
});
