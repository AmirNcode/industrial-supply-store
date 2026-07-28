# Parstech Supply

A McMaster-Carr–style industrial parts catalog for the Iranian market.
English (USD) and Persian (Toman), RTL throughout. No payment processing — the
cart ends in a quote request.

**The catalog is generated demo data.** Dimensions follow real standard
progressions and are correct in shape and magnitude, but this is not a certified
reference table and must not be used to select a real part. See
[Catalog data](#catalog-data).

---

## Run it

Requires Docker and Node 24+.

### Day-to-day (app on the host, database in Docker)

```bash
docker compose up -d db
```

```bash
npm install && npm run db:push && npm run db:seed
```

```bash
npm run dev
```

Then open http://localhost:3000 — it redirects to `/en`. Persian is at `/fa`.

Seeding takes about 10 seconds and produces ~31,000 products across 97
categories. It is deterministic: reseeding yields byte-identical part numbers,
so bookmarks and screenshots survive a reset.

### Everything in Docker

The app image prerenders the home page at build time, so **the database must be
up and seeded before you build**:

```bash
docker compose up -d db && npm run db:seed && docker compose --profile full up -d --build
```

The `full` profile is opt-in precisely because host-side `npm run dev` is much
faster to iterate on.

### Useful commands

| Command | What it does |
|---|---|
| `npm run db:push` | Apply the schema (no migration files; this is a v1) |
| `npm run db:seed` | Truncate and regenerate the catalog |
| `npm run db:reset` | Drop the schema, re-push, reseed |
| `npm run db:studio` | Drizzle Studio |
| `npm run build` | Production build |

Postgres is on host port **5433**, not 5432, to avoid colliding with other
stacks. Admin password and FX rate live in `.env`.

---

## What is built

| Area | Status |
|---|---|
| Category tree, 4 levels deep, 97 categories | ✅ |
| Data-driven spec tables, per-family columns | ✅ |
| Faceted filtering with live counts | ✅ |
| Inline quantity + add to cart, per row | ✅ |
| Quantity-break pricing (1–9 / 10+) | ✅ |
| Search with type-ahead (parts, families, categories) | ✅ |
| Quick order by pasted part number list | ✅ |
| Cart persisted to Postgres via cookie session | ✅ |
| RFQ submission with reference number | ✅ |
| Admin inbox for submitted RFQs | ✅ |
| English + Persian, full RTL | ✅ |
| Payment processing | ❌ out of scope for v1 |
| Buyer accounts | ❌ out of scope for v1 |

---

## Tech stack, and why it is not McMaster's

McMaster-Carr runs a proprietary .NET/IIS stack built over ~25 years. Its speed
does **not** come from the framework — it comes from four architectural choices,
all reproducible on modern tooling:

1. Server-rendered HTML, tiny payloads, almost no client JavaScript
2. Aggressive caching of catalog pages, which change rarely
3. Prefetch on hover so navigation feels instant
4. A data model built for dense spec tables, not generic e-commerce

Copying the literal stack would mean writing .NET WebForms: slower to build,
worse to maintain, and no faster. So this copies the architecture, not the vendor.

- **Next.js 16** App Router, React Server Components — HTML-over-the-wire by default
- **PostgreSQL 17** — jsonb, GIN, trigram and full-text search in one engine, so
  there is no second service to run for search
- **Drizzle** — thin over SQL; faceting needs real SQL control, not an abstraction
- **Tailwind CSS v4** with logical properties only, so RTL mirrors for free

Client JavaScript is confined to four islands: search autocomplete, the
add-to-cart row, the facet filter box, and the cart badge. Everything else is
server-rendered.

### Measured (production build, warm)

| Route | Time |
|---|---|
| Home | 3–7 ms |
| Category page | 10–17 ms |
| Spec table, 200 rows + facets | 32–50 ms |
| Filtered spec table | 25–27 ms |
| Search autocomplete | 3–5 ms |

The facet aggregation runs in ~4.7 ms against 146,000 facet rows, entirely on
index scans.

---

## The interesting design problem

Every category needs *different* spec columns. O-rings have durometer and
cross-section; bearings have bore, load rating and seal type. Three ways to model
that:

- **EAV** — flexible, but faceting turns into brutal self-joins
- **A table per category** — fastest, unmaintainable past ~20 categories
- **jsonb + a normalized facet index** ← what this uses

`products.specs` is `jsonb` for display. A denormalized `product_spec_values`
table (`product_id, spec_key, val_text, val_num`) is written alongside it so
filter and facet-count queries hit a btree instead of unnesting jsonb. It costs
about 30 lines in the seeder and turns facet queries from "acceptable" into
"instant".

`spec_defs` declares, per family, which jsonb keys become table columns — label,
unit, type, sort order, filterable. **The spec table is entirely data-driven:
adding a product category requires no UI code.**

Two rules the generator enforces, because breaking either makes the table read as
fake:

- **Dependent dimensions are derived, never enumerated.** O-ring OD is
  `ID + 2 × width`; bearing OD and width are functions of bore and series. An
  independent OD axis would cheerfully emit an 80 mm bore inside a 10 mm race.
- **Material properties are derived from the material.** Service temperature is a
  property of Buna-N, not an independent choice, so it is computed — otherwise
  every part multiplies into six rows differing only by a number nobody can pick.

Verified after seeding: zero duplicate spec combinations, zero rows where
`OD <= ID`.

---

## Persian / RTL notes

Two decisions worth knowing about, because they are easy to get wrong:

**Spec values are stored canonically in English** and translated at render time.
Storing a Persian copy per value would double the facet index and make filter
URLs locale-specific — a link shared between an English-reading engineer and a
Persian-reading buyer would break. `?f_material=Viton` means the same thing in
both locales.

**Dimensions and part numbers stay in Latin digits in both locales**, pinned
`dir="ltr"`. Prices and counts use Persian digits via `Intl.NumberFormat('fa-IR')`.
Iranian procurement staff match dimensions against manufacturer catalogs, which
are Latin; localizing `0.239"` would make the table harder to use, not easier.

Toman amounts are converted from stored USD at a single hand-maintained rate
(`USD_TO_TOMAN` in `.env`) and rounded to the nearest 100. **There is no live FX
feed** — the rate is a constant you update by hand.

---

## Catalog data

Generated by `src/seed/`. Structurally realistic, not authoritative:

- **O-ring `-0xx` inside diameters are the real AS568 values.** The `-1xx`
  through `-4xx` series are generated from each series' documented base size and
  uniform increment (1/16", 1/8", 1/4"), which reproduces the correct shape and
  magnitude without transcribing several hundred rows.
- Thread sizes, pipe sizes, bearing bores, wire gauges and grit numbers are real
  standard ladders.
- **Prices are invented.** They scale plausibly with size and material but
  correspond to nothing.

The footer says this on every page, deliberately. Before this becomes a real
store, the seeder gets replaced by an importer against supplier data.

---

## Before this is production

Known gaps, stated plainly:

- **`/admin` is not authentication.** One shared password from `.env`, no
  accounts, no rate limiting, no audit trail. It exists so a demo of the RFQ
  inbox is not world-readable. Replace it before exposing this anywhere.
- **No migration files.** `db:push` diffs the schema directly, which is right for
  a v1 and wrong once there is data worth keeping.
- **No email.** A submitted RFQ lands in the database and nothing notifies
  anybody.
- **Product imagery is in-house SVG line art** (`src/components/ProductIcon.tsx`),
  not photography. Real photos are a sourcing problem, not a code problem.
- **8 npm advisories**, all in `drizzle-kit`'s bundled esbuild toolchain — a dev
  dependency that never ships in the runtime image. Worth clearing, not urgent.

---

## Layout

```
src/
  app/[locale]/          home, c/[...slug], f/[slug], search, cart,
                         quick-order, quote, admin
  app/api/               cart (GET count, POST add), suggest
  app/actions.ts         server actions: cart mutations, quick order, RFQ
  components/            Header, SearchBar, FacetSidebar, ProductIcon, …
  db/schema.ts           Drizzle schema
  db/queries.ts          all reads, including the facet aggregation
  db/extensions.sql      pg_trgm, FTS and expression indexes
  lib/                   i18n, money, filters, cart, admin, spec value labels
  seed/                  taxonomy, generators, AS568 data
```

`PLAN.md` has the original execution plan and the reasoning behind each decision.
