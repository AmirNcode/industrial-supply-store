# 05 — Recommended Backend API / Service Contract

The implementation can be internal service methods instead of HTTP endpoints.
Use this contract conceptually.

## 1. Assign or Reuse Part Number

`POST /admin/part-numbers/assign`

Request:

```json
{
  "product_family_id": 123,
  "attributes": {
    "valve_size": "2-1/16\"",
    "pressure_rating": 5000,
    "material_class": "EE",
    "psl": 3,
    "pr": 2
  }
}
```

Response:

```json
{
  "part_number": "6813A005",
  "status": "NEW_CODE",
  "product_family_id": 123,
  "family_number": 6813,
  "identity_hash": "..."
}
```

Existing match:

```json
{
  "part_number": "6813A005",
  "status": "REUSED_CODE",
  "product_family_id": 123,
  "family_number": 6813
}
```

## 2. Preflight Bulk Import

`POST /admin/product-imports/preflight`

Response per row:

```json
{
  "row": 14,
  "resolved_family_id": 123,
  "part_number": "6813A005",
  "coding_status": "REUSED_CODE",
  "errors": [],
  "warnings": []
}
```

## 3. Commit Bulk Import

`POST /admin/product-imports/:importId/commit`

Must not trust preflight-only allocation as final if concurrency is possible.

At commit, re-run authoritative assignment transaction.

## 4. Family Configuration

`GET /admin/product-families`

`POST /admin/product-families`

`PATCH /admin/product-families/:id`

Protect with role/permission checks.

## 5. Error Codes

Recommended machine-readable errors:

```text
PRODUCT_FAMILY_REQUIRED
PRODUCT_FAMILY_NOT_FOUND
IDENTITY_FIELD_REQUIRED
IDENTITY_CONFLICT
EXPLICIT_PART_NUMBER_CONFLICT
FAMILY_CAPACITY_EXHAUSTED
PART_NUMBER_ALLOCATION_RETRY
IMMUTABLE_PART_NUMBER
SKU_IDENTITY_CHANGE_REQUIRES_NEW_PRODUCT
```
