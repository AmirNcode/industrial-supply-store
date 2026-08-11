# Admin-managed product columns

## Problem

Spec columns are set by the seeder. Adding a product type whose columns nobody
anticipated — the TEMEX API 6A gate valve file has 45 of them — currently means
a code change. The catalog will keep meeting products whose real specs are
unknown today, so the shape of a family has to be an admin decision, not a
deploy.

Two things block that:

1. `parseImport` rejects any header not already in `spec_defs`, and there is no
   way to put a header there from the admin panel.
2. A 45-column spec table is unreadable. Some columns identify a product in a
   list; the rest belong on the product itself.

## What already works

Columns are rows in `spec_defs`, values are JSONB in `products.specs`. Changing
a family's columns is DML, not DDL — no migration, and none of the
`drizzle-kit push` hazards recorded in `docs/DEPLOYMENT.md`. `writeImport`
already keeps products, search text, the facet index and both product counts in
one transaction. This design adds a column-definition step in front of that
machinery and leaves the machinery itself alone.

## Design

### Column tiers

`spec_defs` gains `display`:

- `table` — a column in the catalog spec table, as today.
- `detail` — hidden from the table, shown when a row is expanded.

Tiering is the answer to unreadable width. A family may have 45 columns and
show six.

### Upload

Upload targets an existing family; creating families and categories stays where
it is. The upload is two stages, one form.

**Stage 1 — analyze.** Parse the header and a sample of values. Sort every
header into:

- *matched* — equals a `spec_defs.key`, that column's remembered `csv_alias`,
  or a built-in field name.
- *new* — unknown. Proposed as a new spec column, with `kind` inferred from the
  values (numeric after stripping thousands separators and a trailing unit →
  `number`) and a label prettified from the header.
- *missing* — a `spec_defs` key absent from the file, with a count of how many
  products hold a value for it.

Nothing is written. The operator sees the three lists and, per new column,
sets: spec vs. built-in field vs. ignore, `table` vs. `detail`, `number` vs.
`text`. Per missing column: delete or keep.

**Stage 2 — apply.** One transaction:

1. Insert/update/delete `spec_defs` rows per the confirmed plan.
2. Strip deleted keys from `products.specs` and `product_spec_values`.
3. Persist the header→field decisions: `spec_defs.csv_alias` for spec columns,
   `product_families.field_aliases` for built-ins and ignores, so the same
   supplier file re-uploads with nothing to confirm.
4. Run the existing `writeImport` for the rows.

All-or-nothing. A failure anywhere leaves the family exactly as it was.

The file survives between stages by staying in the file input and being posted
again with the confirmed plan — no server-side stash, nothing to expire.

### Blank commercial columns

The TEMEX file leaves price, stock and inventory empty. `parseImport` currently
refuses a blank price so it cannot import silently as free. That reasoning
holds for a value that is *wrong*, not one that is *absent*: these products are
real and priced by phone.

Blank price, `in_stock` and the inventory counts therefore fall back to
`0` / `true` / `0`, and a product at price 0 renders **Call for price** instead
of an amount, with the add-to-cart control replaced by a quote link. A
non-numeric price is still an error. Absent stays absent; wrong stays refused.

### Edit columns page

Per family, at `/admin/products/family/[id]/columns`: reorder, edit English and
Persian labels, unit, `number`/`text`, `filterable`, `table`/`detail`, and
add or remove a column. This is where Persian labels arrive after an import —
the upload uses the English label for both locales so a 45-column file does not
become a 45-field form.

### Expanded row

The spec table renders `table`-tier columns. The part number becomes a control
that expands a full-width row beneath it holding the `detail`-tier specs in a
two-column list, the description, document labels, and an image slot. Mobile
cards get the same expansion.

Image and document *files* are out of scope. `products.image_url` and
`products.documents` are added now and stay empty; the expanded row renders a
placeholder. The TEMEX `documents` column imports as labels without URLs.

## Schema changes

One migration, applied with `npm run db:push` (which re-applies
`extensions.sql`).

| Table | Column | Type | Default |
|---|---|---|---|
| `spec_defs` | `display` | `text` `'table'\|'detail'` | `'table'` |
| `spec_defs` | `csv_alias` | `text` nullable | `null` |
| `product_families` | `field_aliases` | `jsonb` | `{}` |
| `products` | `image_url` | `text` | `''` |
| `products` | `documents` | `jsonb` | `[]` |

Additive only. Every existing column defaults to `table`, so the catalog looks
identical the moment the migration lands.

## Testing

The diff and the plan are pure functions over a header, sample values and the
current defs — no database, like `parseImport`. Unit tested against the real
TEMEX file as a fixture: 45 headers, `product_code` → part number,
`lead_time` → lead days, `product_name` ignored, quoted values containing
commas and embedded newlines, `"3,000 "` inferred as a number.

The transaction is exercised against the local Docker database. Nothing in this
work runs against either Supabase project.

## Build order

1. Schema migration.
2. `columnPlan.ts` — diff, inference, plan validation, with tests.
3. `parseImport` accepts a resolved plan; blank commercial columns default.
4. Two-stage import action and confirm UI.
5. Edit columns page.
6. Expanded row, table and cards.
