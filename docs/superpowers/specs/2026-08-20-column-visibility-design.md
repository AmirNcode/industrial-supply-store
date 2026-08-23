# Four-state column visibility

## Problem

`spec_defs.display` holds `'table'` or `'detail'`, and the two are exclusive.
That gives an operator two of the four states they need:

| | in the table | in the expanded row |
| --- | --- | --- |
| `display = 'table'` | yes | **no** |
| `display = 'detail'` | no | yes |
| — | yes | yes |
| — | no | no |

The missing bottom row is the complaint. Unticking CATALOG TABLE does not hide a
column; it moves it into the expanded row, and there is no way to say "not
anywhere". That is why the expanded row looks like it shows whatever it likes:
it shows everything that is not in the table, by construction.

The missing third row is worth having too — a dimension that identifies a
product in a list is often the one you also want spelled out with its unit when
the row is open.

## Design

### Two booleans, in two migrations

`in_table` and `in_detail`, independent, on `spec_defs`.

Migration one adds both and backfills from `display`:
`in_table = (display = 'table')`, `in_detail = (display = 'detail')`. Every
family renders exactly as it does today the moment it lands.

`display` stays in place, unread. Migration two drops it once the release is
proven. Expand/contract, because a dropped column in the same deploy as the code
that stopped reading it has no way back except a restore, and this project has
lost database objects four separate times.

### The untick rule

Unticking CATALOG TABLE clears MOBILE and FILTER, and disables MOBILE. DETAIL is
untouched. Hiding a column entirely is unticking CATALOG TABLE and DETAIL.

MOBILE is disabled rather than merely cleared because the phone card *is* the
collapsed table row: with no table column there is nothing for it to mean, and a
tickable box that does nothing is worse than a greyed one.

FILTER is cleared but stays enabled. A facet is independent of display in the
rendering — `FacetSidebar` selects on `filterable` alone — so filtering on a spec
that is not a visible column is a real, working combination. Clearing it on
untick matches the intent ("I do not want this column"); leaving it enabled
means an operator who did want that combination can say so.

The rule lives in `src/lib/columnVisibility.ts` as a pure function over one
row's flags, with tests. Not in an `onChange`, where it cannot be tested and
would have to be repeated on the import review screen later.

### A hidden column keeps its data

Neither flag set means the column renders nowhere. Its values stay in
`products.specs`, its facet rows stay in `product_spec_values` if FILTER is
still on, and it stays in `search_text`. Hiding is reversible and costs no
rebuild; a part is still findable by a value nobody can see.

### Rendering

`tableDefs = defs.filter(d => d.inTable)`, `detailDefs = defs.filter(d => d.inDetail)`.
`cardSummary.ts` and `ProductCardList.tsx` swap `display === "table"` for
`inTable`. `expandable` on a family row already asks whether any detail column
holds a value, so a family with no detail columns simply stops offering the
expander.

### The import review keeps one checkbox

`ColumnReview` continues to offer a single "in catalog table" tick per column,
writing `inTable = checked`, `inDetail = !checked` — today's behaviour exactly.
The four-way control lives only in the columns editor. Widening the review
screen is a separate change.

## Schema changes

`supabase/migrations/20260820…_split_column_display.sql`:

```sql
ALTER TABLE public.spec_defs
  ADD COLUMN IF NOT EXISTS in_table boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS in_detail boolean NOT NULL DEFAULT false;

UPDATE public.spec_defs
   SET in_table = (display = 'table'),
       in_detail = (display = 'detail');
```

`src/db/schema.ts` gains both; `scripts/verify-remote.mts` gains two `COLUMNS`
entries and the new ledger version. `display` keeps its column, its default and
its enum so an insert that still names it is valid; nothing reads it.

## Testing

- `src/lib/columnVisibility.test.ts` — the untick rule in both directions,
  including that DETAIL survives, that re-ticking CATALOG TABLE leaves MOBILE
  off, and that a hidden column is a reachable state.
- `columnPlan.test.ts` updated for the two flags.
- Browser: toggle each box in the editor, save, reload, and confirm the family
  page renders the four combinations — including a column that appears nowhere.
- Gate: `npx tsc --noEmit`, `npm test`, `npm run test:db`, `npm run build`.

## Out of scope

- Dropping `display` (migration two, after this release is proven).
- The import review's checkbox set.
- The frozen-hidden-input defect in `ColumnReview`/`ImportPanel`, which is the
  same root cause as the columns-editor save bug fixed alongside this but on the
  import path, and is filed separately.
