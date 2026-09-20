import "server-only";

import type { TransactionSql } from "postgres";
import {
  MAX_FAMILY_NUMBER,
  MAX_VARIANTS_PER_FAMILY,
  MIN_FAMILY_NUMBER,
  formatPartNumber,
  isTemexPartNumber,
  variantOrdinalOf,
} from "@/lib/partNumber";

type Tx = TransactionSql<Record<string, never>>;

export class FamilyCapacityExhausted extends Error {
  constructor(readonly familyNumber: number) {
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
 * This family's 4-digit prefix, assigned on first use.
 *
 * `FOR UPDATE` is what serialises two uploads into one family. Without it both
 * read the same counter, both compute the same code, and the unique index turns
 * a routine import into a failed one — after the operator has already waited
 * for the upload.
 */
export async function ensureFamilyNumber(tx: Tx, familyId: number): Promise<number> {
  const [family] = await tx<{ familyNumber: number | null }[]>`
    SELECT family_number AS "familyNumber" FROM product_families
    WHERE id = ${familyId} FOR UPDATE
  `;
  if (!family) throw new Error(`No family ${familyId}`);
  if (family.familyNumber !== null) return family.familyNumber;

  /*
   * Sequential, with no ranges reserved per category: the number means nothing
   * by itself, so the only rules are that it is free and never reused.
   *
   * The registry is consulted as well as the families table, because deleting a
   * family removes its row but not its reservations. Counting only live
   * families would hand 1001 to a new family whose first allocation then
   * collides with the deleted family's registry slots — an import failing on a
   * unique-index violation with nothing on screen to explain it.
   */
  const [next] = await tx<{ candidate: number }[]>`
    SELECT GREATEST(
      COALESCE((SELECT MAX(family_number) FROM product_families), ${MIN_FAMILY_NUMBER - 1}),
      COALESCE((SELECT MAX(family_number) FROM part_number_registry), ${MIN_FAMILY_NUMBER - 1})
    )::int + 1 AS candidate
  `;
  /*
   * Step over any prefix the catalog is already using.
   *
   * The seeded catalog carries supplier codes shaped exactly like ours —
   * `1000A100` and its neighbours sit in another family. Handing 1000 to a new
   * family works for its first 99 products and then collides on the products
   * unique index at A100: an import that has been fine all week suddenly fails
   * with nothing on screen to explain it.
   *
   * `LIKE 'nnnn%'` uses the part number index because this database is
   * initialised with the C locale.
   */
  let candidate = next.candidate;
  while (candidate <= MAX_FAMILY_NUMBER) {
    const [taken] = await tx<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM products WHERE part_number LIKE ${String(candidate)} || '%'
      ) AS exists
    `;
    if (!taken.exists) break;
    candidate += 1;
  }
  if (candidate > MAX_FAMILY_NUMBER) throw new FamilyNumbersExhausted();
  next.candidate = candidate;

  await tx`
    UPDATE product_families SET family_number = ${next.candidate} WHERE id = ${familyId}
  `;
  return next.candidate;
}

/**
 * `count` fresh codes for this family, in order, reserved in the registry
 * before they are handed back.
 */
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
  const firstOrdinal = family.nextOrdinal;

  /*
   * The counter alone is not proof that a code is free.
   *
   * `ensureFamilyNumber` keeps a new family off a prefix the catalog already
   * uses, but a later upload can still bring in a product whose supplier code
   * happens to land inside this family's range. Colliding with it would abort
   * the whole import on the products unique index, so step past it instead.
   */
  let start = firstOrdinal;
  let codes: string[] = [];
  let ordinals: number[] = [];
  for (let attempt = 0; ; attempt++) {
    if (start + count - 1 > MAX_VARIANTS_PER_FAMILY) {
      throw new FamilyCapacityExhausted(familyNumber);
    }
    codes = [];
    ordinals = [];
    for (let i = 0; i < count; i++) {
      ordinals.push(start + i);
      codes.push(formatPartNumber(familyNumber, start + i));
    }
    const clashes = await tx<{ partNumber: string }[]>`
      SELECT part_number AS "partNumber" FROM products
      WHERE part_number = ANY(${codes}::text[])
    `;
    if (clashes.length === 0) break;
    if (attempt >= 8) throw new FamilyCapacityExhausted(familyNumber);
    const highest = Math.max(
      ...clashes.map((clash) => variantOrdinalOf(clash.partNumber) ?? 0),
    );
    start = highest + 1;
  }

  await tx`
    INSERT INTO part_number_registry (part_number, family_number, variant_ordinal)
    SELECT u.part_number, ${familyNumber}, u.variant_ordinal::int
    FROM unnest(${codes}::text[], ${ordinals}::int[]) AS u(part_number, variant_ordinal)
  `;
  await tx`
    UPDATE product_families SET next_variant_ordinal = ${start + count}
    WHERE id = ${familyId}
  `;
  return codes;
}

/**
 * Reserve codes that arrived in a file rather than from the allocator.
 *
 * Only this family's TEMEX-shaped codes are recorded. A legacy supplier number
 * like `2490T1` occupies no slot in this scheme, and inventing one for it would
 * block a real code later. Already-registered codes are left alone, so
 * re-uploading the same file stays idempotent.
 */
export async function registerExistingPartNumbers(
  tx: Tx,
  familyId: number,
  partNumbers: readonly string[],
): Promise<void> {
  const familyNumber = await ensureFamilyNumber(tx, familyId);
  const prefix = String(familyNumber);

  const mine: string[] = [];
  const ordinals: number[] = [];
  for (const part of partNumbers) {
    if (!isTemexPartNumber(part) || !part.startsWith(prefix)) continue;
    const ordinal = variantOrdinalOf(part);
    if (ordinal === null) continue;
    mine.push(part);
    ordinals.push(ordinal);
  }
  if (mine.length === 0) return;

  await tx`
    INSERT INTO part_number_registry (part_number, family_number, variant_ordinal)
    SELECT u.part_number, ${familyNumber}, u.variant_ordinal::int
    FROM unnest(${mine}::text[], ${ordinals}::int[]) AS u(part_number, variant_ordinal)
    ON CONFLICT (part_number) DO NOTHING
  `;
  // Move the counter past anything the file brought in, or the next allocation
  // collides with a code that already exists in the catalog.
  await tx`
    UPDATE product_families
    SET next_variant_ordinal = GREATEST(next_variant_ordinal, ${Math.max(...ordinals) + 1})
    WHERE id = ${familyId}
  `;
}
