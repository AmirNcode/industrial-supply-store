# 01 — System Specification

## 1. Scope

Implement TEMEX part-number assignment in:

1. Single product creation in Admin
2. Single product duplication
3. Product editing
4. Excel/CSV bulk upload
5. API-based product creation, if the store exposes one
6. Future ERP/PIM synchronization

The storefront should display the assigned code as:

```text
TEMEX Part No. 6813A008
```

## 2. Taxonomy vs Part Number

Keep these concepts separate:

```text
Main Category
→ Category
→ Subcategory
→ Product Family
→ Variant/SKU
→ TEMEX Part Number
```

The taxonomy may change. The part number must not.

A product family is a stable commercial/technical grouping used to allocate part numbers.

Examples:

```text
Seals, Packing & Gaskets
→ O-Rings
→ Metric O-Rings
→ Metric Buna-N (NBR) O-Rings
```

```text
Industrial Valves
→ API 6A Valves
→ Gate Valves
→ Slab / Through-Conduit Gate Valve
```

## 3. Family Number

Each Product Family receives exactly one immutable 4-digit `family_number`.

Example:

```text
1842 = Metric Buna-N (NBR) O-Rings
6813 = API 6A Slab / Through-Conduit Gate Valve
```

The number itself does not need to carry meaning.

Do not reserve number ranges by category unless TEMEX explicitly changes this rule later.

## 4. Variant Identity

Each Product Family owns an `identity_schema`.

The schema is the set of attributes that determine whether two rows represent the same sellable technical SKU.

Examples:

### Metric O-Ring

Identity may be:

```text
id_mm
cross_section_mm
od_mm
material
hardness
```

Non-identity fields:

```text
price
pack_qty
lead_days
in_stock
inventory_available
inventory_on_hold
inventory_sold
image_url
```

### API 6A Slab Gate Valve

Likely identity fields:

```text
type
design_standard
valve_size
pressure_rating
bore_type
bore_size
end_connection
body_material
gate_seat_material_and_coating
stem_material
operation
material_class
temperature_class
psl
pr
service
```

Fields that are completely derived from the selected configuration may be excluded from identity if they cannot vary independently.

Custom/request-only options should not automatically create a new stock SKU unless TEMEX intentionally promotes that configuration to a standard sellable SKU.

## 5. Identity Stability

Once a product has a part number:

- editing price must not change the code
- editing inventory must not change the code
- changing images must not change the code
- changing description text must not change the code
- moving taxonomy/category must not change the code

If a user edits an identity-defining technical attribute on an already-coded product, the system must not silently mutate the original identity.

Recommended behavior:

1. warn that the change creates a different SKU identity
2. require one of:
   - create a new product/SKU and assign a new code
   - explicitly correct erroneous master data with privileged audit action

Do not silently reassign a new part number to an existing product.

## 6. Duplicate Behavior

If a new/uploaded product resolves to an existing identity fingerprint in the same Product Family:

- reuse the existing part number
- link/update the corresponding product according to the site's duplicate-import policy
- never allocate a second code

If an uploaded explicit part number conflicts with registry identity:

- reject row or mark as blocking error
- do not silently override database identity mapping

## 7. Part Number Immutability

Treat `products.part_number` as immutable after assignment.

Allow administrative correction only through a special audited maintenance action, not normal product edit.

## 8. Deactivation / Deletion

Never recycle part numbers.

If a product is deleted or discontinued:

- registry mapping remains reserved
- code may be marked inactive/discontinued
- code must never be reassigned to another SKU

## 9. Bulk Import

For each import row:

1. parse and normalize source data
2. resolve Product Family
3. validate required identity attributes
4. calculate canonical identity hash
5. find/reuse or allocate part number
6. create/update product
7. report row result

Result statuses:

```text
NEW_CODE
REUSED_CODE
EXISTING_CODE_KEPT
UPDATED_PRODUCT
SKIPPED
ERROR
CONFLICT
```

Admin must receive downloadable import results.

## 10. Search

Admin and storefront search should support exact/partial search by part number.

Store canonical part numbers uppercase with no spaces or hyphens.

Search input may normalize spaces/hyphens, e.g.:

```text
6813-a-008 -> 6813A008
```

but the stored/displayed canonical value remains `6813A008`.
