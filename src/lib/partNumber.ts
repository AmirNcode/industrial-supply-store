/**
 * TEMEX part number: NNNN L NNN — family number, variant letter, variant number.
 *
 * The code is an identifier, not a description. Nothing about the product's
 * category, size or material is encoded in it, so reorganising the catalog —
 * renaming a category, moving a family under a different parent — never
 * invalidates a number already printed on a quote.
 */

/** `I` and `O` are omitted: on a printed label they read as `1` and `0`. */
export const TEMEX_VARIANT_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ".split("");

const PER_LETTER = 999;
export const MAX_VARIANTS_PER_FAMILY = TEMEX_VARIANT_LETTERS.length * PER_LETTER;

export const MIN_FAMILY_NUMBER = 1000;
export const MAX_FAMILY_NUMBER = 9999;

/** `000` is excluded: the variant number is 1-based, so it is not a code we
 *  ever mint, and accepting it would reserve a registry slot that can never be
 *  reached by the allocator. */
const PART_NUMBER_RE = new RegExp(
  `^[1-9][0-9]{3}[${TEMEX_VARIANT_LETTERS.join("")}](?!000)[0-9]{3}$`,
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

/**
 * The 1-based ordinal a TEMEX code occupies in its family.
 *
 * Inverse of `encodeVariantOrdinal`, used when a file supplies codes this
 * system generated earlier: the counter has to move past them, or the next
 * allocation collides with a code that already exists.
 */
export function variantOrdinalOf(partNumber: string): number | null {
  if (!isTemexPartNumber(partNumber)) return null;
  const letterIndex = TEMEX_VARIANT_LETTERS.indexOf(partNumber[4]);
  return letterIndex * PER_LETTER + Number(partNumber.slice(5));
}

/** True only for the canonical upper-case form this module generates. */
export function isTemexPartNumber(value: string): boolean {
  return PART_NUMBER_RE.test(value);
}
