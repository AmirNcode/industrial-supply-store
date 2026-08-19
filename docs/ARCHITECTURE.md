# Architecture

Orientation for someone — human or coding agent — picking this up cold. It
covers what the pieces are, which invariants are load-bearing, and where the
traps are. Deployment lives in [`DEPLOYMENT.md`](DEPLOYMENT.md); the design
history lives in `docs/superpowers/`.

**Agents: read [`../CLAUDE.md`](../CLAUDE.md) first.** It sets how to work in
this repository and — the part most often got wrong — how to report back.

## Stack

Next.js 16 App Router (Server Components, Server Actions, Route Handlers),
postgres-js with raw SQL tagged templates, Tailwind v4, `node:test` via `tsx`.
Drizzle is used **only** to define the schema and run `drizzle-kit push` — every
query in the app is hand-written SQL. Bilingual English/Persian with RTL.

The local gate is `npm run lint`, `npm run typecheck`, `npm test`,
`npm run test:db`, a production build, and `npm run test:e2e`. The browser suite
uses Playwright plus axe in EN/FA desktop/mobile projects. GitHub CI repeats the
same checks against a freshly seeded disposable PostgreSQL service; it never
connects to either hosted Supabase project.

## Routes

| Route | Who | Notes |
| --- | --- | --- |
| `/[locale]`, `/c/…` | public | catalog, prerendered/ISR with `revalidate 3600` |
| `/f/…`, `/l/…`, `/search` | public | request-driven catalog results; family output is bounded by default |
| `/[locale]/cart`, `/quote` | public | order submission |
| `/[locale]/track` | public | guest tracking: reference **plus** email |
| `/[locale]/account/**` | customer | signed cookie session |
| `/[locale]/invoice/[ref]` | customer or staff | language in path, currency in `?cur=` |
| `/[locale]/admin/login` | public | the only password form |
| `/[locale]/admin/(panel)/{orders,products,settings}` | staff | gate lives in the panel layout |
| `/api/admin/family/[id]/{template,export}` | staff | CSV, 404 when signed out |
| `/api/admin/import` | staff | small signed-upload control messages; CSV bytes go to private Storage |

`(panel)` is a route group — it does not appear in URLs. The sign-in gate is in
its `layout.tsx`, which is why `/admin/login` sits **outside** it: a gate
wrapping the login page would redirect the login page to itself.

## Two independent auth systems

They share nothing on purpose.

- **Staff** — one shared password, HMAC cookie, `src/lib/admin.ts`. No named
  accounts or audit trail. Login and write surfaces use the shared database
  rate limiter. `assertAdminWrite()` guards every write and refuses under
  `DEMO_MODE`.
- **Customers** — per-account scrypt passwords, signed session cookie
  (`src/lib/session.ts`, `sessionToken.ts`). No sessions table; the cookie is
  an HMAC of `userId.expiry`. Verification accepts only canonical UUID-shaped
  user IDs, so ownership queries compare UUID to UUID and retain their indexes.

## Invariants that will bite you

**Money is integer USD cents.** Persian display converts at a rate the caller
passes in. `formatPrice(cents, locale, rate)` takes the rate as a *required*
argument so a forgotten call site is a compile error, not silently stale prices.

**An issued invoice uses `orders.fx_rate_to_toman`, never `getFxRate()`.** The
rate is frozen at issuance so reprinting later cannot change what is owed.

**Invoices must not round.** `formatPriceExact` / `formatMoneyExact` skip the
nearest-100 rounding `formatPrice` does, or a column of lines disagrees with its
own total.

**Currency and locale are separate on the invoice only.** Everywhere else
currency follows locale. `formatMoneyExact(cents, currency, locale, rate)` —
currency picks the unit, locale still picks the script.

**A product write is never one insert.** `products`, `product_spec_values` (the
facet index — filters read this, not `products.specs`), `products.search_text`,
`product_families.product_count` and `categories.product_count` all move
together in one transaction. See `writeImport` in `src/db/importQueries.ts`.
Imports preserve the uploaded three-bucket stock total but always derive held
and sold quantities from orders; an uploaded stale ledger value is reported and
adjusted, not committed as a new source of truth.

**The database is a correctness boundary, not just storage.** Product SKUs are
unique both raw and under `upper(part_number)`; orders point to users with
`ON DELETE SET NULL`; quantities, monetary values, pack/lead ranges, inventory
hold/sold values, invoice fields, and lifecycle timestamps have named checked
constraints. `inventory_available` is intentionally allowed below zero because
it represents an advisory shortfall. Keep `src/db/schema.ts`, the timestamped
migration, `src/db/extensions.sql`, and the required-object list in
`scripts/verify-remote.mts` synchronized when changing one of these rules.

**Derived data must be proved, not trusted.** `src/db/dataIntegrity.ts` is the
shared definition used by deployment verification, corruption integration
tests, and `db:reconcile:*`. It compares family/category counts, filter facets,
inventory, ownership, order line totals, and invoice/status timestamps. The
apply command repairs only values with a deterministic source and rolls back if
anything remains; it never repairs canonical order or ownership data by guess.

**Order status transitions are guarded twice**: `assertTransition` for legality,
and `WHERE id = $1 AND status = <source>` with a row-count check for
concurrency. `count === 0` means another writer won the race.

**`order_comments` is staff-only.** Nothing customer-facing may read it. There
is a test-by-inspection for this: plant a note, then confirm it appears in the
admin queue and in none of the invoice, account order page, account list or
tracking payload.

**Inventory is advisory.** Nothing blocks an order that exceeds
`inventory_available`; the admin queue flags it. Counts are in packs. Received
and invoiced lines are held; a line with `paid_at` is sold, including an order
cancelled after payment because no refund/restock transition exists yet.

**`generateStaticParams` must stay cheap, and the category route deliberately
returns `[]`.** Two facts collide here. A dynamic segment with *no*
`generateStaticParams` is fully dynamic — `no-store`, re-rendered per request,
`revalidate` ignored. But every path it *does* return is prerendered at build
time, and Vercel builds this project in `iad1` while the database is in
`eu-central-1`, so each one costs a transatlantic round trip per query on a
single-worker machine. Returning the 26 top-level categories across two locales
added 52 pages, pushed several past the 60-second page ceiling, and failed the
2026-08-16 deploy with `CONNECTION_CLOSED` from the pooler. Empty gets both:
the route stays cacheable and the build pays nothing. `staticPageGenerationTimeout`
is raised to 120 for the pages that still prerender.

**Catalog artwork goes through `next/image`, and `remotePatterns` allows every
HTTPS host.** Administrators paste arbitrary supplier URLs, so the host cannot
be enumerated in advance; the consequence is that the optimiser will fetch any
HTTPS URL entered in `/admin`, and each image and size is a billable
transformation. `CatalogImage` passes `sizes` as the tile's literal width
because these thumbnails never reflow, and falls back to a plain `<img>` for
`http:` sources, which `remotePatterns` deliberately excludes. Uploads are
still stored at full size — that is storage, not bandwidth, and nobody
downloads the original.

**The family page's phone cards are the table's own rows.** There is one set of
markup; `globals.css` folds `.catalog-table` rows into cards below `lg` using
the `data-cell` attributes on each `<td>`. A new cell needs a `data-cell` and a
`grid-area`, or it will land in the card layout unplaced. The summary line is
the one piece of phone-only content, computed per page by
`src/lib/cardSummary.ts` because "which specs distinguish these rows" cannot be
answered one row at a time. `ProductCardList` still exists and is still correct
for the category list view, whose rows span different families.

**`.table-card` must not be given `overflow`.** The catalog table's head is
`position: sticky`, which binds to the nearest scroll container — so a wrapper
that scrolls or clips pins the head to its own top edge instead of the window,
and the head silently stops working. This already cost the horizontal scroll the
wrapper used to carry; the table is built to fit the window at 1024 and up.

**Catalog order is `sort`, and admin renumbers a whole run when it changes.**
`categories.sort` and `product_families.sort` default to 0, so a seeded run is a
set of ties broken by `id`. `saveFamilyOrder` renumbers the category's families
from the order the operator arranged rather than swapping two rows, because
swapping two zeros changes nothing. It refuses any list that is not exactly the
category's own families — no partial orders from a page drawn before something
else changed.

**A click inside a `<summary>` cannot submit a form.** The admin group headers
cancel the click's default action so pressing a control does not also collapse
the group, and a cancelled click never runs a submit button's activation
behavior. Controls in there must be `type="button"` calling a Server Action
directly (as the order Save does), not form submits.

**`revalidatePath("/", "layout")` is a whole-site purge — never put it on a
per-click action.** It marks every ISR page stale at once, so the next visit to
each one is a regeneration, and a burst of regenerations against the small
shared database is how production melted on 2026-08-15: statements queued past
the database's 120s `statement_timeout` and requests behind them hung to the
300s function ceiling. It is acceptable on rare, coarse writes (an import, a
deletion); anything a person presses repeatedly must revalidate only the pages
its write actually changes, as `saveFamilyOrderAction` does.

**Serverless database limits live in `src/db/index.ts`, and every wait must be
bounded.** The pool options there (pool size, keep-alive, lifetime) are tuned
to the same incident; `export const maxDuration = 60` on the locale layout and
each API route is the hard ceiling that turns a wedged request into a visible
error instead of a five-minute hang. A client-set `statement_timeout` does not
survive the transaction pooler (tested), so the database's own 120s is the
statement backstop.

**Public request limits are centralized and database-backed.** Routes and
Server Actions take their byte, field, line, filter and cart ceilings from
`src/lib/requestLimits.ts`; do not introduce a one-off larger parser. Abuse
counters go through `src/lib/rateLimit.ts`, whose atomic Postgres upsert works
across function instances. Identities are HMACed before storage, and account
writes consume both account and IP scopes where both are available.

**The large CSV importer bypasses application request bodies, not validation.**
`/api/admin/import` issues a path-specific signed upload URL for a private
Supabase Storage bucket. The browser uploads directly, then the server validates
the signed family/size/expiry claim, downloads at most 24 MB, and passes the CSV
to `catalogImport.ts`. Review/apply still share the same parsing and atomic
database-write path. Never make the import bucket public or reuse the public
catalog-image bucket.

## Admin editing conventions

Every editing screen in `/admin` follows the same four rules. They are listed
together because a new screen that breaks one of them will look right and be
wrong in a way that only shows up in production.

**Arrange locally, write once.** A control that a person presses repeatedly —
reorder arrows, a row of checkboxes — changes React state and nothing else. The
write happens when they press Save. The column editor, the family order and the
category media page all work this way. The alternative costs one round trip and
one cache purge per press, which is the incident above.

**One Save per page, and one revalidation per Save.** The category media page
posts every changed card in a single action (`saveCatalogMediaAction`) and
purges once at the end. Per-card save buttons meant a dozen whole-site purges in
a row.

**Dirty means "differs from the database", not "was touched".** Every screen
compares live state against the values the server sent, so arranging a family
back where it started, or typing a name and typing it back, clears the pending
state and disables Save. A boolean flag set on first keystroke would leave Save
offering to write what is already there.

**Nothing is written unless every changed thing is valid.** The CSV import set
this rule and the batch saves follow it: validate everything, then write. A typo
in one image URL should not leave the operator guessing which of eight edits
landed. Uploads are the one unavoidable exception — they cannot be rolled back,
so they run only after every field has passed, and a failed upload still writes
nothing.

**Unsaved work is guarded on the way out.** `UnsavedOrderGuard` catches in-app
navigation in the capture phase and offers Save, Discard or Stay; `beforeunload`
covers closing the tab, where the browser substitutes its own wording and there
is nothing to be done about that. It deliberately ignores `download` links,
modified clicks and same-page anchors. Any new screen holding unsaved state
should reuse it.

**Limits on the catalog are advice, not rules.** `MAX_LEGIBLE_COLUMNS` warns in
red beside Save on both the column editor and the import review, and neither
blocks. A supplier's file sometimes genuinely carries twelve dimensions that all
matter, and refusing it would mean refusing the catalog.

## Data flow: an order

1. `submitQuoteAction` (`src/app/actions.ts`) writes `orders` + `order_items`
   and calls `holdStockForOrder` — all in one transaction.
2. Staff price it and `issueInvoiceAction` freezes the FX rate, assigns an
   invoice number from `invoice_seq`, and sets `invoiced`.
3. `setOrderStatusAction` walks `invoiced → preparing → shipped → delivered`.
   `preparing` means payment received and calls `sellHeldStock`. `cancelled`
   calls `releaseHeldStock`, but only from `received`/`invoiced`.

Statuses and legal transitions live in `src/lib/orders.ts`, which has zero
imports so it is testable standalone.

## Where things live

```
src/
  app/[locale]/          pages; admin split under admin/(panel)/
  app/api/               cart, suggest, admin CSV/export/import routes
  app/actions.ts         cart + order submission Server Actions
  components/            ConfirmSubmit, FxRatePanel, OrderTimeline, …
  db/schema.ts           Drizzle schema (definition only)
  db/extensions.sql      everything drizzle-kit cannot express — see below
  db/*Queries.ts         all reads and writes, raw SQL
  lib/                   i18n, money, orders, auth, limits, imports, storage
  seed/                  taxonomy, generators, AS568 data
```

Pure logic sits in `src/lib/*` with no database imports so it can be tested
without one: `orders.ts`, `fxRate.ts`, `money.ts`, `invoice.ts`, `trackRef.ts`,
`importCsv.ts`, `requestLimits.ts`, and signed import claims. That is where the
tests are.

## Schema changes and the trap that kept recurring

`drizzle-kit push` deletes everything the schema file cannot express — the
extension indexes, `invoice_seq`, the unique index on `lower(email)`, and
**row-level security on every table**. `src/db/extensions.sql` holds all of it.
`db:push` is therefore restricted to empty/local bootstrap and refuses remote
hosts; there is no remote push command.

Live schema changes are reviewed SQL files in `supabase/migrations`. `npm run
db:migrate:check:remote` dry-runs them, `db:migrate:remote` applies only pending
files and records each version in `supabase_migrations.schema_migrations`, and
the write command requires a same-day backup/restore acknowledgement. A new
empty database has its own bootstrap command that refuses any existing public
table.

Full detail, plus five other traps, in [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Known gaps

Recorded in `docs/superpowers/specs/2026-07-31-accounts-orders-admin-design.md`.
The load-bearing ones: no email anywhere (staff send invoices by hand), sessions
cannot be revoked individually, and `/admin` has no named staff accounts —
which is why `order_comments` has no author column. Rate limits mitigate abuse;
they do not replace named staff authentication, MFA, revocation, or an audit
trail.
