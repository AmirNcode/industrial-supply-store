# 07 — Test Plan

## Unit Tests

### Variant Encoding

Assert:

```text
1     => A001
2     => A002
999   => A999
1000  => B001
1998  => B999
1999  => C001
23976 => Z999
```

Assert 0 and 23977 fail.

Assert generated suffix never contains `I` or `O`.

### Normalization

Examples:

```text
" Buna-N " == "buna-n"
"5,000" numeric == "5000"
"  API   6A " == "api 6a"
```

## Registry Tests

1. Same family + same identity → same part number
2. Same family + different identity → different part number
3. Different family + same raw attributes → different family prefix/code
4. Deleted/discontinued registry code is not reused
5. Part number unique index rejects collision
6. Family identity hash unique index rejects duplicate identity

## Product Edit Tests

1. Price edit leaves part number unchanged
2. Inventory edit leaves part number unchanged
3. Image edit leaves part number unchanged
4. Category move leaves part number unchanged
5. Identity field edit is blocked or routes to "Create New SKU"

## Bulk Import Tests

1. 1,000 new rows produce 1,000 codes
2. Reimport same file produces zero new codes
3. Duplicate row within same file reuses one code
4. Commercial-field changes on reimport do not create new codes
5. Missing required identity field produces row error
6. Existing explicit conflicting part number produces conflict
7. Partial row errors do not corrupt allocation counters

## Concurrency Tests — Mandatory

Run two or more simultaneous workers importing new variants into the same family.

Expected:

- no duplicate part numbers
- no duplicate variant ordinals
- no lost counter increments
- every committed identity maps to exactly one code

Test at minimum:

```text
10 concurrent workers × 100 new SKUs in one family
```

Expected 1,000 unique codes.

## O-Ring Acceptance Fixture

For one family with rows ordered:

```text
ID 1 / CS 1 / OD 3 / Buna-N / 70A
ID 1 / CS 1.5 / OD 4 / Buna-N / 70A
ID 1 / CS 2 / OD 5 / Buna-N / 70A
```

Expected for a fresh family:

```text
A001
A002
A003
```

Changing `price_usd` only must reuse the same suffix.

## API 6A Gate Valve Acceptance Fixture

For one family:

```text
2-1/16 / 3000 / DD
2-1/16 / 3000 / EE
2-1/16 / 3000 / EE-NL
2-1/16 / 5000 / DD
...
```

Each unique identity configuration gets one code.

Changing standard painting text only should not create a new code if painting is configured as non-identity.
