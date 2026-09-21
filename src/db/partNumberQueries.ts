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

export class PartNumberUnavailable extends Error {
  constructor(readonly parts: string[], readonly reason: "existing" | "reserved") {
    super(`Part numbers are ${reason}: ${parts.join(", ")}`);
    this.name = "PartNumberUnavailable";
  }
}

/**
 * Prefixes and supplied supplier codes share one namespace across families.
 * A family row lock cannot protect first allocation in different families.
 * Imports already update shared category counts, so serialising these rare
 * writes also keeps their conflict checks valid until commit. Take this lock
 * before any family/product row lock.
 */
export async function lockPartNumberWrites(tx: Tx): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(1842150101)`;
}

export async function ensureFamilyNumber(tx: Tx, familyId: number): Promise<number> {
  await lockPartNumberWrites(tx);
  const [family] = await tx<{ familyNumber: number | null }[]>`
    SELECT family_number AS "familyNumber" FROM product_families
    WHERE id = ${familyId} FOR UPDATE
  `;
  if (!family) throw new Error(`No family ${familyId}`);
  if (family.familyNumber !== null) return family.familyNumber;

  // Include live supplier prefixes and permanent reservations. MAX + 1 would
  // let one imported 9999A001 exhaust all lower, never-used family prefixes.
  const [next] = await tx<{ candidate: number }[]>`
    WITH occupied AS (
      SELECT family_number::text AS prefix FROM product_families WHERE family_number IS NOT NULL
      UNION SELECT family_number::text FROM part_number_registry
      UNION SELECT left(part_number, 4) FROM products
    )
    SELECT n AS candidate FROM generate_series(${MIN_FAMILY_NUMBER}::int, ${MAX_FAMILY_NUMBER}::int) n
    WHERE NOT EXISTS (SELECT 1 FROM occupied WHERE prefix = n::text)
    ORDER BY n LIMIT 1
  `;
  if (!next) throw new FamilyNumbersExhausted();
  await tx`UPDATE product_families SET family_number = ${next.candidate} WHERE id = ${familyId}`;
  return next.candidate;
}

/** Reserve fresh codes inside the same transaction that will insert products. */
export async function allocatePartNumbers(tx: Tx, familyId: number, count: number): Promise<string[]> {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`Invalid allocation count: ${count}`);
  if (count === 0) return [];

  const familyNumber = await ensureFamilyNumber(tx, familyId);
  const [family] = await tx<{ nextOrdinal: number }[]>`
    SELECT next_variant_ordinal AS "nextOrdinal" FROM product_families WHERE id = ${familyId}
  `;
  const occupied = await tx<{ partNumber: string }[]>`
    SELECT upper(part_number) AS "partNumber" FROM products
    WHERE part_number LIKE ${`${familyNumber}%`}
    UNION SELECT part_number FROM part_number_registry WHERE family_number = ${familyNumber}
  `;
  const used = new Set(occupied.map((row) => row.partNumber));
  const codes: string[] = [];
  const ordinals: number[] = [];
  let next = family.nextOrdinal;
  for (; next <= MAX_VARIANTS_PER_FAMILY && codes.length < count; next++) {
    const code = formatPartNumber(familyNumber, next);
    if (used.has(code)) continue;
    codes.push(code);
    ordinals.push(next);
  }
  if (codes.length !== count) throw new FamilyCapacityExhausted(familyNumber);
  await tx`
    INSERT INTO part_number_registry (part_number, family_number, variant_ordinal)
    SELECT u.part_number, ${familyNumber}, u.variant_ordinal
    FROM unnest(${codes}::text[], ${ordinals}::int[]) AS u(part_number, variant_ordinal)
  `;
  await tx`UPDATE product_families SET next_variant_ordinal = ${next} WHERE id = ${familyId}`;
  return codes;
}

/**
 * Reserve supplied TEMEX-shaped codes before minting blanks. A reservation is
 * reusable only by the same live product, never a replacement after deletion.
 * Uppercase keys also protect lowercase supplier spellings. Arbitrary supplier
 * codes remain supported and need no invented TEMEX ordinal.
 */
export async function registerExistingPartNumbers(tx: Tx, familyId: number, partNumbers: readonly string[]): Promise<void> {
  await lockPartNumberWrites(tx);
  const codes = [...new Set(partNumbers.map((part) => part.toUpperCase()).filter(isTemexPartNumber))];
  if (codes.length === 0) return;
  const unavailable = await tx<{ partNumber: string }[]>`
    SELECT r.part_number AS "partNumber" FROM part_number_registry r
    LEFT JOIN products p ON p.id = r.product_id
    WHERE r.part_number = ANY(${codes}::text[])
      AND (p.id IS NULL OR upper(p.part_number) <> r.part_number OR p.family_id <> ${familyId})
  `;
  if (unavailable.length) throw new PartNumberUnavailable(unavailable.map((r) => r.partNumber), "reserved");
  await tx`
    INSERT INTO part_number_registry (part_number, family_number, variant_ordinal, product_id)
    SELECT u.code, u.prefix, u.ordinal, p.id
    FROM unnest(${codes}::text[], ${codes.map((c) => Number(c.slice(0, 4)))}::int[],
                ${codes.map((c) => variantOrdinalOf(c)!)}::int[]) AS u(code, prefix, ordinal)
    LEFT JOIN products p ON upper(p.part_number) = u.code AND p.family_id = ${familyId}
    ON CONFLICT (part_number) DO NOTHING
  `;
  // Advance the owning range even when a supplier code was entered under a
  // different catalog family. Do not consume this family's unrelated range.
  await tx`
    UPDATE product_families f
    SET next_variant_ordinal = GREATEST(f.next_variant_ordinal,
      COALESCE((SELECT max(r.variant_ordinal) + 1 FROM part_number_registry r
                WHERE r.family_number = f.family_number), 1))
    WHERE f.family_number = ANY(${codes.map((code) => Number(code.slice(0, 4)))}::int[])
  `;
}
