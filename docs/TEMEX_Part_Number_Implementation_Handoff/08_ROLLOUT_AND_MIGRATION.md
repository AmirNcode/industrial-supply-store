# 08 — Rollout and Migration

## Phase 1 — Inventory Existing State

Identify:

- existing products
- existing SKU / internal codes
- existing part_number-like fields
- duplicate products
- current Excel import mechanism
- current taxonomy IDs
- current admin roles

Do not generate new TEMEX codes until the migration decision is approved.

## Phase 2 — Add Database Structures

Deploy:

- Product Family table/config
- Registry table
- Product `part_number` column
- audit table
- unique indexes

Do not make `part_number` required yet.

## Phase 3 — Seed Initial Families

Create initial families for currently stocked TEMEX products.

Do not create a family for every category.

Create a family based on how customers select the technical product.

Examples:

```text
Metric Buna-N O-Rings
Metric Silicone O-Rings
Metric FKM O-Rings
API 6A Slab / Through-Conduit Gate Valve
```

## Phase 4 — Decide Existing Product Policy

For products already live:

Option A — assign TEMEX part numbers in a controlled migration

Option B — keep legacy codes and assign TEMEX code only when reviewed

Recommended: controlled migration with duplicate analysis before assignment.

## Phase 5 — Enable Admin Assignment

Enable for new single-product creation first.

Monitor:

- allocation failures
- duplicate matches
- admin confusion over family selection

## Phase 6 — Enable Bulk Import

Add preflight and downloadable result report.

Initially limit import batch size if necessary.

## Phase 7 — Storefront and Documents

Expose part number in:

- product page
- search
- cart line
- order details
- invoice
- packing list
- warehouse labels
- QR/barcode payload if desired

## Phase 8 — Operational Controls

Create scheduled backup of the central database.

Registry does not need a separate JSON backup in production if the DB has proper backups, but an export feature is still useful for audits.

## No-Go Conditions

Do not launch if:

- allocation is performed in browser code
- no DB unique constraint exists
- no concurrency test has passed
- family identity definitions are not approved
- normal product edit can silently change an assigned part number
