# TEMEX Part Number System — Coding Agent Handoff

## Goal

Implement automatic TEMEX part-number assignment inside the online store admin/product-management workflow.

Every product created individually or uploaded in bulk must receive a short, immutable, unique TEMEX Part Number from the backend.

The implementation must be **server-side and database-backed**. Do not use browser `localStorage` or client-generated counters in production.

## Part Number Format

```text
NNNNLNNN
```

Where:

- `NNNN` = 4-digit Product Family Number, from `1000` to `9999`
- `L` = variant letter
- `NNN` = variant sequence from `001` to `999`
- Allowed letters: `A B C D E F G H J K L M N P Q R S T U V W X Y Z`
- Do **not** use `I` or `O`, to avoid confusion with `1` and `0`

Examples:

```text
1842A001
1842A002
6813A008
6813B001
```

Each product family supports 23,976 variants (`24 × 999`).

## Non-Negotiable Rules

1. A part number is an **identifier**, not a compressed technical description.
2. Category names, sizes, materials, pressure classes, etc. must not be encoded directly into the part number.
3. A part number is immutable after assignment.
4. Moving a product to another category must not change its part number.
5. The same technical SKU must never receive two different part numbers.
6. Two different technical SKUs must never share one part number.
7. Price, stock, lead time, images, warehouse quantity, and other volatile fields must not change product identity.
8. Assignment must be concurrency-safe for simultaneous admin users/import jobs.
9. All uniqueness guarantees must be enforced in the database, not only in application code.
10. Bulk imports must be idempotent: importing the same products again must reuse the same existing part numbers.

## Recommended Integration Flow

```text
Admin creates/edits product
        OR
Admin uploads Excel/CSV
            |
            v
Product import/parser
            |
            v
Resolve Product Family
            |
            v
Build canonical SKU identity payload
            |
            v
Find existing identity in registry
      / yes              \ no
reuse part number      allocate next suffix
      \                  /
       v                v
      save product + registry
            |
            v
Admin preview / result report
```

## Package Contents

- `01_SYSTEM_SPEC.md` — full behavior and business rules
- `02_DATABASE_SCHEMA.sql` — reference PostgreSQL schema
- `03_ASSIGNMENT_ALGORITHM.md` — exact allocation algorithm and normalization rules
- `04_ADMIN_INTEGRATION.md` — admin UI, bulk upload, preview, errors
- `05_API_CONTRACT.md` — recommended backend service/API contract
- `06_TYPESCRIPT_REFERENCE.ts` — implementation reference for the core encoder/normalizer
- `07_TEST_PLAN.md` — unit/integration/concurrency/acceptance tests
- `08_ROLLOUT_AND_MIGRATION.md` — safe rollout into an existing store
- `09_FAMILY_CONFIG_EXAMPLES.json` — O-Ring and API 6A Gate Valve examples
- `10_ACCEPTANCE_CRITERIA.md` — Definition of Done
- `fixtures/orings_input.csv`
- `fixtures/gate_valves_input.csv`

## Implementation Philosophy

Use a **configuration-driven family identity model**.

Different product families have different SKU-defining attributes:

- Metric O-Ring: ID, cross section, OD, material, hardness, color if color is a real SKU distinction
- API 6A Gate Valve: size, working pressure, material class, PSL, PR, end connection, operation, etc.
- Price and inventory are never identity fields

Do not build one global hard-coded list of identity fields for all industrial products.

## Preferred Production Architecture

- `product_families` stores immutable family numbers and the identity-field definition
- `part_number_registry` stores the canonical SKU fingerprint → part-number mapping
- `products.part_number` stores the assigned code for fast storefront/admin use
- allocation happens inside a database transaction
- the family row/counter is locked while allocating a new variant suffix

## Important

The sample HTML prototype created earlier was for demonstrating the coding concept only. Production implementation must use the website backend and central database.
