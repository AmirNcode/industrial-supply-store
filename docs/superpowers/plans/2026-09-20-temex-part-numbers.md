# TEMEX Part Numbers Implementation Plan

> Updated scope, confirmed by the owner on 2026-09-21: preserve all existing product numbers; do not build or run catalog renumbering. The bare site defaults to `/fa`; no admin language selector or new browser-preference system. See `../reviews/2026-09-21-production-readiness.md` for the release fixes and verification. The implementation examples below are historical guidance, not the final source.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. (The owner of this repo does not want subagent
> dispatch.) Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New products with blank codes receive a server-assigned TEMEX part number
of the form `NNNNLNNN`. Existing and supplied codes remain supported; the admin
can create one product at a time as well as by CSV.

**Architecture:** A per-family 4-digit `family_number` and a per-family variant
counter live on `product_families`. Every code ever issued is recorded in a new
`part_number_registry` table so a deleted product's code is never handed out
again. Allocation happens inside the existing import transaction, with the family
row locked `FOR UPDATE`, so two concurrent uploads cannot mint the same code. CSV
rows with a blank part number are new items; the review screen reports how many
there are and refuses to apply until the admin explicitly asks for codes to be
generated. A new single-product form reuses `writeImport` so counts, facets and
inventory reconciliation stay in one code path. Existing catalog numbers remain unchanged.

**Tech Stack:** Next.js 16 (App Router, Turbopack), drizzle-orm schema +
`supabase/migrations/*.sql` forward migrations, postgres-js, `node:test` unit
tests, `node:test` + local Docker Postgres integration tests, Playwright e2e.

**Spec:** `docs/TEMEX_Part_Number_Implementation_Handoff/` (README + 01/02/03).
The Decisions section below overrides the spec where they disagree; the spec's
identity-fingerprint design is explicitly **not** being built.

## Global Constraints

- Family numbers are sequential from `1000`. **No category blocks, no reserved
  ranges** — decided 2026-09-20.
- Variant letters are `ABCDEFGHJKLMNPQRSTUVWXYZ` (24 letters; `I` and `O` are
  never generated). 999 numbers per letter, 23,976 variants per family.
- A part number is immutable once assigned, and is never recycled after deletion.
- Both locales, always. `src/lib/i18n.ts` types the Persian dictionary as
  `typeof en`, so every new key must be added to both, and RTL is a first-class
  layout, not a mirror.
- `npx tsc --noEmit` and `npm test` must both be clean before a task is done.
  `npm run build` too, for any task touching a route segment (Tasks 3, 4).
- Local schema changes: `npm run db:push` (drizzle push + re-apply
  `src/db/extensions.sql`). Remote: a dated SQL file in `supabase/migrations/`
  applied with `npm run db:migrate:remote`, which is gated on
  `MIGRATION_BACKUP_VERIFIED=<today>`. Never `drizzle-kit push` bare against a
  live database.
- One change per commit. No "while I was in there".
- Comments explain *why* and name the trap avoided, matching the surrounding code.

## Decisions (2026-09-20 session, from the product owner)

1. **No blocks.** Family numbers carry no category meaning.
2. **Matching stays by part number.** The spec's per-family "identity fields" and
   SHA-256 fingerprint are not built. Two rows with the same specs are two
   products; only the part number identifies a product.
3. **Blank part number = new item.** The review screen must say how many rows are
   blank and offer: generate codes, or cancel and upload a different file.
4. **Updated 2026-09-21: no renumbering.** Existing products are samples and will
   be replaced as real products are added. All production records are test records.
5. **Add a single-product form.** Today products can only arrive by CSV.
6. Existing duplicate protection is unchanged: a repeated part number inside one
   file is a row error; a part number already owned by another family refuses the
   whole upload.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/partNumber.ts` (new) | Pure encoding: ordinal → `A001`, family + ordinal → `1842A001`, validation. No I/O. |
| `src/lib/partNumber.test.ts` (new) | Unit tests for the above. |
| `src/db/schema.ts` (modify) | `product_families.family_number`, `product_families.next_variant_ordinal`, new `part_number_registry` table. |
| `supabase/migrations/20260920120000_add_temex_part_numbers.sql` (new) | The same change as reviewed forward SQL, for the live database. |
| `src/db/partNumberQueries.ts` (new) | Transaction-scoped allocation: family number, N variant codes, registry writes. |
| `src/db/partNumbers.integration.test.ts` (new) | Sequence, concurrency, no-recycling, against local Docker Postgres. |
| `src/lib/importCsv.ts` (modify) | A blank `part_number` cell becomes a row awaiting a code instead of a row error. |
| `src/lib/columnPlan.ts` (modify) | `ImportPlan.autoNumber`, and plan validation for it. |
| `src/lib/catalogImport.ts` (modify) | Review state carries `blankRows`; apply refuses until `autoNumber` is set. |
| `src/db/importQueries.ts` (modify) | Allocate codes for blank rows inside the existing transaction, before insert. |
| `src/app/[locale]/admin/(panel)/products/ColumnReview.tsx` (modify) | Blank-row notice and the generate/cancel choice. |
| `src/app/[locale]/admin/(panel)/products/[id]/new/page.tsx` (new) | Single-product form route, scoped to one family. |
| `src/app/[locale]/admin/(panel)/products/[id]/new/NewProductForm.tsx` (new) | The form itself: spec fields built from the family's `spec_defs`. |
| `src/app/[locale]/admin/(panel)/products/[id]/new/actions.ts` (new) | Server action; validates, then calls `writeImport` with one row. |
| `src/lib/i18n.ts` (modify) | New keys, English and Persian. |
| `docs/DEPLOYMENT.md`, `docs/LOCAL-DEV.md` (modify) | The new deploy step and the local command. |

---

### Task 1: Part number encoding

**Files:**
- Create: `src/lib/partNumber.ts`
- Test: `src/lib/partNumber.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TEMEX_VARIANT_LETTERS: readonly string[]`
  - `MAX_VARIANTS_PER_FAMILY: 23976`
  - `MIN_FAMILY_NUMBER: 1000`, `MAX_FAMILY_NUMBER: 9999`
  - `encodeVariantOrdinal(ordinal: number): string`
  - `formatPartNumber(familyNumber: number, variantOrdinal: number): string`
  - `isTemexPartNumber(value: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/partNumber.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  encodeVariantOrdinal,
  formatPartNumber,
  isTemexPartNumber,
  MAX_VARIANTS_PER_FAMILY,
} from "./partNumber";

test("encodes the first, last and rollover ordinals", () => {
  assert.equal(encodeVariantOrdinal(1), "A001");
  assert.equal(encodeVariantOrdinal(2), "A002");
  assert.equal(encodeVariantOrdinal(999), "A999");
  assert.equal(encodeVariantOrdinal(1000), "B001");
  assert.equal(encodeVariantOrdinal(1998), "B999");
  assert.equal(encodeVariantOrdinal(1999), "C001");
  assert.equal(encodeVariantOrdinal(MAX_VARIANTS_PER_FAMILY), "Z999");
});

test("never generates I or O", () => {
  for (let ordinal = 1; ordinal <= MAX_VARIANTS_PER_FAMILY; ordinal += 997) {
    const suffix = encodeVariantOrdinal(ordinal);
    assert.ok(!suffix.startsWith("I") && !suffix.startsWith("O"), suffix);
  }
});

test("rejects ordinals outside the family's capacity", () => {
  assert.throws(() => encodeVariantOrdinal(0));
  assert.throws(() => encodeVariantOrdinal(MAX_VARIANTS_PER_FAMILY + 1));
  assert.throws(() => encodeVariantOrdinal(1.5));
});

test("formats a full part number and rejects bad family numbers", () => {
  assert.equal(formatPartNumber(1842, 1), "1842A001");
  assert.equal(formatPartNumber(6813, 8), "6813A008");
  assert.throws(() => formatPartNumber(999, 1));
  assert.throws(() => formatPartNumber(10000, 1));
});

test("recognises its own output and rejects legacy codes", () => {
  assert.equal(isTemexPartNumber("1842A001"), true);
  assert.equal(isTemexPartNumber("1842I001"), false);
  assert.equal(isTemexPartNumber("1842O001"), false);
  assert.equal(isTemexPartNumber("2490T1"), false);
  assert.equal(isTemexPartNumber("1842a001"), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './partNumber'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/partNumber.ts
/**
 * TEMEX part number: NNNN L NNN — family number, variant letter, variant number.
 *
 * The code is an identifier, not a description. Nothing about the product's
 * category, size or material is encoded in it, so moving a product between
 * categories never invalidates a number already printed on a quote.
 */

/** `I` and `O` are omitted: on a printed label they read as `1` and `0`. */
export const TEMEX_VARIANT_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ".split("");

const PER_LETTER = 999;
export const MAX_VARIANTS_PER_FAMILY = TEMEX_VARIANT_LETTERS.length * PER_LETTER;

export const MIN_FAMILY_NUMBER = 1000;
export const MAX_FAMILY_NUMBER = 9999;

const PART_NUMBER_RE = new RegExp(
  `^[1-9][0-9]{3}[${TEMEX_VARIANT_LETTERS.join("")}][0-9]{3}$`,
);

export function encodeVariantOrdinal(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > MAX_VARIANTS_PER_FAMILY) {
    throw new RangeError(`Variant ordinal out of range: ${ordinal}`);
  }
  const zero = ordinal - 1;
  const letter = TEMEX_VARIANT_LETTERS[Math.floor(zero / PER_LETTER)];
  const numeric = (zero % PER_LETTER) + 1;
  return `${letter}${String(numeric).padStart(3, "0")}`;
}

export function formatPartNumber(familyNumber: number, variantOrdinal: number): string {
  if (
    !Number.isInteger(familyNumber) ||
    familyNumber < MIN_FAMILY_NUMBER ||
    familyNumber > MAX_FAMILY_NUMBER
  ) {
    throw new RangeError(`Family number out of range: ${familyNumber}`);
  }
  return `${familyNumber}${encodeVariantOrdinal(variantOrdinal)}`;
}

/** True only for the canonical upper-case form this module generates. */
export function isTemexPartNumber(value: string): boolean {
  return PART_NUMBER_RE.test(value);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS. Also run `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/partNumber.ts src/lib/partNumber.test.ts
git commit -m "feat: add TEMEX part number encoding"
```

---

### Task 2: Database columns, registry table and the allocator

**Files:**
- Modify: `src/db/schema.ts` (productFamilies block at `src/db/schema.ts:121`, then a new table after it)
- Create: `supabase/migrations/20260920120000_add_temex_part_numbers.sql`
- Create: `src/db/partNumberQueries.ts`
- Create: `src/db/partNumbers.integration.test.ts`
- Modify: `package.json` (add `test:db:part-numbers` to the `test:db` chain)

**Interfaces:**
- Consumes: `formatPartNumber`, `MAX_VARIANTS_PER_FAMILY`, `MIN_FAMILY_NUMBER` from Task 1.
- Produces, both taking the `postgres.TransactionSql` the callers already have:
  - `ensureFamilyNumber(tx: Tx, familyId: number): Promise<number>`
  - `allocatePartNumbers(tx: Tx, familyId: number, count: number): Promise<string[]>`
  - `registerExistingPartNumbers(tx: Tx, familyId: number, partNumbers: readonly string[]): Promise<void>`
  - `class FamilyCapacityExhausted extends Error`
  - `class FamilyNumbersExhausted extends Error`

- [ ] **Step 1: Add the schema**

In `src/db/schema.ts`, inside the `productFamilies` column list, after `fieldAliases`:

```ts
    /**
     * The 4-digit prefix of every TEMEX part number in this family, 1000–9999,
     * handed out sequentially and never reused. Null only for a family created
     * before its first product; `ensureFamilyNumber` fills it in.
     */
    familyNumber: integer("family_number"),
    /**
     * Next 1-based variant ordinal for this family: 1 → A001, 1000 → B001.
     * Only ever increases. Deleting a product does not give its number back,
     * because a code already quoted must not come to mean something else.
     */
    nextVariantOrdinal: integer("next_variant_ordinal").notNull().default(1),
```

and in the same table's index list:

```ts
    uniqueIndex("families_family_number_key").on(t.familyNumber),
    check(
      "product_families_family_number_check",
      sql`${t.familyNumber} IS NULL OR ${t.familyNumber} BETWEEN 1000 AND 9999`,
    ),
    check(
      "product_families_next_variant_check",
      sql`${t.nextVariantOrdinal} BETWEEN 1 AND 23977`,
    ),
```

Then add the registry table immediately after the `productFamilies` block:

```ts
/**
 * Every part number this system has ever issued.
 *
 * Separate from `products` because the guarantee is "never reused", and a row
 * in `products` disappears when its family is deleted (`family_id` cascades).
 * The registry keeps the reservation after the product is gone, so a later
 * product in a re-created family cannot inherit a code that once meant
 * something else on a customer's quote.
 */
export const partNumberRegistry = pgTable(
  "part_number_registry",
  {
    id: serial("id").primaryKey(),
    partNumber: text("part_number").notNull(),
    familyNumber: integer("family_number").notNull(),
    variantOrdinal: integer("variant_ordinal").notNull(),
    /** Null once the product is deleted; the reservation outlives it. */
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("part_number_registry_key").on(t.partNumber),
    uniqueIndex("part_number_registry_slot_key").on(t.familyNumber, t.variantOrdinal),
    index("part_number_registry_product_idx").on(t.productId),
  ],
);
```

`products` is declared after `productFamilies`, so the `references(() => products.id)`
arrow is required — a direct reference would be a use-before-declaration error.

- [ ] **Step 2: Write the same change as forward SQL**

```sql
-- supabase/migrations/20260920120000_add_temex_part_numbers.sql
-- TEMEX part numbers: per-family prefix, per-family variant counter, and a
-- registry that outlives the products so no code is ever reissued.

ALTER TABLE product_families
  ADD COLUMN IF NOT EXISTS family_number integer,
  ADD COLUMN IF NOT EXISTS next_variant_ordinal integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS families_family_number_key
  ON product_families (family_number);

ALTER TABLE product_families
  DROP CONSTRAINT IF EXISTS product_families_family_number_check,
  ADD CONSTRAINT product_families_family_number_check
    CHECK (family_number IS NULL OR family_number BETWEEN 1000 AND 9999);

ALTER TABLE product_families
  DROP CONSTRAINT IF EXISTS product_families_next_variant_check,
  ADD CONSTRAINT product_families_next_variant_check
    CHECK (next_variant_ordinal BETWEEN 1 AND 23977);

CREATE TABLE IF NOT EXISTS part_number_registry (
  id serial PRIMARY KEY,
  part_number text NOT NULL,
  family_number integer NOT NULL,
  variant_ordinal integer NOT NULL,
  product_id integer REFERENCES products (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS part_number_registry_key
  ON part_number_registry (part_number);
CREATE UNIQUE INDEX IF NOT EXISTS part_number_registry_slot_key
  ON part_number_registry (family_number, variant_ordinal);
CREATE INDEX IF NOT EXISTS part_number_registry_product_idx
  ON part_number_registry (product_id);

-- The registry is written only by the application's owner role; Supabase REST
-- must not read it. Matches the posture of request_rate_limits.
ALTER TABLE part_number_registry ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 3: Apply it locally and confirm the columns exist**

```bash
npm run db:push
docker exec isupply-db psql -U isupply -d isupply -c "\d product_families" | grep -E "family_number|next_variant"
```

Expected: both columns listed.

- [ ] **Step 4: Write the failing integration test**

```ts
// src/db/partNumbers.integration.test.ts
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

/** A throwaway family under a throwaway category, removed by the caller. */
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

test("allocates sequential codes and never repeats a slot", async () => {
  const slug = `pn-seq-${Date.now()}`;
  const familyId = await makeFamily(slug);
  const first = await sql.begin((tx) => allocatePartNumbers(tx, familyId, 3));
  const number = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));

  assert.deepEqual(first, [
    `${number}A001`,
    `${number}A002`,
    `${number}A003`,
  ]);

  const next = await sql.begin((tx) => allocatePartNumbers(tx, familyId, 1));
  assert.deepEqual(next, [`${number}A004`]);

  // Deleting the products must not return their codes to the pool.
  await sql`DELETE FROM part_number_registry WHERE product_id IS NULL AND family_number = ${number} AND variant_ordinal = 1`;
  const afterDelete = await sql.begin((tx) => allocatePartNumbers(tx, familyId, 1));
  assert.deepEqual(afterDelete, [`${number}A005`]);

  await sql`DELETE FROM categories WHERE slug = ${slug}`;
  await sql`DELETE FROM part_number_registry WHERE family_number = ${number}`;
});

test("two concurrent allocations never mint the same code", async () => {
  const slug = `pn-race-${Date.now()}`;
  const familyId = await makeFamily(slug);

  const [a, b] = await Promise.all([
    sql.begin((tx) => allocatePartNumbers(tx, familyId, 50)),
    sql.begin((tx) => allocatePartNumbers(tx, familyId, 50)),
  ]);

  const all = [...a, ...b];
  assert.equal(new Set(all).size, 100, "duplicate code allocated under concurrency");

  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM part_number_registry
    WHERE family_number = (SELECT family_number FROM product_families WHERE id = ${familyId})
  `;
  assert.equal(n, 100);

  const [{ familyNumber }] = await sql<{ familyNumber: number }[]>`
    SELECT family_number AS "familyNumber" FROM product_families WHERE id = ${familyId}
  `;
  await sql`DELETE FROM categories WHERE slug = ${slug}`;
  await sql`DELETE FROM part_number_registry WHERE family_number = ${familyNumber}`;
});

test("records codes the file supplied so they are never reissued", async () => {
  const slug = `pn-existing-${Date.now()}`;
  const familyId = await makeFamily(slug);
  const number = await sql.begin((tx) => ensureFamilyNumber(tx, familyId));

  await sql.begin((tx) =>
    registerExistingPartNumbers(tx, familyId, [`${number}A001`, "2490T1"]),
  );
  const rows = await sql<{ partNumber: string }[]>`
    SELECT part_number AS "partNumber" FROM part_number_registry
    WHERE family_number = ${number} ORDER BY id
  `;
  // The legacy-format code is not ours to slot; only the TEMEX one is reserved.
  assert.deepEqual(rows.map((r) => r.partNumber), [`${number}A001`]);

  const next = await sql.begin((tx) => allocatePartNumbers(tx, familyId, 1));
  assert.deepEqual(next, [`${number}A002`]);

  await sql`DELETE FROM categories WHERE slug = ${slug}`;
  await sql`DELETE FROM part_number_registry WHERE family_number = ${number}`;
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `dotenv -e .env -- node --import tsx --conditions=react-server --test src/db/partNumbers.integration.test.ts`
Expected: FAIL — `Cannot find module './partNumberQueries'`.

- [ ] **Step 6: Write the allocator**

```ts
// src/db/partNumberQueries.ts
import "server-only";

import type { TransactionSql } from "postgres";
import {
  MAX_FAMILY_NUMBER,
  MAX_VARIANTS_PER_FAMILY,
  MIN_FAMILY_NUMBER,
  formatPartNumber,
  isTemexPartNumber,
} from "@/lib/partNumber";

type Tx = TransactionSql<Record<string, unknown>>;

export class FamilyCapacityExhausted extends Error {
  constructor(familyNumber: number) {
    super(`Family ${familyNumber} has used all ${MAX_VARIANTS_PER_FAMILY} variants.`);
    this.name = "FamilyCapacityExhausted";
  }
}

export class FamilyNumbersExhausted extends Error {
  constructor() {
    super(`No family number left below ${MAX_FAMILY_NUMBER}.`);
    this.name = "FamilyNumbersExhausted";
  }
}

/**
 * The family's 4-digit prefix, assigned on first use.
 *
 * `FOR UPDATE` on the family row is what serialises two uploads into the same
 * family. Without it both read the same `next_variant_ordinal`, both compute
 * the same code, and the unique index turns a routine import into a failed one.
 */
export async function ensureFamilyNumber(tx: Tx, familyId: number): Promise<number> {
  const [family] = await tx<{ familyNumber: number | null }[]>`
    SELECT family_number AS "familyNumber" FROM product_families
    WHERE id = ${familyId} FOR UPDATE
  `;
  if (!family) throw new Error(`No family ${familyId}`);
  if (family.familyNumber !== null) return family.familyNumber;

  // Sequential, no category blocks: the number carries no meaning, so the only
  // rule is that it is free and never reused.
  const [next] = await tx<{ candidate: number }[]>`
    SELECT COALESCE(MAX(family_number) + 1, ${MIN_FAMILY_NUMBER}) AS candidate
    FROM product_families
  `;
  if (next.candidate > MAX_FAMILY_NUMBER) throw new FamilyNumbersExhausted();

  // `product_families` has no updated_at column — do not add one here; that is
  // a schema change this feature does not need.
  await tx`
    UPDATE product_families SET family_number = ${next.candidate}
    WHERE id = ${familyId}
  `;
  return next.candidate;
}

/** `count` fresh codes for this family, in order, reserved in the registry. */
export async function allocatePartNumbers(
  tx: Tx,
  familyId: number,
  count: number,
): Promise<string[]> {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`Invalid allocation count: ${count}`);
  }
  if (count === 0) return [];

  const familyNumber = await ensureFamilyNumber(tx, familyId);
  const [family] = await tx<{ nextOrdinal: number }[]>`
    SELECT next_variant_ordinal AS "nextOrdinal" FROM product_families
    WHERE id = ${familyId} FOR UPDATE
  `;
  const start = family.nextOrdinal;
  if (start + count - 1 > MAX_VARIANTS_PER_FAMILY) {
    throw new FamilyCapacityExhausted(familyNumber);
  }

  const codes: string[] = [];
  const ordinals: number[] = [];
  for (let i = 0; i < count; i++) {
    ordinals.push(start + i);
    codes.push(formatPartNumber(familyNumber, start + i));
  }

  await tx`
    INSERT INTO part_number_registry (part_number, family_number, variant_ordinal)
    SELECT u.part_number, ${familyNumber}, u.variant_ordinal::int
    FROM unnest(${codes}::text[], ${ordinals}::int[]) AS u(part_number, variant_ordinal)
  `;
  await tx`
    UPDATE product_families
    SET next_variant_ordinal = ${start + count}
    WHERE id = ${familyId}
  `;
  return codes;
}

/**
 * Reserve codes that arrived in a file rather than from the allocator.
 *
 * Only TEMEX-shaped codes are recorded: a legacy supplier number like `2490T1`
 * occupies no slot in this scheme, and inventing one would block a real code
 * later. Already-registered codes are left alone, so re-uploading a file is
 * still idempotent.
 */
export async function registerExistingPartNumbers(
  tx: Tx,
  familyId: number,
  partNumbers: readonly string[],
): Promise<void> {
  const familyNumber = await ensureFamilyNumber(tx, familyId);
  const prefix = String(familyNumber);
  const mine = partNumbers.filter(
    (part) => isTemexPartNumber(part) && part.startsWith(prefix),
  );
  if (mine.length === 0) return;

  const ordinals = mine.map((part) => {
    const letterIndex = "ABCDEFGHJKLMNPQRSTUVWXYZ".indexOf(part[4]);
    return letterIndex * 999 + Number(part.slice(5));
  });

  await tx`
    INSERT INTO part_number_registry (part_number, family_number, variant_ordinal)
    SELECT u.part_number, ${familyNumber}, u.variant_ordinal::int
    FROM unnest(${mine}::text[], ${ordinals}::int[]) AS u(part_number, variant_ordinal)
    ON CONFLICT (part_number) DO NOTHING
  `;
  // Keep the counter ahead of anything the file brought in, or the next
  // allocation would collide with a code that already exists.
  await tx`
    UPDATE product_families SET next_variant_ordinal = GREATEST(
      next_variant_ordinal,
      ${Math.max(...ordinals) + 1}
    )
    WHERE id = ${familyId}
  `;
}
```

- [ ] **Step 7: Run the integration test**

Run: `dotenv -e .env -- node --import tsx --conditions=react-server --test src/db/partNumbers.integration.test.ts`
Expected: PASS, all three tests.

- [ ] **Step 8: Wire it into the test chain**

In `package.json`, add the script and extend the chain:

```json
    "test:db": "npm run test:db:orders && npm run test:db:integrity && npm run test:db:taxonomy && npm run test:db:rate-limits && npm run test:db:part-numbers",
    "test:db:part-numbers": "dotenv -e .env -- node --import tsx --conditions=react-server --test src/db/partNumbers.integration.test.ts",
```

- [ ] **Step 9: Commit**

```bash
git add src/db/schema.ts src/db/partNumberQueries.ts src/db/partNumbers.integration.test.ts supabase/migrations/20260920120000_add_temex_part_numbers.sql package.json
git commit -m "feat: reserve and allocate TEMEX part numbers in the database"
```

---

### Task 3: CSV import accepts blank part numbers

**Files:**
- Modify: `src/lib/importCsv.ts:215-231` (the blank/duplicate check) and the `ImportRow` type at `src/lib/importCsv.ts:62`
- Modify: `src/lib/columnPlan.ts` (`ImportPlan`, `validatePlan`)
- Modify: `src/lib/catalogImport.ts` (review state, apply gate)
- Modify: `src/db/importQueries.ts:414-450` (allocate before insert)
- Modify: `src/app/[locale]/admin/(panel)/products/ColumnReview.tsx`
- Modify: `src/lib/i18n.ts`
- Test: `src/lib/importCsv.test.ts`, `src/db/partNumbers.integration.test.ts`

**Interfaces:**
- Consumes: `allocatePartNumbers`, `registerExistingPartNumbers` (Task 2).
- Produces:
  - `ImportRow.partNumber` stays `string`, empty when the file left it blank.
  - `ImportPlan.autoNumber: boolean`
  - `ImportState` review variant gains `blankRows: number`
  - a new `message` value `"needs-numbers"`

- [ ] **Step 1: Write the failing parser test**

Append to `src/lib/importCsv.test.ts`:

```ts
test("a blank part number is a row awaiting a code, not an error", () => {
  const csv = [
    "part_number,id_mm,price_usd",
    "1842A001,10,1.50",
    ",12,1.75",
  ].join("\n");
  const plan = planFor(["part_number", "id_mm", "price_usd"]);
  const { rows, errors } = parseWithPlan(csv, plan);

  assert.deepEqual(errors, []);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].partNumber, "1842A001");
  assert.equal(rows[1].partNumber, "");
});

test("two blank part numbers do not count as duplicates of each other", () => {
  const csv = ["part_number,id_mm,price_usd", ",10,1.50", ",12,1.75"].join("\n");
  const { rows, errors } = parseWithPlan(csv, planFor(["part_number", "id_mm", "price_usd"]));
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 2);
});
```

`planFor` already exists in that test file; reuse it rather than writing a new
helper.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — the parser still pushes "Part number is required."

- [ ] **Step 3: Let blanks through in the parser**

Replace the blank check at `src/lib/importCsv.ts:215`:

```ts
    const partNumber = cellAt(partAt?.at);
    if (partNumber) {
      const key = partNumber.toUpperCase();
      const first = seenPart.get(key);
      if (first !== undefined) {
        errors.push({
          row: rowNo,
          column: "part_number",
          message: `Part number "${partNumber}" already appears on row ${first}.`,
        });
      } else {
        seenPart.set(key, rowNo);
      }
    }
    // A blank cell is not an error any more: every line in a file is one item,
    // and the server mints a code for it once the admin has asked for that on
    // the review screen. Blanks are deliberately not compared to each other —
    // two blank rows are two products, not a duplicate.
```

- [ ] **Step 4: Carry the count through the review state**

In `src/lib/columnPlan.ts`, add to `ImportPlan`:

```ts
  /** Set by the admin on the review screen: mint codes for rows with no part number. */
  autoNumber: boolean;
```

and in `validatePlan`, nothing new is required — `autoNumber` is a boolean with
no invalid value. Update `parsePlanJson` so a missing field defaults to `false`;
an upload that does not mention it must not silently generate codes.

In `src/lib/catalogImport.ts`, add `blankRows: number` to the `review` variant of
`ImportState`, add `"needs-numbers"` to the `message` union, compute it in
`review()` from the parsed rows, and gate the apply path right after
`parseWithPlan` succeeds:

```ts
  const blankRows = rows.filter((row) => row.partNumber === "").length;
  if (blankRows > 0 && !plan.autoNumber) {
    // The admin has to say so explicitly. Generating codes on their behalf is
    // the one action here that cannot be undone: a code, once issued, is never
    // reused, so a mistaken upload permanently burns numbers.
    return { kind: "message", familyId, message: "needs-numbers", detail: String(blankRows) };
  }
```

- [ ] **Step 5: Allocate inside the write transaction**

In `src/db/importQueries.ts`, inside `sql.begin`, immediately after the
conflict/case-variant check and before `maxSort` is read:

```ts
      // Codes are minted here, not in the route, so a failed write rolls the
      // reservation back with everything else. The family row is locked for
      // the duration, which is what stops two uploads minting the same code.
      const needing = rows.filter((row) => row.partNumber === "");
      if (needing.length > 0) {
        const minted = await allocatePartNumbers(tx, familyId, needing.length);
        needing.forEach((row, i) => {
          row.partNumber = minted[i];
        });
      }
      await registerExistingPartNumbers(
        tx,
        familyId,
        rows.map((row) => row.partNumber),
      );
```

`rows` is mutated in place on purpose: every later step in this function
(`parts`, `byPart`, `uploaded`) keys off `row.partNumber`, and re-deriving those
maps would be three more chances to miss one.

- [ ] **Step 6: Add the admin choice**

In `ColumnReview.tsx`, above the existing mode fieldset, when `blankRows > 0`:

```tsx
      {blankRows > 0 && (
        <fieldset className="mt-3 rounded border border-[var(--color-rule)] p-2">
          <legend className="text-[12px] font-bold">{t.reviewBlankParts}</legend>
          <p className="text-[11px] text-[var(--color-ink-muted)]">
            {t.reviewBlankPartsHint.replace("{count}", formatInt(blankRows, locale))}
          </p>
          <label className="mt-1 flex items-start gap-1.5 text-[12px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={autoNumber}
              onChange={(e) => setAutoNumber(e.target.checked)}
            />
            <span>{t.reviewBlankPartsGenerate}</span>
          </label>
        </fieldset>
      )}
```

Disable the apply button while `blankRows > 0 && !autoNumber`, and post
`autoNumber` as part of the plan JSON.

New i18n keys, English and Persian, added to both dictionaries in
`src/lib/i18n.ts`:

```ts
  reviewBlankParts: "Rows with no part number",
  reviewBlankPartsHint:
    "{count} rows have an empty part number. Each one becomes a new product with a new TEMEX code. Codes are never reused, so cancel and fix the file if that is not what you meant.",
  reviewBlankPartsGenerate: "Create new TEMEX part numbers for these rows",
  importNeedsNumbers: "Some rows have no part number. Choose to create codes, or upload a different file.",
```

```ts
  reviewBlankParts: "ردیف‌های بدون شماره قطعه",
  reviewBlankPartsHint:
    "‏{count} ردیف شماره قطعه ندارد. هر کدام کالای جدیدی با شمارهٔ تمکس تازه می‌شود. شماره‌ها هرگز دوباره استفاده نمی‌شوند؛ اگر منظورتان این نیست، لغو کنید و فایل را اصلاح کنید.",
  reviewBlankPartsGenerate: "برای این ردیف‌ها شمارهٔ قطعهٔ تمکس ساخته شود",
  importNeedsNumbers: "برخی ردیف‌ها شماره قطعه ندارند. یا ساخت شماره را انتخاب کنید یا فایل دیگری بارگذاری کنید.",
```

Wire `"needs-numbers"` into `ImportFeedback.tsx` alongside the other message
values so the admin sees `importNeedsNumbers` rather than a blank panel.

- [ ] **Step 7: Prove the end-to-end write**

Append to `src/db/partNumbers.integration.test.ts`:

```ts
test("an import row with no part number gets a minted code", async () => {
  const slug = `pn-import-${Date.now()}`;
  const familyId = await makeFamily(slug);
  const { writeImport } = await import("./importQueries");

  const row = {
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
  const result = await writeImport(familyId, [row]);
  assert.equal(result.inserted, 1);

  const [{ familyNumber }] = await sql<{ familyNumber: number }[]>`
    SELECT family_number AS "familyNumber" FROM product_families WHERE id = ${familyId}
  `;
  const [product] = await sql<{ partNumber: string }[]>`
    SELECT part_number AS "partNumber" FROM products WHERE family_id = ${familyId}
  `;
  assert.equal(product.partNumber, `${familyNumber}A001`);

  await sql`DELETE FROM categories WHERE slug = ${slug}`;
  await sql`DELETE FROM part_number_registry WHERE family_number = ${familyNumber}`;
});
```

- [ ] **Step 8: Run everything**

```bash
npm test
npm run test:db:part-numbers
npx tsc --noEmit
npm run build
```

Expected: all clean. `npm run build` matters here because `ColumnReview.tsx`
and `ImportFeedback.tsx` are inside a route segment.

- [ ] **Step 9: Commit**

```bash
git add src/lib/importCsv.ts src/lib/importCsv.test.ts src/lib/columnPlan.ts src/lib/catalogImport.ts src/db/importQueries.ts src/db/partNumbers.integration.test.ts "src/app/[locale]/admin/(panel)/products/ColumnReview.tsx" "src/app/[locale]/admin/(panel)/products/ImportFeedback.tsx" src/lib/i18n.ts
git commit -m "feat: mint part numbers for CSV rows that leave it blank"
```

---

### Task 4: Add a single product from the admin

**Files:**
- Create: `src/app/[locale]/admin/(panel)/products/[id]/new/page.tsx`
- Create: `src/app/[locale]/admin/(panel)/products/[id]/new/NewProductForm.tsx`
- Create: `src/app/[locale]/admin/(panel)/products/[id]/new/actions.ts`
- Modify: `src/app/[locale]/admin/(panel)/products/page.tsx` (link to the form from the family panel, beside "Catalog import")
- Modify: `src/lib/i18n.ts`
- Test: `e2e/admin-products-taxonomy.spec.ts`

**Interfaces:**
- Consumes: `getFamilyForImport` (`src/db/importQueries.ts:40`), `writeImport`
  (same file), `assertAdminWrite` (`src/lib/admin.ts`), `ImportRow`
  (`src/lib/importCsv.ts:62`).
- Produces: `createProductAction(familyId: number, form: FormData): Promise<CreateProductState>`
  where `CreateProductState = { kind: "ok"; partNumber: string } | { kind: "error"; message: string }`.

- [ ] **Step 1: Write the server action**

```ts
// src/app/[locale]/admin/(panel)/products/[id]/new/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { assertAdminWrite } from "@/lib/admin";
import { getFamilyForImport, writeImport } from "@/db/importQueries";
import { parseNumeric } from "@/lib/columnPlan";
import type { ImportRow } from "@/lib/importCsv";

export type CreateProductState =
  | { kind: "ok"; partNumber: string }
  | { kind: "error"; message: string };

/**
 * One product, through the same write path as a one-row CSV import.
 *
 * Reusing `writeImport` is deliberate: product counts, the facet index and the
 * inventory reconciliation all live in there, and a second insert path would be
 * a second place for them to drift.
 */
export async function createProductAction(
  familyId: number,
  form: FormData,
): Promise<CreateProductState> {
  await assertAdminWrite();

  const family = await getFamilyForImport(familyId);
  if (!family) return { kind: "error", message: "not-found" };

  const specs: Record<string, string | number> = {};
  for (const def of family.defs) {
    const raw = String(form.get(`spec.${def.key}`) ?? "").trim();
    if (raw === "") continue;
    if (def.kind === "number") {
      const parsed = parseNumeric(raw);
      if (parsed === null) return { kind: "error", message: `bad-number:${def.key}` };
      specs[def.key] = parsed;
    } else {
      specs[def.key] = raw;
    }
  }

  const int = (name: string, fallback = 0): number => {
    const raw = String(form.get(name) ?? "").trim();
    if (raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
  };

  const priceUsd = Number(String(form.get("price_usd") ?? "0").trim() || "0");
  if (!Number.isFinite(priceUsd) || priceUsd < 0) {
    return { kind: "error", message: "bad-price" };
  }

  const row: ImportRow = {
    // Blank on purpose: the allocator mints the code inside the transaction.
    partNumber: "",
    specs,
    priceCents: Math.round(priceUsd * 100),
    packQty: int("pack_qty", 1) || 1,
    leadDays: int("lead_days"),
    inStock: form.get("in_stock") === "on",
    inventoryAvailable: int("inventory_available"),
    inventoryOnHold: 0,
    inventorySold: 0,
    imageUrl: String(form.get("image_url") ?? "").trim() || undefined,
  };

  const result = await writeImport(familyId, [row]);
  if (result.inserted !== 1) return { kind: "error", message: "not-created" };

  revalidatePath("/", "layout");
  return { kind: "ok", partNumber: row.partNumber };
}
```

`writeImport` mutates `row.partNumber` in place (Task 3, Step 5), which is why
the action can read the minted code back off `row`.

- [ ] **Step 2: Build the page and form**

`page.tsx` is a server component: it loads the family with `getFamilyForImport`,
404s when missing, and renders `<NewProductForm>` with `family.defs`, the family
name for the heading, and the locale. `NewProductForm.tsx` is a client component
that renders one labelled input per spec definition (using `def.labelEn` /
`def.labelFa` and `def.unit`), then price, pack quantity, lead days, in-stock
checkbox, available quantity and image URL, and calls `createProductAction` in a
transition. On success it shows the minted part number and clears the spec
fields, so adding a second similar product is one edit rather than a full
retype. Match the existing form styling in `NewFamilyForm.tsx`.

Reuse the existing `price` key for the price label (`src/lib/i18n.ts:75`). New
keys in both dictionaries: `newProduct` ("Add a product" / «افزودن کالا»),
`newProductIntro`, `newProductCreated` ("Created {part}." / «ساخته شد: {part}»),
`newProductBadNumber`, `newProductBadPrice`.

- [ ] **Step 3: Extend the e2e admin test**

In `e2e/admin-products-taxonomy.spec.ts`, after the existing family assertions:

```ts
test("admin can add one product and it receives a TEMEX code", async ({ page }) => {
  // openProducts signs in when the session is cold and sets the rate-limit
  // header the suite uses to keep parallel specs from throttling each other.
  await openProducts(page, "en", "203.0.113.41");
  await page.goto("/en/admin/products/1/new");
  await page.getByLabel(getDict("en").price).fill("1.25");
  await page.getByRole("button", { name: getDict("en").newProduct }).click();
  await expect(page.getByText(/\d{4}[A-HJ-NP-Z]\d{3}/)).toBeVisible();
});
```

The helper in that file is `openProducts(page, locale, testAddress)` — there is
no `signInAsAdmin`. Give this test its own address, as the existing tests do.
Use the real dictionary keys for the labels rather than loose regexes, so the
test fails when a label is renamed instead of matching something else.

- [ ] **Step 4: Run the suites**

```bash
npx tsc --noEmit
npm run build
npm test
```

then the e2e recipe from `docs/LOCAL-DEV.md` (production server on :3100 with the
local database forced in and `E2E_ADMIN_PASSWORD` set).

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/admin/(panel)/products/[id]/new" "src/app/[locale]/admin/(panel)/products/page.tsx" src/lib/i18n.ts e2e/admin-products-taxonomy.spec.ts
git commit -m "feat: add a single product from the admin"
```

---

### Task 5: Removed from scope

The owner explicitly declined existing-catalog renumbering on 2026-09-21.
Do not add a renumbering script or rewrite product/order part numbers.

---

## Deploy sequence

1. Pass lint, TypeScript, unit/database/browser tests, the production dependency audit, and a production build against an isolated local database.
2. Verify recovery evidence and obtain the owner's production go-ahead.
3. Apply `20260920120000_add_temex_part_numbers.sql` using `MIGRATION_BACKUP_VERIFIED=<today-UTC> npm run db:migrate:remote` **before** deploying the application. The migration preserves all product numbers and binds any reservations left by earlier local feature testing.
4. Run `npm run db:verify:remote` and `npm run db:reconcile:check:remote`.
5. Merge the tested changes into `main`, push, and verify Vercel's production commit and storefront behavior, including `/` to `/fa` and the English language switch.

## Self-review notes

- The spec's identity-fingerprint sections (01 §4–6, 03 §A–B, 06's hashing
  helpers, 09's identity field lists) are deliberately unimplemented; decision 2
  replaces them with part-number matching. Nothing else in the spec is unclaimed:
  format and letters → Task 1; database guarantees and concurrency → Task 2;
  blank rows, review screen and idempotent re-upload → Task 3; single product
  creation → Task 4. Task 5 was removed by the owner.
- Not built, and worth saying out loud rather than discovering later: per-family
  capacity warnings in the admin UI (the allocator throws
  `FamilyCapacityExhausted`, now shown as a localized error without partial writes), and any
  storefront change — the code renders wherever `part_number` already renders.
