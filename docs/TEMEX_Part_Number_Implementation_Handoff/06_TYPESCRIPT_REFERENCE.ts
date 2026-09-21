// 06 — TypeScript Reference
// Adapt to the project's framework/ORM.
// This file intentionally focuses on deterministic helpers.

import crypto from "node:crypto";

export const TEMEX_VARIANT_LETTERS =
  "ABCDEFGHJKLMNPQRSTUVWXYZ".split("");

export const MAX_VARIANTS_PER_FAMILY =
  TEMEX_VARIANT_LETTERS.length * 999; // 23,976

export function encodeVariantOrdinal(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > MAX_VARIANTS_PER_FAMILY) {
    throw new Error("Variant ordinal out of range");
  }

  const zero = ordinal - 1;
  const letterIndex = Math.floor(zero / 999);
  const numeric = (zero % 999) + 1;

  return `${TEMEX_VARIANT_LETTERS[letterIndex]}${String(numeric).padStart(3, "0")}`;
}

export function formatPartNumber(
  familyNumber: number,
  variantOrdinal: number
): string {
  if (!Number.isInteger(familyNumber) || familyNumber < 1000 || familyNumber > 9999) {
    throw new Error("Family number out of range");
  }

  return `${familyNumber}${encodeVariantOrdinal(variantOrdinal)}`;
}

export function normalizeString(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeNumeric(value: unknown): string {
  const raw = normalizeString(value).replace(/,/g, "");
  if (raw === "") return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return String(n);
}

export type IdentityFieldConfig = {
  key: string;
  type?: "string" | "number";
  aliases?: Record<string, string>;
};

export function buildCanonicalIdentity(
  attributes: Record<string, unknown>,
  fields: IdentityFieldConfig[]
): Record<string, string> {
  const entries = fields.map((field) => {
    let normalized =
      field.type === "number"
        ? normalizeNumeric(attributes[field.key])
        : normalizeString(attributes[field.key]);

    if (field.aliases) {
      const mapped = field.aliases[normalized];
      if (mapped !== undefined) normalized = normalizeString(mapped);
    }

    return [field.key, normalized] as const;
  });

  // Deterministic ordering.
  entries.sort(([a], [b]) => a.localeCompare(b));

  return Object.fromEntries(entries);
}

export function canonicalJson(payload: Record<string, string>): string {
  const keys = Object.keys(payload).sort();
  const ordered: Record<string, string> = {};
  for (const key of keys) ordered[key] = payload[key];
  return JSON.stringify(ordered);
}

export function identityHash(payload: Record<string, string>): string {
  return crypto
    .createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

/*
Database-backed allocator pseudocode:

async function assignPartNumber(tx, familyId, attributes) {
  const familyConfig = await tx.productFamily.findUniqueOrThrow({ where: { id: familyId } });

  const identity = buildCanonicalIdentity(attributes, familyConfig.identityFields);
  const hash = identityHash(identity);

  const existing = await tx.partNumberRegistry.findUnique({
    where: { product_family_id_identity_hash: { product_family_id: familyId, identity_hash: hash } }
  });

  if (existing) return { partNumber: existing.part_number, status: "REUSED_CODE" };

  // IMPORTANT:
  // Use raw SQL SELECT ... FOR UPDATE or an ORM-supported row lock on the family row.
  const lockedFamily = await lockFamilyRowForUpdate(tx, familyId);

  // Recheck after lock because another transaction may have inserted while we waited.
  const existingAfterLock = await tx.partNumberRegistry.findUnique(...);
  if (existingAfterLock) return { ... };

  const ordinal = lockedFamily.next_variant_ordinal;
  const partNumber = formatPartNumber(lockedFamily.family_number, ordinal);

  await tx.partNumberRegistry.create(...);
  await tx.productFamily.update({
    where: { id: familyId },
    data: { next_variant_ordinal: ordinal + 1 }
  });

  return { partNumber, status: "NEW_CODE" };
}
*/
