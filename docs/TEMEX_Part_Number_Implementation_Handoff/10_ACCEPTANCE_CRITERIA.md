# 10 — Definition of Done / Acceptance Criteria

The feature is complete only when all items below are true.

## Core Assignment

- [ ] New admin-created product automatically receives a TEMEX Part Number
- [ ] Bulk uploaded products automatically receive/reuse TEMEX Part Numbers
- [ ] Assignment runs on backend, not browser
- [ ] Part number matches `NNNNLNNN`
- [ ] `I` and `O` are never generated
- [ ] Family number is 1000–9999
- [ ] Variant capacity is enforced

## Idempotency

- [ ] Re-uploading identical SKU data reuses the same code
- [ ] Changing price/stock/image/lead time does not create a new code
- [ ] Duplicate input rows do not allocate duplicate new codes

## Integrity

- [ ] DB unique constraint exists on part number
- [ ] DB unique constraint exists on `(product_family_id, identity_hash)`
- [ ] DB unique constraint exists on `(product_family_id, variant_ordinal)`
- [ ] Concurrency test passes
- [ ] Deleted/discontinued codes are never recycled

## Product Lifecycle

- [ ] Normal product editing cannot change an assigned part number
- [ ] Moving taxonomy does not change code
- [ ] Identity-defining change is blocked or creates a new SKU
- [ ] Privileged correction actions are audited

## Admin UX

- [ ] Product form displays read-only Part Number after assignment
- [ ] Product Family is visible/selectable
- [ ] Bulk import has preflight or clear row-level result reporting
- [ ] Import result includes part number and coding status
- [ ] Admin can search products by part number

## Storefront / Operations

- [ ] Product page displays TEMEX Part Number
- [ ] Store search can find exact part number
- [ ] Order lines retain the part number snapshot
- [ ] Part number can be exposed to invoice/packing list/warehouse labels as applicable

## Configuration

- [ ] Product Family has configurable identity fields
- [ ] Only authorized roles can change identity schema
- [ ] O-Ring family is configured and tested
- [ ] API 6A Gate Valve family is configured and tested

## Deployment

- [ ] Existing products are migrated according to an approved policy
- [ ] Production database backups include registry tables
- [ ] Monitoring/logging exists for allocation errors
