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
its write actually changes, as `moveFamilyAction` does.

**Serverless database limits live in `src/db/index.ts`, and every wait must be
bounded.** The pool options there (pool size, keep-alive, lifetime) are tuned
to the same incident; `export const maxDuration = 60` on the locale layout and
each API route is the hard ceiling that turns a wedged request into a visible
error instead of a five-minute hang. A client-set `statement_timeout` does not
survive the transaction pooler (tested), so the database's own 120s is the
statement backstop.

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
