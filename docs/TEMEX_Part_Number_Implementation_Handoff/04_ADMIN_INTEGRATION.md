# 04 — Admin Integration

## A. Product Form

Add these fields/components to Admin:

### Read-only after assignment

- TEMEX Part Number
- Product Family
- Family Number

### Editable

- taxonomy fields
- technical attributes
- commercial fields

### Product Family Selector

The admin must choose/resolve a Product Family before a new SKU can be coded.

Preferred UX:

1. Main Category
2. Category
3. Subcategory
4. Product Family
5. technical attributes

The family controls which technical fields are SKU-defining.

## B. Automatic Assignment Trigger

For a new product:

```text
Save Draft / Create Product
→ validate Product Family
→ validate required identity fields
→ backend assigns/reuses Part Number
→ save product
```

The browser must never invent the final part number.

## C. Bulk Excel / CSV Upload

Extend the existing admin import flow.

Recommended stages:

### Stage 1 — Upload

Accept the site's current supported file types.

### Stage 2 — Column Mapping

Map source columns to:

- Product Family or taxonomy fields
- technical attributes
- commercial attributes

### Stage 3 — Preflight

For every row, show:

- resolved Product Family
- identity-field validation
- generated/reused part number preview
- duplicate status
- warnings/errors

Do not commit products yet if the current platform supports a two-step import.

### Stage 4 — Commit

Run rows in batches.

Each row should be independently reportable, but part-number allocation must remain transactional.

### Stage 5 — Result

Downloadable result file should include:

```text
part_number
coding_status
coding_note
product_id
original_row_number
```

## D. Family Templates

Add an Admin configuration screen:

```text
Product Family
Family Number
Taxonomy path
Identity fields
Required identity fields
Normalization rules
Active/Inactive
```

Only privileged admins should edit identity schemas.

Changing the identity schema after real codes exist is dangerous.

If identity schema must change:

- version the schema
- run impact analysis
- do not retroactively renumber existing products

## E. Automatic Family Resolution

Best approach:

1. if import row contains explicit `product_family_id` / family key, use it
2. otherwise resolve by taxonomy mapping
3. if still ambiguous, stop row and require admin mapping
4. do not guess between two plausible families

Machine-learning/heuristic detection may be used only as an admin suggestion, not as the final authoritative allocator.

## F. Duplicate UI

When upload matches an existing registry identity:

```text
REUSED_CODE: 1842A004
```

Admin should be able to see which existing product owns that code.

## G. Search and Display

Admin:

- search by Part Number
- filter by Family Number/Product Family
- show code in product list

Storefront:

- show Part Number near product title/specification
- make it searchable
- preserve code in cart, order line, invoice, packing list if available
