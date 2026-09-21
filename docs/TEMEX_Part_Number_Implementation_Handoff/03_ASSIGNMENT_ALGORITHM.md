# 03 — Assignment Algorithm

## A. Canonical Normalization

Before fingerprinting identity:

- trim strings
- collapse repeated whitespace
- normalize case for case-insensitive technical values
- normalize Unicode
- normalize units before hashing when feasible
- normalize numeric strings to canonical numeric values
- preserve meaningful distinctions such as 2-1/16 vs 2-1/8
- map known synonyms to canonical controlled values

Examples:

```text
" Buna-N " -> "buna-n"
"API 6A" -> "api 6a"
"5,000" -> 5000
"5000 psi" -> value=5000, unit="psi" when the data model supports separate units
```

Do not include volatile/commercial fields in the fingerprint.

## B. Canonical Identity Payload

Build a JSON object using the Product Family's configured `identity_fields`.

Sort keys deterministically before hashing.

Example:

```json
{
  "id_mm": "1",
  "cross_section_mm": "1.5",
  "od_mm": "4",
  "material": "buna-n",
  "hardness": "70a"
}
```

Hash:

```text
SHA-256(canonical_json)
```

## C. Variant Encoding

Allowed letters:

```text
ABCDEFGHJKLMNPQRSTUVWXYZ
```

There are 24 letters.

Given 1-based `variant_ordinal`:

```text
letterIndex = floor((variant_ordinal - 1) / 999)
number      = ((variant_ordinal - 1) % 999) + 1
suffix      = LETTERS[letterIndex] + number.padStart(3, "0")
```

Examples:

```text
1     => A001
2     => A002
999   => A999
1000  => B001
1998  => B999
1999  => C001
23976 => Z999
```

## D. Allocation Transaction

Pseudocode:

```text
function assignPartNumber(productFamilyId, rawAttributes):

  identityPayload = buildCanonicalIdentity(productFamilyId, rawAttributes)
  identityHash = sha256(canonicalJson(identityPayload))

  BEGIN TRANSACTION

  existing = SELECT *
             FROM part_number_registry
             WHERE product_family_id = :familyId
               AND identity_hash = :hash

  if existing:
      COMMIT
      return existing.part_number

  family = SELECT *
           FROM product_families
           WHERE id = :familyId
           FOR UPDATE

  ordinal = family.next_variant_ordinal

  if ordinal > 23976:
      ROLLBACK
      throw FAMILY_CAPACITY_EXHAUSTED

  suffix = encodeVariantOrdinal(ordinal)
  partNumber = family.family_number + suffix

  INSERT part_number_registry (
      product_family_id,
      part_number,
      variant_ordinal,
      identity_hash,
      identity_payload
  )

  UPDATE product_families
  SET next_variant_ordinal = ordinal + 1
  WHERE id = :familyId

  COMMIT

  return partNumber
```

## E. Why the Lock Matters

Without `FOR UPDATE`, two concurrent uploads can read the same `next_variant_ordinal` and generate the same code.

The database unique indexes are the final safety net, but the normal path should serialize allocation per family.

## F. Family Creation

When a new Product Family is created:

1. create stable `canonical_key`
2. allocate 4-digit `family_number` from DB sequence
3. store identity schema
4. never change that family number later

If the same canonical family already exists, reuse it.

## G. Existing Product Edit

Normal edit:

```text
if product already has part_number:
    do not call allocator again
```

If identity-defining fields change:

```text
compare old canonical identity with new canonical identity

if changed:
    block normal save OR route to "Create New SKU"
```

Recommended admin UX: "This change alters SKU identity. Create a new TEMEX SKU instead?"
