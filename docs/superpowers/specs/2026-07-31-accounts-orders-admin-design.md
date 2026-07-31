# Customer accounts, orders, invoices and bulk import

Date: 2026-07-31
Status: approved, not yet implemented

## Goal

Turn the catalog from a request-for-quote form into a working store: customers
can hold an account, watch an order through to delivery, and fetch an invoice in
English or Persian; staff can price a request, invoice it, ship it, and load
products in bulk.

Deliberately out of scope for v1: in-app payment, inventory and stock levels,
automated email, and named staff accounts. Each is noted under Known gaps with
what it costs to leave out.

## The workflow this is built around

Pricing and payment happen off-platform. The app records what happened; it does
not conduct the negotiation.

1. Customer submits a request from the cart. Status `received`.
2. Staff review it and contact the customer by phone or email to agree final
   pricing. Nothing in the app changes during this step.
3. Staff enter the agreed prices, mark the order **invoiced**, and paste in a
   payment link. The invoice number and FX rate are assigned here. Staff open
   the invoice page, save it as PDF, and email it with the link.
4. Payment arrives. Staff mark the order **preparing**.
5. Staff ship it, entering courier and tracking number. Status **shipped**.
6. Staff confirm delivery from the tracking. Status **delivered**. Sale closed.

The customer's account page reflects each of those states and never drives them.
This is what makes the whole feature small: there is one actor for every
transition, so there is no approval handshake, no state that waits on the
customer, and no difference between a guest order and an account order except
who is allowed to look at it.

## Guiding constraint

The codebase stays small. Every choice below was made twice — once for
correctness, once for how much code it adds — and the cheaper option won unless
skipping it would produce wrong data. The schema change is one new table plus a
rename.

## Order lifecycle

```
received ──▶ invoiced ──▶ preparing ──▶ shipped ──▶ delivered
    │            │             │
    └────────────┴─────────────┴──▶ cancelled
```

| Status | Set by | Means | Customer sees (en / fa) |
| --- | --- | --- | --- |
| `received` | system, on submit | Request is in; prices are what the catalog showed. | Received / دریافت شد |
| `invoiced` | staff | Final prices agreed, invoice issued, payment link sent. | Awaiting payment / در انتظار پرداخت |
| `preparing` | staff | Payment received; order being prepared. | Preparing for shipment / در حال آماده‌سازی |
| `shipped` | staff | Handed to a courier; tracking number available. | Shipped / ارسال شد |
| `delivered` | staff | Confirmed delivered. Terminal. | Delivered / تحویل داده شد |
| `cancelled` | staff | Stopped before shipping. Terminal. | Cancelled / لغو شد |

Transitions are guarded in one place (`lib/orders.ts`) rather than at each call
site: an illegal move such as `received → shipped` is rejected instead of
silently applied. Forward one step only, plus `cancelled` from any state before
`shipped`. Both terminal states are final — reviving a cancelled order means
creating a new one, which keeps the guard a lookup table rather than a graph.

Guest orders and account orders run the identical path. The only difference is
that a guest cannot sign in to watch it (see Guest tracking).

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
  + payment_url                text not null default ''
  + courier                    text not null default ''
  + tracking_number            text not null default ''
  + invoice_number             text                    -- null until invoiced
  + fx_rate_to_toman           integer                 -- null until invoiced
  + invoiced_at, paid_at, shipped_at, delivered_at   timestamptz null

  indexes: unique(ref), unique(invoice_number),
           (user_id, created_at desc), (status, created_at desc),
           (lower(email), ref)                          -- guest tracking lookup
  check:   status in ('received','invoiced','preparing','shipped',
                      'delivered','cancelled')

order_items
  + requested_unit_price_cents integer not null default 0
```

`paid_at` is when the order entered `preparing`; that transition means "payment
landed", so a second column for it would only be a synonym.

`user_id` is nullable because guest checkout stays. Null means only staff, and
whoever can supply the reference *and* the email, may see it.

`ref` moves from `RFQ-XXXXXX` to `ORD-XXXXXX`, same unambiguous alphabet
(no O/0, no I/1 — these get read aloud on the phone).

### Two columns that exist for correctness, not convenience

**`fx_rate_to_toman`.** `formatPrice` converts USD cents to Toman at render time
using the `USD_TO_TOMAN` environment variable. An invoice must never do that:
editing the rate would retroactively change the amount owed on an invoice
already emailed. The rate in force when the order is invoiced is frozen onto the
row, and the invoice renders from that number alone.

**`requested_unit_price_cents`.** The price the customer saw when they
submitted, kept beside the price staff finally set. Without it there is no way
to show "you asked at $0.35, we invoiced $0.31", and no way to tell an unchanged
price from one nobody reviewed.

### Migration

`drizzle-kit push` reconciles by diffing the schema, and can implement a rename
as drop-then-create — which would destroy submitted requests. The rename
therefore ships as an explicit script run *before* push:

`scripts/rename-quotes-to-orders.mts`

1. `ALTER TABLE quotes RENAME TO orders`, `quote_items → order_items`, and each
   affected index and constraint.
2. Backfill `requested_total_cents = total_cents`,
   `requested_unit_price_cents = unit_price_cents`.
3. Rewrite existing refs from `RFQ-` to `ORD-`.
4. Map the old `status` value `submitted` to `received`.
5. `CREATE SEQUENCE invoice_seq` — the source of invoice numbers, so two
   simultaneous invoicings cannot be handed the same one.

The script guards its target the way `src/seed/index.ts` does
(`assertSafeTarget`), so it cannot run against production merely because
`DATABASE_URL` was still exported. `npm run db:push` then adds the new columns.

## Authentication

Two independent systems that share primitives, not tables.

**Customers.** Email and password. No reset flow in v1 — staff reset a password
by hand from the admin page. Sign-up captures email, password, company, contact
name, phone; all but email and password are editable later at `/account`.

**Staff.** Unchanged: the existing single shared password in `ADMIN_PASSWORD`
with its HMAC cookie. Named staff logins are deferred.

**Shared primitives**

- `lib/password.ts` — scrypt from `node:crypto`, 16-byte random salt, stored as
  `scrypt$N$r$p$<salt-b64>$<hash-b64>`; comparison via `timingSafeEqual`. Chosen
  over argon2 and bcrypt because both are native modules, and a native module is
  a build failure waiting to happen on a managed platform.
- `lib/session.ts` — cookie value `<userId>.<expiryEpoch>.<hmac>`, signed
  HMAC-SHA256 with `AUTH_SECRET`. httpOnly, sameSite lax, secure in production,
  30-day expiry. Verification recomputes the HMAC and checks expiry; a tampered
  or expired cookie reads as signed out.

`AUTH_SECRET` is required. In production its absence throws at startup rather
than falling back to a default — a predictable signing key lets anyone mint a
cookie for any user id. In development it falls back to a fixed dev value with a
console warning.

**Accepted limitation.** A signed cookie cannot be revoked individually. Signing
out clears it on that device; invalidating every session everywhere means
rotating `AUTH_SECRET`. At this scale that is the right trade, and moving to a
`sessions` table later changes one file.

**Sign-in responses are uniform.** Wrong password and unknown email both return
"Email or password is incorrect", so the form cannot be used to discover which
addresses have accounts.

## Customer-facing

### Checkout

Unchanged for guests. When signed in, the form prefills from the profile, the PO
field defaults to `default_po_number`, and the created order carries `user_id`.
PO number is captured at submission — there is no later point at which the
customer touches the order.

Orders placed as a guest stay unlinked to any account. Without email
verification, auto-claiming a guest order by matching address would let anyone
read a stranger's order by signing up with their email.

### `/[locale]/account`

Order list: reference, date, status pill, item count, total. Empty state links
to the catalog. Also holds profile editing (company, contact name, phone,
default PO, locale) and sign-out.

### `/[locale]/account/orders/[ref]`

Ownership checked on every request — `order.user_id` must equal the session
user, otherwise 404, not 403, which would confirm the reference exists.

Read-only. It shows:

- Status timeline built from the `*_at` columns.
- Line items with part number, description, quantity, requested and final unit
  price, line total.
- **Pay now** linking to `payment_url`, while `invoiced`.
- **View invoice**, once `invoiced`.
- Courier and tracking number, once `shipped`.

There are no actions on this page beyond following those two links. Every state
change belongs to staff.

### `/[locale]/track` — guest tracking

A public form taking order reference **and** the email it was placed with; both
must match. Returns status, timeline, courier and tracking number. It does not
return line items, prices, or the invoice — a reference is six characters and
therefore guessable in a way an account password is not, so the pairing gates
access and the payload stays thin.

Failures are uniform: "No order found with that reference and email address."
Success and failure take the same path, so the form cannot be used to test which
email addresses have ordered.

### `/[locale]/invoice/[ref]`

Readable by the owning customer or by staff. Guest orders have no owner, so
their invoices are staff-only and reach the customer as an emailed PDF.

A normal page with a print stylesheet; **Download PDF** calls `window.print()`
and the browser's Save-as-PDF produces the file. This renders Persian correctly
for free — shaping and bidi are the browser's job — and reuses Vazirmatn and the
existing type scale. It is also exactly how staff produce the PDF they email.

Both languages come from one template driven by the locale segment, so `/en/…`
and `/fa/…` differ only in dictionary lookups and text direction. Persian
invoices show Toman converted at the frozen rate, with the rate printed as a
footnote.

Contents: invoice number and date, seller block, buyer block (company, contact,
address, PO number), line items, subtotal and total, payment link, and the order
reference.

The route returns HTML and takes its locale from the path, so adding a
server-side PDF renderer later is a new endpoint that screenshots this page — no
change to the template.

## Admin

All admin write actions are blocked when `DEMO_MODE=1`, which makes the page
publicly readable. A public page that can change order statuses or overwrite the
catalog is not acceptable, so demo mode is read-only and its banner says so.

### `/[locale]/admin` — order queue

Filter by status, defaulting to everything needing action (`received`,
`invoiced`, `preparing`, `shipped`). Each row expands to the existing detail
view, plus one action per transition:

- **Set prices and invoice.** Editable unit price per line; total recomputes.
  Requires a payment link. Submitting assigns `invoice_number` from
  `invoice_seq`, freezes `fx_rate_to_toman`, sets `status = invoiced` and
  `invoiced_at`. A link to the invoice page appears, for saving as PDF.
- **Mark payment received** → `preparing`, `paid_at`.
- **Mark shipped.** Requires courier name and tracking number — the action
  rejects a blank tracking number rather than entering a state whose entire
  purpose is displaying that number.
- **Mark delivered**, **Cancel**.
- **Reset customer password** — generates a random password, stores its hash,
  and displays the plaintext once for staff to pass on. Never stored in
  plaintext, never shown again.

### `/[locale]/admin/import` — catalog loading

Families listed grouped under their category, each with two links and an upload:

- **Download template** — headers plus three example rows, for adding new SKUs.
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
Inserting into `products` alone leaves the catalog subtly broken, because facets
and counts are computed elsewhere:

1. Upsert `products` by `part_number` — existing rows update, new rows insert.
2. Replace `product_spec_values` for those products. This is the facet index;
   miss it and filters return wrong results while looking fine.
3. Recompute `search_text` per product.
4. Recompute `product_families.product_count`, then roll it up into
   `categories.product_count` for every ancestor.

CSV parsing uses `csv-parse`. Hand-rolling looks cheaper until a supplier sends
a file with quoted fields containing commas, CRLF line endings, or a UTF-8 BOM
in front of the first header — all of which Excel produces by default.

Changing which columns a family has, or which appear in the catalog table, is
explicitly out of scope. Templates are generated from the existing `spec_defs`.

## Error handling

- Server Actions redirect back with `?error=<code>` and the page renders the
  matching message, following the existing quote form.
- Import failures render as a list of `{ row, column, message }`; nothing is
  written.
- Sign-in and guest-tracking failures are uniform (see above).
- Ownership failures return 404.
- Illegal status transitions throw from the guard in `lib/orders.ts` and surface
  as an error banner.

## Testing

The repository has no test runner. Add `node:test` run through `tsx`, covering
the pure logic where a bug is silent rather than loud:

- `lib/password.ts` — hash then verify round-trips; wrong password fails; a
  corrupted hash string fails rather than throwing.
- `lib/session.ts` — a signed cookie verifies; a tampered one does not; an
  expired one does not.
- Status transition guard — every legal move allowed, illegal ones rejected,
  terminal states immovable.
- CSV parse and validate — quoted fields, CRLF, BOM, missing column, unknown
  column, duplicate part number, unparseable number.
- Invoice money maths — line totals, subtotal, Toman conversion at a fixed rate.

Database-touching paths are verified by hand against the local Docker Postgres
during each phase, listed as manual checks in the implementation plan. A full
integration harness is deferred.

## Build order

Each phase ends with something usable.

1. **Orders domain** — rename migration, status column and guard, admin queue
   with pricing, invoicing, payment, shipping, tracking and delivery. The store
   is fully operable by staff at the end of this, with no accounts at all.
2. **Invoices** — invoice route, print stylesheet, both locales, frozen FX rate.
   Staff can now email a real invoice. Depends on phase 1 for the invoice
   number; needs nothing from accounts, since it is staff-readable first.
3. **Customer accounts** — sign-up, sign-in, sign-out, `/account`, order detail,
   profile, prefilled checkout, and customer access to their own invoice.
4. **Guest tracking** — the public reference-plus-email lookup.
5. **Bulk import** — template and export downloads, upload, validation,
   transactional write with facet index and count maintenance.

Phase 5 is independent of everything else and can move first if loading the real
catalog is more urgent than running orders.

## Known gaps

Stated so they are choices rather than surprises.

- **The app sends no email.** This is the intended v1 workflow, not an
  oversight: staff save the invoice as PDF and email it with the payment link
  themselves. The cost is that nothing tells a customer their invoice is ready
  unless a human does, and status changes are equally silent.
- **No password reset.** Staff reset by hand from the admin page.
- **No email verification**, which is why guest orders cannot be auto-claimed
  into an account.
- **No rate limiting** on sign-in or guest tracking. Meaningful protection needs
  shared state across serverless instances; deferred with the rest of auth
  hardening. The uniform error messages limit what an attacker learns per
  attempt, but do not limit the attempts.
- **Sessions cannot be revoked individually.**
- **No named staff accounts**, so order changes are not attributable to a
  person.
- **No inventory or stock levels.** `in_stock` stays the manual boolean it is
  today.
- **No in-app payment.** `payment_url` points wherever staff choose.

## i18n

Every new string lands in both dictionaries in `src/lib/i18n.ts`. Persian needs
attention in three places: status names, the invoice, and the account area.
Numbers stay Latin in technical contexts — part numbers, tracking numbers,
invoice numbers — matching how the spec table already treats them, each wrapped
so bidi cannot reorder it against surrounding Persian text.
