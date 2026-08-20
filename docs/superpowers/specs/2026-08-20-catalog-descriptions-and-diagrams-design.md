# Catalog descriptions and dimension diagrams

## Problem

A buyer looking at a family of O-rings has to already know what "Wd." means.
The reference site answers that with a labelled cross-section diagram beside a
paragraph of prose, at the top of the listing. This catalog has the layout for
it and none of the content: the family page's callout exists, but its text can
only be changed by a seeder and its picture is the 46px catalog thumbnail.

Categories have it worse — they carry no description columns at all, so the top
of `/c/…` and `/l/…` is a breadcrumb, a title and a table.

Two things are missing:

1. Somewhere for staff to write a description, in both languages, without a
   deploy.
2. A second image slot whose purpose is a dimension diagram rather than a
   product photograph, because the two are not interchangeable and a family
   needs both.

## What already works

`product_families` already has `about_en`/`about_fa` (the long callout body)
and `desc_en`/`desc_fa` (the one-line subtitle under the family name). Both are
seeded; neither is editable from `/admin`. The family page already renders the
callout at [`f/[slug]/page.tsx`](../../../src/app/[locale]/f/[slug]/page.tsx) —
art at the inline start, heading and body after it. That is already the layout
this design wants; it needs content and a bigger picture, not a new shape.

`pick(row, base, locale)` in `src/lib/i18n.ts` already falls back to the
English field when the Persian one is empty. The "optional Persian" requirement
therefore needs no new fallback logic for text.

`uploadCatalogImage(entity, id, file)` writes to
`{categories|families}/{id}/{uuid}.{ext}`. The object name is a fresh UUID, so a
second image per entity cannot overwrite the first and the storage module needs
no change.

The category media page already batches: every changed card posts in one action,
validates before writing, and purges the cache once per press. This design adds
fields to that machinery and leaves the machinery alone.

## Design

### Descriptions

`about_en`/`about_fa` become the description, for both entity types.
`product_families` already has them; `categories` gains the same pair. Nothing
new is invented alongside them, because a family page carrying two long texts
that mean the same thing would need a rule about which one wins.

`desc_en`/`desc_fa` — the one-line subtitle on category cards and search
results — is out of scope and stays uneditable.

Persian is optional. An empty `about_fa` renders the English text, which is what
`pick` already does. The consequence is a Latin paragraph inside an RTL page;
that is accepted, because the alternative is a blank callout.

Text is plain. A blank line starts a new paragraph; a single newline is a soft
wrap. No markup, so there is nothing to sanitise and a paste out of Word cannot
produce anything but text. Ceiling is 2,000 characters per locale, held in
`REQUEST_LIMITS` with every other ceiling rather than inline at the call site.

### Diagrams

Both tables gain `diagram_url`, filled the same two ways the catalog image
already is: paste a supplier URL, or upload a file through the same 4 MB and
MIME checks.

What the callout paints, in order:

| State | Art | Size |
| --- | --- | --- |
| `diagram_url` set | the diagram | 240px |
| no diagram, `image_url` set | the catalog image | 46px |
| neither | the entity's SVG icon | 46px |

The fallback stays a thumbnail deliberately. A real diagram is the thing worth
240px of vertical space; a product photograph promoted to that size would
duplicate the family header's own 64px image at four times the size and assert
that it explains a dimension when it does not. Size is the signal that
distinguishes them.

Alt text is the entity name, matching the family header image. This is honest
but lossy: it tells a screen-reader user which family the picture belongs to,
not what `Wd.` measures. Anything a blind buyer must know belongs in the
description text, which is read.

The diagram is static — no zoom, no lightbox. That keeps the client-island count
at four and avoids a second focus-trap surface.

**Accepted trade:** `CatalogImage` declares a square box and `object-contain`s
inside it. A wide diagram letterboxes into 240×240 rather than rendering as
240×120. Rendering it tight would require the image's real dimensions, which are
unknowable for a pasted supplier URL and would cost a decode for an uploaded
file. The cost is whitespace under wide diagrams.

### Where it renders

One component, `src/components/CatalogCallout.tsx`, used by both surfaces:

- The family page replaces its inline callout markup with it.
- `CategoryHeader` renders it, which gives `/c/…` and `/l/…` the same callout
  from one copy — the two views are required to be identical above the fold.

The callout is omitted entirely when both locales' text is empty, which is what
the family page does today. A diagram with no description does not render on its
own; the picture is an illustration of the prose, not a replacement for it.

The two rules worth testing live in `src/lib/catalogCallout.ts`, which imports
neither React nor the database:

- `calloutArt({ diagramUrl, imageUrl, icon })` → `{ url, icon, size, isDiagram }`
  — the ladder in the table above.
- `paragraphs(text)` → `string[]` — split on a blank line, collapse single
  newlines, drop empties.

### The read path, and one cost decision

`CATEGORY_COLS` in `src/db/queries.ts` is shared by `getTopCategories`,
`getChildren`, `getAncestors` and every other category read. Putting a
2,000-character × 2-locale description in it would ship up to ~100 KB of text
per category page for cards that render none of it.

The description and diagram therefore go **only** into `getCategoryByPath`, the
single-row lookup, which is the only caller that draws a callout. Anything later
that needs a category's description must use that query rather than widening the
shared column list.

Families are already in the opposite position: `FAMILY_COLS` carries
`about_en`/`about_fa` to every family card on every category page and renders
only `desc`. `diagram_url` joins it — one short string on a payload that already
carries the long ones. That pre-existing waste is noted, not fixed here.

### Admin editor

Every card on the category media page — the category itself, its subcategories
and its families — keeps its current compact row. Below that row sits a
`<details>` disclosure, "Description & diagram", marked when it holds content,
containing:

- English description textarea
- Persian description textarea, whose placeholder says it falls back to English
- diagram URL field
- diagram upload button
- remove-diagram checkbox

A click inside a `<summary>` cancels the click's default action, so a control in
there can never be a form submit. Nothing in the summary submits; the page's one
Save button stays where it is, beside the heading.

The existing rules hold unchanged:

- **Arrange locally, write once.** Typing changes React state and nothing else.
- **Dirty means differs from the database.** `Edit`, `changed()` and `view()`
  gain the four fields, so typing a description and deleting it again disables
  Save.
- **Nothing is written unless every changed card is valid.** Description length,
  diagram URL and diagram file are all checked in pass one with everything else.
  Uploads stay in pass two, after nothing else can turn out to be wrong.
- **One revalidation per Save**, still the coarse whole-site purge, still paid
  once per press.

`CatalogMediaFailure` gains `field: "image" | "diagram"` so a rejected file
names which of the two uploads failed, and a new `bad-diagram-url` message
covers a malformed URL in the second field.

## Schema changes

`supabase/migrations/20260820…_add_catalog_descriptions.sql`:

```sql
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS about_en text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS about_fa text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS diagram_url text NOT NULL DEFAULT '';

ALTER TABLE public.product_families
  ADD COLUMN IF NOT EXISTS diagram_url text NOT NULL DEFAULT '';
```

Defaults are empty strings, matching `image_url`, so every existing row is valid
the moment the migration lands and no backfill is needed.

Three files move with it, per the rule in `docs/ARCHITECTURE.md`:

- `src/db/schema.ts` — the four columns.
- `scripts/verify-remote.mts` — four entries in `COLUMNS`, so a database missing
  them fails the pre-deploy gate instead of the Vercel build's prerender.
- No `extensions.sql` change: no index, sequence or RLS object is involved.

## Testing

- `src/lib/catalogCallout.test.ts` — the art ladder in all three states, the
  46px-vs-240px distinction, and paragraph splitting including blank-line runs,
  leading/trailing whitespace and a single trailing newline.
- Existing `i18n.test.ts` already covers `pick`'s English fallback.
- `e2e/public-accessibility.spec.ts` — the family route's axe scan already runs;
  the diagram is inside it and must not introduce a violation.
- Gate: `npx tsc --noEmit`, `npm test`, `npm run build`.

Admin write paths cannot be exercised without the admin password and are covered
by inspection only.

## Build order

1. Migration file, `schema.ts`, `verify-remote.mts`; apply locally and verify.
2. `src/lib/catalogCallout.ts` and its tests.
3. `src/components/CatalogCallout.tsx`.
4. Query changes: `getCategoryByPath`, `FAMILY_COLS`, and the row types.
5. Family page and `CategoryHeader` render through the shared component.
6. Editor read/write: `getCatalogCategoryEditor`, `updateCatalogCategory`,
   `updateCatalogFamily`.
7. `saveCatalogMediaAction` validation, upload and write.
8. `CatalogMediaEditor` disclosure UI.
9. Dictionary keys, English and Persian.

## Out of scope

- Category descriptions on home-page tiles, the category sidebar, or search
  results.
- Any change to `desc_en`/`desc_fa`.
- P2-08 from the 2026-08-16 review: catalog media saves upload sequentially,
  write rows without a transaction, and never delete a superseded object. This
  change doubles the uploads per card, so the window widens and orphans
  accumulate faster. It is filed separately rather than bundled here.
