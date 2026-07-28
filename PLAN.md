# Industrial Supply — Execution Plan

A McMaster-Carr–style industrial parts catalog for the Iranian market.
v1 = design/UX validation. No payment processing.

## Decisions locked

| Area | Decision |
|---|---|
| Catalog data | Generated seed data — structurally realistic, ~40k SKUs |
| Locales | English (USD) + Persian/Farsi (Toman), RTL for `fa` |
| Features | Faceted sidebar, inline qty+add-to-cart, instant search, quick-order |
| Order flow | RFQ / quote request. Anonymous cart + password-protected admin |
| Runtime | Local only, Docker Compose |

## Tech stack — and why it is not literally McMaster's

McMaster-Carr runs a proprietary .NET/IIS stack roughly 25 years in the making.
Its speed does **not** come from the framework. It comes from four architectural
choices, all of which are reproducible on modern tooling:

1. Server-rendered HTML, tiny payloads, almost no client-side JavaScript
2. Aggressive caching of category/family pages (they change rarely)
3. Prefetch on hover so navigation feels instant
4. A product model built for dense spec tables, not for generic e-commerce

Copying the literal stack would mean writing .NET WebForms — slower to build,
worse to maintain, no faster. So we copy the *architecture*, not the vendor.

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16 App Router, React Server Components | HTML-over-the-wire by default; matches McMaster's rendering model |
| Language | TypeScript | Spec schemas are the hard part; types pay for themselves |
| Styling | Tailwind CSS v4, logical properties only | `ps-/pe-/ms-/me-/text-start` mirror for free under RTL |
| Database | PostgreSQL 17 | jsonb + GIN + trigram + FTS in one engine; no external search service |
| ORM | Drizzle | Thin over SQL — faceting needs real SQL control, not an abstraction |
| Search | Postgres FTS + `pg_trgm` | One less container; fast enough well past v1 scale |
| Cart | Cookie session → Postgres | Survives reload, no auth required |
| Packaging | Docker Compose | Postgres + app, one command |

Client-side JavaScript is confined to four islands: search autocomplete,
add-to-cart row, quantity input, and locale switcher. Everything else is
server-rendered.

## Data model — the core problem

Every category needs *different* spec columns. O-rings have durometer and
cross-section; bearings have bore, dynamic load rating, and seal type. Three
ways to model this:

- **EAV** — flexible, but faceting requires brutal self-joins
- **Per-category tables** — fastest, unmaintainable past ~20 categories
- **jsonb + a normalized facet index** ← chosen

`products.specs` is `jsonb` for display and detail. A denormalized
`product_spec_values` table (`product_id, spec_key, val_text, val_num`) is
written alongside it purely so filter and facet-count queries hit a plain
btree index instead of unnesting jsonb. Costs ~30 lines in the seeder; turns
facet queries from "acceptable" into "instant".

`spec_defs` declares, per product family, which spec keys render as table
columns — their label, unit, type, sort order, and whether they are filterable.
The spec table is fully data-driven; adding a category adds zero UI code.

Category tree uses adjacency (`parent_id`) plus a materialized `path`, so
"everything under Fastening & Joining" is one indexed prefix scan rather than
a recursive CTE.

## Execution sections

### 1. Infrastructure
- `package.json`, `tsconfig.json`, `next.config.ts`, Tailwind v4 via PostCSS
- `Dockerfile` (multi-stage, standalone output), `docker-compose.yml`
- Postgres 17 on host port **5433** (5432 avoided — other stacks present)
- `drizzle.config.ts`, `.env`
- Gate: `docker compose up db` healthy, `npm run dev` serves a page

### 2. Schema
- All tables above, with GIN on `specs`, trigram on `part_number` + family name,
  tsvector column for FTS
- Gate: `drizzle-kit push` applies cleanly

### 3. Seed data
- 26 top-level categories (the standard industrial-supply taxonomy)
- 3–4 levels deep, product families per leaf
- Per-family SKU generators: O-rings (AS568-style progressions), socket head cap
  screws, hex nuts, washers, ball bearings, pipe fittings, tubing, and generic
  fallbacks for breadth
- Qty price tiers (1–9 / 10+), pack quantities, lead times
- **Honesty note:** dimensions follow real standard *progressions* and are correct
  in shape and magnitude, but this is generated data. It is not a certified
  reference table and must not be used to select a real part.
- Gate: row counts + a spot-check query

### 4. Design system
- Color tokens read off the reference screenshots: catalog green, part-number
  link blue/visited purple, yellow About callout, hairline grays
- Dense type scale (13px body, 12px tables)
- SVG icon set drawn in-house — no copied imagery
- Gate: header/footer render identically LTR and RTL

### 5. Browse pages
- Home: left category rail + grouped tile grid
- Category: subcategory tiles, or family cards with product counts
- Breadcrumbs, prefetch on hover
- Gate: every category reachable from home in ≤4 clicks

### 6. Spec table + facets
- Yellow About callout, dense data-driven table, per-row qty + add-to-cart
- Facet sidebar computed over the *current* filtered set (values disappear as
  you narrow — matches the reference behavior)
- Filter state in the URL so results are shareable and back/forward works
- Numeric cells pinned `dir="ltr"` under RTL so dimensions never mirror
- Gate: filtering 18,060 → 21 products stays under ~50ms server-side

### 7. Search
- Suggest endpoint: categories, families, exact part-number hits
- Header type-ahead, full results page
- Gate: suggest responds < 30ms warm

### 8. Cart / quick-order / RFQ / admin
- Cookie-session cart persisted to Postgres
- Quick-order: paste `part-number, qty` lines → validated → cart
- RFQ form: company, contact, email, phone, PO number, address → `quotes` row
  with generated reference
- Admin at `/admin`, single shared password from env
- Gate: submitted RFQ visible in admin with correct line items and totals

### 9. i18n + RTL
- `[locale]` segment, `en`/`fa` dictionaries, `dir` on `<html>`
- Toman formatting via `Intl.NumberFormat('fa-IR')` — Persian digits, `٬`
  separator, no decimals
- FX rate as a single env constant, not hardcoded in components
- Gate: both locales walked page-by-page, no layout breakage

### 10. Verification
- Full stack up, seeded, every page walked in both locales via Playwright
- Query timings checked, missing indexes added
- Cart and RFQ confirmed to actually persist

## Explicitly out of scope for v1
Payment processing, real product photography, buyer accounts, inventory sync,
shipping rates, tax/VAT calculation, order status workflow beyond "submitted".
