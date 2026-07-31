# Customer accounts, orders, invoices and bulk import

Date: 2026-07-31
Status: approved, not yet implemented

## Goal

Turn the catalog from a request-for-quote form into a working store: customers
can hold an account, watch an order through to delivery, and print an invoice in
English or Persian; staff can price a request, ship it, and load products in
bulk.

Deliberately out of scope for v1: payment, inventory and stock levels, email of
any kind, and named staff accounts. Each is noted under Known gaps with what it
costs to leave out.

## Guiding constraint

The codebase stays small. Every choice below was made twice — once for
correctness, once for how much code it adds — and the cheaper option won unless
skipping it would produce wrong data. The schema change is one new table plus a
rename.

## Order lifecycle

```
received  ──▶  quoted  ──▶  confirmed  ──▶  shipping  ──▶  delivered
   │             │              │
   └─────────────┴──────────────┴──▶  cancelled | declined
```

| Status | Set by | Means |
| --- | --- | --- |
| `received` | system, on submit | Request is in. Prices are what the catalog showed. |
| `quoted` | staff | Staff have set final prices. Awaiting customer approval. |
| `confirmed` | customer | Customer approved and supplied a PO. Invoice exists. |
| `shipping` | staff | Handed to a courier. Tracking number visible. |
| `delivered` | staff | Received by the customer. |
| `cancelled` | staff | Stopped before shipping. |
| `declined` | customer | Customer rejected the quoted price. Terminal. |

Transitions are guarded in one place (`lib/orders.ts`), not at each call site: an
illegal move such as `received → shipping` is rejected rather than silently
applied. `declined` is reachable only from `quoted`; `cancelled` from any state
before `shipping`; both are terminal. Re-quoting a declined order means creating
a new one, which keeps the guard a simple table rather than a graph.

Approval by the customer is what creates the order in the commercial sense. It
is the recorded, timestamped moment they accepted a price, which is why the
invoice number and the FX rate are both assigned there and nowhere else.

**Guest orders never reach `quoted`.** Approval requires an account, so a guest
order is priced and confirmed by staff directly, on the strength of whatever was
agreed by phone or email — `received → confirmed`, with staff supplying the PO
number. Invoices for guest orders are readable by staff only and sent by hand.
This is a deliberate nudge toward accounts rather than a second anonymous
approval flow guarded by nothing but a guessable reference.

## Data model

### New

```
users
  id                 uuid pk default gen_random_uuid()
  email              text not null            -- unique index on lower(email)
  password_hash      text not null
  company            text not null default ''
  contact_name       text not null default ''
  phone              text not null default ''
  default_po_number  text not null default ''
  locale             text not null default 'en'
  created_at         timestamptz not null default now()
```

One table. Sessions are a signed cookie, not rows (see Authentication).

### Renamed

`quotes → orders`, `quote_items → order_items`. The domain word for a delivered
shipment cannot be "quote".

```
orders   (existing columns kept: ref, company, contact_name, email, phone,
          po_number, address, city, country, notes, locale, currency,
          total_cents, created_at)
  + user_id                    uuid null references users(id) on delete set null
  + status                     text not null default 'received'
  + requested_total_cents      integer not null default 0
  + courier                    text not null default ''
  + tracking_number            text not null default ''
  + invoice_number             text                              -- null until confirmed
  + fx_rate_to_toman           integer                           -- null until confirmed
  + quoted_at, approved_at, shipped_at, delivered_at   timestamptz null

  indexes: unique(ref), unique(invoice_number), (user_id, created_at desc),
           (status, created_at desc)
  check:   status in ('received','quoted','confirmed','shipping','delivered',
                      'cancelled','declined')

order_items
  + requested_unit_price_cents integer not null default 0
```

`user_id` is nullable because guest checkout stays. A null means nobody can see
this order but staff and whoever holds the reference.

`ref` moves from `RFQ-XXXXXX` to `ORD-XXXXXX`, same unambiguous alphabet
(no O/0, no I/1 — these get read aloud on the phone).

### Two columns that exist for correctness, not convenience

**`fx_rate_to_toman`.** `formatPrice` converts USD cents to Toman at render time
using the `USD_TO_TOMAN` environment variable. An invoice must never do that:
editing the rate would retroactively change the amount owed on invoices already
sent. The rate in force at approval is frozen onto the order, and the invoice
renders from that number alone.

**`requested_unit_price_cents`.** The price the customer saw when they submitted,
kept beside the price staff finally quoted. Without it there is no way to show
"you asked at $0.35, we quoted $0.31", and no way to tell an unchanged price
from one that was never reviewed.

### Migration

`drizzle-kit push` reconciles by diffing the schema, and can implement a rename
as drop-then-create — which would destroy submitted quotes. The rename therefore
ships as an explicit script run *before* push:

`scripts/rename-quotes-to-orders.mts`

1. `ALTER TABLE quotes RENAME TO orders`, `quote_items → order_items`, and each
   affected index and constraint.
2. Backfill `requested_total_cents = total_cents`,
   `requested_unit_price_cents = unit_price_cents`.
3. Rewrite existing refs from `RFQ-` to `ORD-`.
4. Map old `status` values (`submitted`) to `received`.
5. `CREATE SEQUENCE invoice_seq` — the source of invoice numbers, so two
   simultaneous approvals cannot be handed the same one.

The script guards its target the same way `src/seed/index.ts` does
(`assertSafeTarget`), so it cannot be run against production because
`DATABASE_URL` was still exported. `npm run db:push` then adds the new columns.

## Authentication

Two independent systems that share primitives, not tables.

**Customers.** Email and password. No reset flow in v1 — staff reset a password
by hand from the admin page. Sign-up captures email, password, company, contact
name, phone; all but email and password may be edited later at `/account`.

**Staff.** Unchanged: the existing single shared password in `ADMIN_PASSWORD`
with its HMAC cookie. Named staff logins are deferred.

**Shared primitives**

- `lib/password.ts` — scrypt from `node:crypto`, 16-byte random salt, stored as
  `scrypt$N$r$p$<salt-b64>$<hash-b64>`; comparison via `timingSafeEqual`. Chosen
  over argon2 or bcrypt because both are native modules, and a native module is
  a build failure waiting to happen on a managed platform.
- `lib/session.ts` — cookie value `<userId>.<expiryEpoch>.<hmac>`, signed
  HMAC-SHA256 with `AUTH_SECRET`. httpOnly, sameSite lax, secure in production,
  30-day expiry. Verification recomputes the HMAC and checks expiry; a tampered
  or expired cookie is treated as signed out.

`AUTH_SECRET` is required. In production its absence throws at startup rather
than falling back to a default — a predictable signing key means anyone can mint
a cookie for any user id. In development it falls back to a fixed dev value with
a console warning.

**Accepted limitation.** A signed cookie cannot be revoked individually.
Signing out clears it on that device; invalidating every session everywhere
means rotating `AUTH_SECRET`. At this scale that is the right trade, and moving
to a `sessions` table later changes one file.

**Sign-in responses are deliberately uniform.** Wrong password and unknown email
both return "Email or password is incorrect", so the form cannot be used to
discover which addresses have accounts.

## Customer-facing

### Checkout

Unchanged for guests. When signed in: the form prefills from the profile, the PO
field defaults to `default_po_number`, and the created order carries `user_id`.

Orders placed as a guest stay unlinked. There is no email verification in v1, so
auto-claiming a guest order by matching email address would let anyone read a
stranger's order by signing up with their address. A claim-by-reference flow can
be added once email verification exists.

### `/[locale]/account`

Order list: reference, date, status pill, item count, total. Empty state links
to the catalog.

### `/[locale]/account/orders/[ref]`

Ownership is checked on every request — `order.user_id` must equal the session
user, otherwise 404 (not 403, which would confirm the reference exists).

Contents:

- Status timeline built from the `*_at` columns.
- Line items with part number, description, quantity, requested and quoted unit
  price, line total.
- Courier and tracking number, once `shipping`.
- Invoice link, once `confirmed`.
- When `quoted`: the final figures, a PO number input, and **Approve** /
  **Decline**.

**Approve** is a Server Action that re-checks ownership and that the status is
still `quoted` (a stale tab must not approve twice), then in one transaction
sets `status = confirmed`, `approved_at`, `po_number`, `fx_rate_to_toman` from
the current environment value, and `invoice_number` from a Postgres sequence
formatted `INV-<year>-<0000>`.

### `/[locale]/invoice/[ref]`

Readable by the owning customer or by staff. A normal page with a print
stylesheet; **Download PDF** calls `window.print()` and the browser's own
Save-as-PDF produces the file. This renders Persian correctly for free —
shaping and bidi are the browser's job — and reuses Vazirmatn and the existing
type scale.

Both languages come from one template driven by the locale segment, so `/en/…`
and `/fa/…` differ only in dictionary lookups and direction. Persian invoices
show Toman converted at the frozen rate, with the rate printed as a footnote.

Contents: invoice number and date, seller block, buyer block (company, contact,
address, PO number), line items, subtotal and total, and the order reference.

The route returns HTML and takes the locale from the path, so adding a
server-side renderer later is a new endpoint that screenshots this page — no
change to the template.

## Admin

All admin write actions are blocked when `DEMO_MODE=1`, which makes the page
publicly readable. A public page that can change order statuses or overwrite the
catalog is not acceptable, so demo mode is read-only and says so in its banner.

### `/[locale]/admin` — order queue

Filter by status, default to everything needing action (`received`, `quoted`,
`confirmed`, `shipping`). Each row expands to the existing detail view, plus:

- **Price and send quote.** Editable unit price per line; total recomputes;
  submitting sets `status = quoted` and `quoted_at`.
- **Mark shipping.** Requires courier name and tracking number — the action
  rejects a blank tracking number rather than moving the order to a state whose
  whole purpose is showing that number.
- **Mark delivered**, **Cancel**.
- **Confirm on behalf** — guest orders only: set prices and PO, go straight to
  `confirmed`.
- **Reset customer password** — generates a random password, stores its hash,
  and displays the plaintext once on the page for staff to pass on. It is never
  stored in plaintext and never shown again.

### `/[locale]/admin/import` — catalog loading

Families listed grouped under their category, each with two links and an upload:

- **Download template** — headers plus three example rows. For adding new SKUs.
- **Export products** — every SKU in the family, fully populated. Edit prices in
  Excel and re-upload.

Both files share one column set, so either can be uploaded back:

```
part_number, <one column per spec key of that family>,
price_usd, pack_qty, lead_days, in_stock
```

**Upload is all-or-nothing.** Every row is validated first; if anything fails,
nothing is written and the page lists each failure as row, column and reason.
This replaces a dry-run diff preview — most of the safety, a fraction of the UI.

Validation: part number present and unique within the file; numeric fields
parse; every spec column matches a `spec_defs` key for that family; no unknown
columns; `in_stock` is yes/no.

**Writes happen in one transaction and maintain everything a product touches.**
Inserting a row into `products` alone leaves the catalog subtly broken — facets
and counts come from elsewhere:

1. Upsert `products` by `part_number` (existing rows update, new rows insert).
2. Replace `product_spec_values` for those products — this is the facet index;
   miss it and filters return wrong results.
3. Recompute `search_text` per product.
4. Recompute `product_families.product_count`, then roll up into
   `categories.product_count` for every ancestor.

CSV parsing uses `csv-parse`. Hand-rolling looks cheaper until a supplier sends
a file with quoted fields containing commas, CRLF line endings, or a UTF-8 BOM
in front of the first header — all of which Excel produces by default.

Changing which columns a family has, or which appear in the catalog table, is
explicitly out of scope. Templates are generated from the existing `spec_defs`.

## Error handling

- Server Actions redirect back with an `?error=<code>` query parameter and the
  page renders the matching message, following the existing quote form.
- Import failures render as a list of `{ row, column, message }`; nothing is
  written.
- Sign-in failures are uniform (see Authentication).
- Ownership failures return 404.
- Illegal status transitions throw from the guard in `lib/orders.ts` and surface
  as an error banner.

## Testing

The repository has no test runner. Add `node:test` run through `tsx`, and cover
the pure logic where a bug is silent rather than loud:

- `lib/password.ts` — hash then verify round-trips; a wrong password fails; a
  corrupted hash string fails rather than throwing.
- `lib/session.ts` — a signed cookie verifies; a tampered one does not; an
  expired one does not.
- Status transition guard — every legal move allowed, a sample of illegal ones
  rejected.
- CSV parse and validate — quoted fields, CRLF, BOM, missing column, unknown
  column, duplicate part number, bad number.
- Invoice money maths — line totals, subtotal, Toman conversion at a fixed rate.

Database-touching paths are verified by hand against the local Docker Postgres
during each phase, listed as manual checks in the implementation plan. A full
integration harness is deferred.

## Build order

Each phase ends with something usable.

1. **Orders domain** — rename migration, status column and guard, admin queue
   with pricing, shipping, tracking and delivery. The store is operable with no
   accounts at all.
2. **Customer accounts** — sign-up, sign-in, sign-out, `/account`, order detail,
   approve and decline with PO entry, prefilled checkout.
3. **Invoices** — invoice route, print stylesheet, both locales, frozen FX rate.
4. **Bulk import** — template and export downloads, upload, validation,
   transactional write with facet index and count maintenance.

Phases 1 and 4 are independent; 4 can move first if loading the real catalog is
more urgent than running orders. Phase 3 needs the invoice number from phase 1;
it needs phase 2 only for customer-visible invoices, so a staff-only invoice
could ship earlier if that turns out to be the urgent half.

## Known gaps

Stated so they are choices rather than surprises.

- **No email, anywhere.** A customer is not told when their quote has been
  priced — they have to visit `/account` and look. This is the largest
  functional gap in v1 and the first thing worth closing.
- **No password reset.** Staff reset by hand from the admin page.
- **No email verification**, which is why guest orders cannot be auto-claimed.
- **No rate limiting on sign-in.** Meaningful protection needs shared state
  across serverless instances; deferred with the rest of the auth hardening.
- **Sessions cannot be revoked individually.**
- **No named staff accounts**, so order changes are not attributable.
- **No inventory or stock levels.** `in_stock` stays the manual boolean it is
  today.
- **No payment.**

## i18n

Every new string lands in both dictionaries in `src/lib/i18n.ts`. Persian
requires attention in three places: status names, the invoice, and the account
area. Numbers stay Latin in technical contexts — part numbers, tracking numbers,
invoice numbers — matching how the spec table already treats them, and each is
wrapped so bidi cannot reorder it against surrounding Persian text.
