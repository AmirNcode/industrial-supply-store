# Architecture

Orientation for someone — human or coding agent — picking this up cold. It
covers what the pieces are, which invariants are load-bearing, and where the
traps are. Deployment lives in [`DEPLOYMENT.md`](DEPLOYMENT.md); the design
history lives in `docs/superpowers/`.

## Stack

Next.js 16 App Router (Server Components, Server Actions, Route Handlers),
postgres-js with raw SQL tagged templates, Tailwind v4, `node:test` via `tsx`.
Drizzle is used **only** to define the schema and run `drizzle-kit push` — every
query in the app is hand-written SQL. Bilingual English/Persian with RTL.

Tests: `npm test` (76). Types: `npx tsc --noEmit`. Both must be clean.

## Routes

| Route | Who | Notes |
| --- | --- | --- |
| `/[locale]`, `/c/…`, `/f/…`, `/search` | public | catalog, statically rendered, `revalidate 3600` |
| `/[locale]/cart`, `/quote` | public | order submission |
| `/[locale]/track` | public | guest tracking: reference **plus** email |
| `/[locale]/account/**` | customer | signed cookie session |
| `/[locale]/invoice/[ref]` | customer or staff | language in path, currency in `?cur=` |
| `/[locale]/admin/login` | public | the only password form |
| `/[locale]/admin/(panel)/{orders,products,settings}` | staff | gate lives in the panel layout |
| `/api/admin/family/[id]/{template,export}` | staff | CSV, 404 when signed out |

`(panel)` is a route group — it does not appear in URLs. The sign-in gate is in
its `layout.tsx`, which is why `/admin/login` sits **outside** it: a gate
wrapping the login page would redirect the login page to itself.

## Two independent auth systems

They share nothing on purpose.

- **Staff** — one shared password, HMAC cookie, `src/lib/admin.ts`. No accounts,
  no rate limiting, no audit trail. `assertAdminWrite()` guards every write and
  refuses under `DEMO_MODE`.
- **Customers** — per-account scrypt passwords, signed session cookie
  (`src/lib/session.ts`, `sessionToken.ts`). No sessions table; the cookie is
  an HMAC of `userId.expiry`.

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

**Order status transitions are guarded twice**: `assertTransition` for legality,
and `WHERE id = $1 AND status = <source>` with a row-count check for
concurrency. `count === 0` means another writer won the race.

**`order_comments` is staff-only.** Nothing customer-facing may read it. There
is a test-by-inspection for this: plant a note, then confirm it appears in the
admin queue and in none of the invoice, account order page, account list or
tracking payload.

**Inventory is advisory.** Nothing blocks an order that exceeds
`inventory_available`; the admin queue flags it. Counts are in packs.

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
  app/api/               cart, suggest, admin CSV routes
  app/actions.ts         cart + order submission Server Actions
  components/            ConfirmSubmit, FxRatePanel, OrderTimeline, …
  db/schema.ts           Drizzle schema (definition only)
  db/extensions.sql      everything drizzle-kit cannot express — see below
  db/*Queries.ts         all reads and writes, raw SQL
  lib/                   i18n, money, orders, fxRate, password, session, importCsv
  seed/                  taxonomy, generators, AS568 data
```

Pure logic sits in `src/lib/*` with no database imports so it can be tested
without one: `orders.ts`, `fxRate.ts`, `money.ts`, `invoice.ts`, `trackRef.ts`,
`importCsv.ts`. That is where the tests are.

## The one trap that keeps recurring

`drizzle-kit push` deletes everything the schema file cannot express — the
extension indexes, `invoice_seq`, the unique index on `lower(email)`, and
**row-level security on every table**. `src/db/extensions.sql` holds all of it
and both `db:push` and `db:push:remote` re-apply it automatically. If you ever
run bare `drizzle-kit push`, run `npm run db:extensions` immediately after.

Full detail, plus five other traps, in [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Known gaps

Recorded in `docs/superpowers/specs/2026-07-31-accounts-orders-admin-design.md`.
The load-bearing ones: no email anywhere (staff send invoices by hand), no rate
limiting, sessions cannot be revoked individually, and `/admin` has no named
staff accounts — which is why `order_comments` has no author column.
