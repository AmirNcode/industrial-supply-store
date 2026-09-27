# Sales reps and a basic CRM

Date: 2026-09-27
Status: design approved in conversation (2026-09-26/27); this written spec awaits review
Branch: `feat/sales-reps` — local testing only, nothing deployed

Part A is the product: who can do what, and the money rules. It is written for
the owner to check. Part B is how it is built, for whoever implements it.

---

# Part A — What it does

## Who's who

Three kinds of people, three separate sign-ins:

| Person | Signs in at | With |
| --- | --- | --- |
| Admin (you) | `/admin/login` | the one shared password — unchanged |
| Sales rep | `/rep/signin` | a username and their own password |
| Customer | `/account/signin` | email **or** customer ID, and their own password |

A rep's sign-in opens only that rep's customers and orders. It never opens the
admin panel or a customer's account, and no rep sees another rep's customers.

## Admin: managing reps and customers

- **Sales reps tab.** Create a rep: name, username, phone, email (optional),
  commission %, monthly target (optional). The site makes a temporary password,
  shows it once, and offers a ready-to-send message with the sign-in address,
  username and password.
- **Each rep's page:** edit details (name, username, phone, email) and
  commission % (0–100, up to two decimals, e.g. 2.5%); reset password (new temporary password, shown once —
  also signs the rep out on every device); set the monthly target; record and
  delete payouts; see the rep's home page numbers, commission and customers.
- **Deactivate.** The rep is locked out at once, including any open session.
  In the same step you choose where their customers go: another active rep, or
  unassigned. Nothing is deleted. A deactivated rep can be reactivated; moved
  customers do not move back by themselves.
- **Customers tab.** Every customer: ID, company, contact, phone, rep, whether
  the rep earns commission on them, and how the account was created. Search by
  ID, company, phone or email; filter to unassigned or to one rep. Open a
  customer to **change their rep**, switch commission on or off, read and add
  notes, see their orders, and reset their password.
- **Order queue.** Each order shows its rep, whether a rep placed it, and the
  customer ID, plus a **Copy pay link** button.
- **Settings.** A **Bank details** box per language. If one language is empty,
  the other is shown.

## Reps: managing customers

- **New customer:** company, contact name and phone are required; email,
  address and city are optional.
- **Customer ID** is 7 digits and is how the customer signs in.
  - Default: the last 7 digits of the phone number. Or the rep picks a random
    7-digit number.
  - If the phone's digits are already someone's ID, the rep is told this
    customer may already have an account (ask the admin), and can create the
    account with a random number instead. Same for an email that already has
    an account.
  - An ID never changes, even if the phone number does.
- The site makes a **temporary password**, shows it once, and offers a
  **Share** message with the sign-in address, the ID and the password. The
  customer must choose their own password when they first sign in.
- A rep can edit their customers' details and issue a new temporary password.
  A rep cannot change a customer's rep or commission setting — only the admin
  can.
- **Notes:** a timestamped log per customer. The rep and the admin read and
  add notes; the customer never sees them. Notes cannot be edited or deleted,
  so the log always shows what was known and when. If a customer moves to
  another rep, the notes go with the customer.
- **Follow-up:** one "next follow-up" date per customer, set with quick
  choices (tomorrow, 3 days, 1 week, 2 weeks, 1 month) or cleared. The rep's
  home page lists customers due today or overdue.
- **Referral link:** each rep has a personal link for marketing. Someone who
  opens it and signs up within 30 days becomes that rep's customer (the latest
  link opened wins). Existing customers never change rep through a link.
- The customer's account page shows their **customer ID** and **"Your sales
  rep: name, phone"**.

## Orders and the pay link

- The rep opens a customer → **New order** → shops the normal catalog or quick
  order. The cart and checkout say "Ordering for: [company]". Checkout is
  filled in from the customer's record; email is optional. The order lands in
  the admin queue as usual.
- The admin prices, invoices and marks paid / shipped / delivered exactly as
  today. **Reps cannot change prices, give discounts, change status, or
  cancel.**
- **Every order has a private pay link** — new and existing orders, whoever
  placed them. It works like an unlisted video: anyone with the link can open
  it; nobody can find it without the link. No sign-in needed. It shows the
  order number, company, status, items and total:
  - **Before invoicing:** "being priced"; items at today's catalog prices,
    marked as an estimate. No payment instructions yet — there is no final
    amount to pay, and showing bank details then invites paying the wrong
    amount.
  - **Invoiced:** the amount due; a Pay button when the admin added a payment
    link; the bank details; View invoice.
  - **Paid, shipped, delivered:** "Paid — thank you", tracking once shipped,
    View invoice.
  - **Cancelled:** says so.
- A signed-in customer's own order page also shows the bank details while an
  order awaits payment.
- A signed-in customer placing their own order no longer has to type an email
  if their account has none. Guests still must (it is how they track orders).
- The rep's **Orders** page lists every order of their customers with its
  status; each has **Share pay link**.
- **Reorder:** from a past order, copies its items at today's prices into the
  rep's cart, ordering for the same customer. Items no longer sold are skipped
  and listed.

## Money rules

1. **A sale is an order the admin marks delivered.** Its month is the Persian
   month of delivery, Tehran time. Sales numbers, targets and commission all
   use this one definition.
2. **The rep credited is the customer's rep at the moment the order is
   placed** — whoever places it, rep or customer. Guest orders and orders from
   customers with no rep credit nobody.
3. **The commission rate is locked at that same moment.** Changing a rate or
   moving a customer only affects orders placed afterwards.
4. **Commission eligibility is set per customer:**
   - created by a rep → on
   - signed up through a rep's referral link → on
   - signed up alone and later assigned — including every customer who exists
     today → **off, until the admin switches it on**

   Eligibility is locked when an order is placed, too. An order without
   commission still counts in the rep's sales and toward their target; it just
   earns 0 commission. Moving a customer to another rep keeps their setting;
   the admin can change it in the same place.
5. **Commission on a sale = the invoiced total in rial (at the exchange rate
   frozen on that invoice) × the locked rate.** Cancelled orders never count.
6. **Owed = all commission earned − all payouts recorded.** A payout is an
   amount in rial plus a note, dated when recorded. A mistaken payout can be
   deleted.
7. **Monthly target** (rial, per rep): applies from the month it is set until
   changed. Progress = that month's sales.
8. **Reps see money only in rial, and only the prices customers see** — never
   dollars, the admin's internal order notes, or stock counts. Catalog pages
   show reps exactly what customers see: rial, with today's setting. (If the
   site were ever switched to showing both currencies, English catalog pages
   would show dollars to everyone, reps included — a cached page cannot tell
   who is reading it.)
9. Dates on rep pages and all rep money figures use the **Persian calendar**.

## Rep's pages

- **Home:**
  - tiles: sales to date; this month; this year; number of customers
    currently assigned; average sales per buying customer (sales to date ÷
    customers with at least one sale); commission owed
  - this month's target bar
  - monthly table for a chosen year (Farvardin → Esfand): sales, number of
    sales, commission, target, % of target — and one total row per year
  - top 5 customers by sales, all time
  - follow-ups due
  - referral link with Share
- **Customers** (search by ID, company or phone; next follow-up and sales
  shown per customer), **customer page**, **New customer**
- **Orders**, **order page** (status, items, pay link, Reorder)
- **Commission:** earned per month, payouts, owed, and orders still in
  progress with their expected commission (exact once invoiced; an estimate
  before)
- **Password:** change own password

The admin sees any rep's home numbers and commission from that rep's admin
page.

## Passwords

- **Reps:** at least 8 characters, including at least one uppercase letter
  (A–Z), one number, and one special character (anything that is not a letter,
  number or space). Persian digits count as numbers and are treated the same
  as 0–9, so a password typed on a Persian keyboard also works on an English
  one.
- **Customers:** unchanged — at least 8 characters.
- Every temporary password — rep or customer, new or reset — must be replaced
  at the next sign-in. Temporary passwords are made to meet the rep rule.

## Not included

- No email or SMS. Reps send everything from their own phone (Share button).
- No online payment gateway. When one is added, links already sent keep
  working.
- No leads list. No rep sees another rep's customers.
- No per-order commission override and no history of rate changes — each order
  records the rate it used, so every past commission stays explainable.

## Risks that remain

- **A pay link cannot be revoked.** Anyone holding it can see that order and
  its invoice — the same as forwarding the invoice PDF.
- **Customer IDs contain the last 7 digits of the phone.** It is a username,
  not a secret; sign-in is rate-limited.
- **Temporary passwords travel through messaging apps** until the customer or
  rep replaces them.
- **Customer sessions still cannot be ended remotely** (existing gap): a
  customer's password reset does not sign them out on other devices. Rep
  sessions do not have this gap.
- **The admin is still one shared password.** Anyone who has it can create
  reps, change rates and record payouts, and nothing records who did it.

---

# Part B — How it is built

## B1. Approach

Reps are a **separate identity** — their own table, cookie and route tree —
not rows in `users` with a role column. This extends the rule in
ARCHITECTURE.md ("Two independent auth systems — they share nothing on
purpose"): a role check that slips hands a customer rep powers, while a
separate table and cookie cannot be confused for each other. Shared primitives
only: `lib/password.ts`, `lib/rateLimit.ts`, `AUTH_SECRET`.

Staff (admin) authentication is untouched.

## B2. Data model

One forward-only, idempotent migration,
`supabase/migrations/20260927120000_add_sales_reps.sql`, mirrored in
`src/db/schema.ts`. Every new table enables RLS in the migration (the loop in
`extensions.sql` re-applies it after any local push). New tables, columns,
constraints and the migration version are added to `scripts/verify-remote.mts`.

### `sales_reps` (new)

```
id                    uuid pk default gen_random_uuid()
username              text not null     check ^[a-z0-9._-]{3,32}$  (stored lower-case)   unique
password_hash         text not null
name                  text not null     check btrim(name) <> ''
phone                 text not null default ''
email                 text not null default ''
commission_rate_bp    integer not null default 0   check 0..10000   (basis points: 250 = 2.5%)
referral_code         text not null     6 chars, order-reference alphabet                unique
active                boolean not null default true
must_change_password  boolean not null default true
session_version       integer not null default 1   check > 0
created_at            timestamptz not null default now()
last_login_at         timestamptz
```

### `users` (customers) — added columns

```
customer_code          text not null     check ^[0-9]{7}$          unique
rep_id                 uuid → sales_reps(id) ON DELETE RESTRICT
rep_earns_commission   boolean not null default false
origin                 text not null default 'self'   check in ('self','rep','referral')
origin_rep_id          uuid → sales_reps(id) ON DELETE RESTRICT
must_change_password   boolean not null default false
address                text not null default ''
city                   text not null default ''
next_follow_up_on      date

check   origin = 'self' OR origin_rep_id IS NOT NULL
index   (rep_id, created_at)
index   (rep_id, next_follow_up_on) WHERE next_follow_up_on IS NOT NULL
```

`email` becomes **nullable** — a rep-created customer may have none. The
`lower(email)` unique index in `extensions.sql` is unchanged (NULLs do not
collide). `UserRow.email` becomes `string | null`, and every reader is
checked.

`ON DELETE RESTRICT` on the rep references makes "reps are never deleted" a
database fact rather than a convention.

Migration backfill for existing customers: `customer_code` = last 7 digits of
`phone` (Persian/Arabic digits translated first) when that code is free,
otherwise a random 1000000–9999999 until free — in a PL/pgSQL loop — then
`SET NOT NULL`. `origin` defaults to `'self'`, commission off.

### `orders` — added columns

```
rep_id              uuid → sales_reps(id) ON DELETE RESTRICT   credited rep, stamped at placement
commission_rate_bp  integer                                     locked at placement
placed_by_rep       boolean not null default false
pay_token           text not null unique
                    default replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')

check   (rep_id IS NULL) = (commission_rate_bp IS NULL)
check   commission_rate_bp IS NULL OR commission_rate_bp BETWEEN 0 AND 10000
check   NOT placed_by_rep OR rep_id IS NOT NULL
index   (rep_id, delivered_at) WHERE rep_id IS NOT NULL
```

`pay_token` is 64 hex characters (≈244 random bits). A volatile default is
evaluated per row, so adding the column gives every existing order its own
token, and no insert statement has to change.

### `customer_notes` (new)

```
id             serial pk
user_id        uuid not null → users(id) ON DELETE CASCADE
author_rep_id  uuid → sales_reps(id) ON DELETE RESTRICT     null = written by admin
body           text not null   check btrim(body) <> '' and char_length(body) <= 2000
created_at     timestamptz not null default now()
index (user_id, created_at)
```

Append-only, like `order_comments`: there is no update or delete path.

### `rep_payouts` (new)

```
id           serial pk
rep_id       uuid not null → sales_reps(id) ON DELETE RESTRICT
amount_rial  bigint not null   check > 0
note         text not null default ''   check char_length(note) <= 500
created_at   timestamptz not null default now()
index (rep_id, created_at)
```

### `rep_targets` (new)

```
rep_id         uuid not null → sales_reps(id) ON DELETE CASCADE
persian_year   integer not null   check 1300..1600
persian_month  integer not null   check 1..12
amount_rial    bigint not null    check >= 0
updated_at     timestamptz not null default now()
pk (rep_id, persian_year, persian_month)
```

The target for month M is the row with the greatest (year, month) ≤ M.
Setting a target writes (upserts) the current month's row.

### Settings

`app_settings` rows `bank_details_fa` and `bank_details_en` (plain text, blank
line = paragraph, no markup — the same rules as catalog descriptions). No
schema change.

## B3. Rep authentication

- **Cookie** `isupply_rep`:
  `v1.<repId>.<sessionVersion>.<expiryMs>.<signature>`, where the signature is
  HMAC-SHA256 over everything before it, keyed by `HMAC(AUTH_SECRET,
  "rep-session")`. The derived key means no customer or admin token can verify
  as a rep token, or the reverse. httpOnly, sameSite lax, secure in
  production, 14 days.
- **Code split** like the customer session: `lib/repSessionToken.ts` is pure
  (no `next/headers`) and unit-tested; `lib/repSession.ts` reads the cookie,
  verifies it, then loads the rep by primary key and requires `active` and a
  matching `session_version`. That one lookup is also the data every rep page
  needs.
- **Revocation:** password reset, password change and deactivation increment
  `session_version`, ending every session for that rep.
- **Password policy** in `lib/repPassword.ts` (pure): translate Persian/Arabic
  digits to ASCII, then require length ≥ `MIN_PASSWORD_LENGTH` (8), `[A-Z]`,
  `[0-9]`, and `[^\p{L}\p{N}\s]`. Hashing and verification both use the
  translated string.
- **Temporary passwords** in `lib/tempPassword.ts`: 12 characters from an
  unambiguous set, with at least one uppercase, lowercase, digit and one of
  `!@#$%*+=?`. Used for reps and customers.
- **Shown once:** the existing `isupply_new_password` pattern (30-second
  cookie, read by the next page render, never stored in plaintext) is reused
  for new reps, rep resets, new customers and customer resets.
- **Rate limits** (new policies in `lib/rateLimit.ts`): `repSignIn` 10 per 15
  minutes by IP and by username; `repWrite` 60 per 10 minutes by rep;
  `repOrderSubmit` 30 per 10 minutes by rep.
- **Forced change, reps:** route groups — `rep/signin` (public),
  `rep/(session)/password` (valid session only), `rep/(portal)/…` (valid
  session and not `must_change_password`, otherwise redirect to the password
  page). A layout cannot read the path, so the split has to be structural.
- **Forced change, customers:** new `/account/password`. `/account` and
  `/account/orders/*` redirect there while `must_change_password`. Setting a
  new password clears the flag. Rep-created accounts start with it set; rep
  resets and admin resets (including the existing reset-by-email on the order
  queue) set it.
- **Forced versus voluntary change:** a forced change asks only for the new
  password — the session was opened with the temporary one moments earlier. A
  voluntary change asks for the current password too, as customers' does
  today.
- Every new admin write calls `assertAdminWrite()` (refused under
  `DEMO_MODE`). Every rep write derives the rep from the session, never from
  form input, and scopes its SQL by that id (`… WHERE id = $1 AND rep_id =
  $rep`), treating `count === 0` as not found. Another rep's resource is a 404,
  not a 403.

## B4. Customer IDs and sign-in

- `lib/customerCode.ts` (pure): `normalizeDigits`, `codeFromPhone` (last 7
  digits, or null when fewer than 7), `randomCustomerCode` (1000000–9999999),
  `isCustomerCode`.
- Allocation in the insert: the unique index decides. Rep creation with
  phone-derived code → `code-taken` back to the form. Self sign-up → falls
  back to random silently. Random codes retry up to 10 times.
- Sign-in field "Email or customer ID": input normalized; 7 digits → lookup
  by `customer_code`, otherwise `lower(email)`. Same uniform failure message
  and dummy-hash timing as today.
- Sign-up: allocates a code; reads the referral cookie (B6).

## B5. Orders: stamping, rep checkout, reorder

- **Stamping** happens inside `submitOrderFromCartInTransaction`, for every
  order that has a user: in the same transaction, read the user's `rep_id` and
  `rep_earns_commission`, and that rep's `active` and `commission_rate_bp`.
  Set `orders.rep_id` (null if no rep or rep inactive), `commission_rate_bp`
  (the rep's rate if eligible, else 0; null with no rep) and `placed_by_rep`.
  One code path stamps both a customer's own order and a rep-built one.
- **Rep checkout.** `/quote` and `/cart` detect a rep session (the rep wins
  if a customer session is also present).
  - `isupply_rep_for`: httpOnly cookie holding a customer id, set by **New
    order** and **Reorder**, re-validated against the rep on every read.
  - `/quote` in rep mode shows a customer picker (the rep's customers by
    company) preselected from that cookie, with the contact fields prefilled
    from the customer: company, contact, phone, email, address, city, default
    PO. Email is optional in rep mode and for signed-in customers; still
    required for guests.
  - Submission keeps the existing cart-fingerprint and submission-key flow,
    with `userId` = the chosen customer (verified to belong to the rep),
    `placedByRep = true`, and the order's `locale` = the customer's preferred
    language (item family names are snapshotted in it). Rate limit
    `repOrderSubmit`. The rep lands on `/rep/orders/[ref]` with the pay link
    ready; the `for` cookie is cleared.
  - Money in rep mode is shown in rial regardless of the display setting.
- **Reorder:** rep-only Server Action. Loads the order (visible to the rep,
  and its customer currently the rep's), adds items whose product still
  exists with `addLines`, sets the `for` cookie, redirects to the cart with a
  notice naming skipped part numbers. Cart capacity limits apply as usual.
- **Visibility rule:** a rep can open an order when `orders.rep_id` is the rep,
  or the order's customer is currently the rep's. Lists show the latter;
  commission pages use the former.

## B6. Pay link, invoice access, referral cookie

- **`/[locale]/pay/[token]`:** dynamic, `noindex`, `referrer: no-referrer`.
  The token must match `^[0-9a-f]{64}$` before any query; lookup by the unique
  index. Money follows the customer display policy, like the account order
  page: catalog rounding at today's rate before invoicing (labelled estimate),
  exact at the frozen rate after.
- **Bank details:** `getBankDetails(locale)` with fallback to the other
  language; rendered while status is `invoiced`, on the pay page and on the
  customer's own order page.
- **Invoice:** `/[locale]/invoice/[ref]?key=<token>` is allowed when the key
  equals that order's `pay_token` (constant-time compare), in addition to
  staff and the owning customer. The language and currency switch links keep
  the key.
- **Sharing:** links are built from the request host. One small client
  component does Share (Web Share API) with a Copy fallback, used for pay
  links, referral links and temporary-password messages.
- **Referral:** `/[locale]/r/[code]` is a Route Handler. If the code belongs
  to an active rep, it sets `isupply_ref` (the code; httpOnly, 30 days) and
  redirects to `/[locale]`; otherwise it only redirects. Sign-up reads the
  cookie: an active rep → `rep_id`, `origin = 'referral'`, `origin_rep_id`,
  `rep_earns_commission = true`; then the cookie is cleared. The cookie is not
  signed: forging it can only assign yourself to a rep, which is what the
  link does anyway.

## B7. Money and calendar

- **One SQL definition of rep money** in `db/repMoney.ts`, used by every rep
  money query:

  ```
  sales_rial      = ROUND(total_cents::numeric * fx_rate_to_rial / 100)::bigint
  commission_rial = ROUND(total_cents::numeric * fx_rate_to_rial * commission_rate_bp / 1000000)::bigint
  ```

  Exact `numeric` in Postgres. JavaScript never computes the product: for a
  large order it exceeds 2^53. Every delivered order has a frozen rate (the
  existing invoice constraints guarantee it), so both are always defined.
  Estimates for orders not yet invoiced use the same shape, with `getFxRate()`
  passed in place of the frozen rate.
- **Persian calendar** in `lib/persianCalendar.ts` (pure; `Intl` with
  `calendar: "persian"`, `timeZone: "Asia/Tehran"` — Node 24's ICU supports it,
  checked: 2026-09-26 → Mehr 1405): `persianYearMonth(date)`,
  `formatPersianDate(date, locale)`, `persianMonthName(month, locale)`,
  `tehranToday()` and `tehranDatePlusDays(n)` for follow-ups.
- **Aggregation** in `lib/repStats.ts` (pure): takes the rep's delivered-order
  rows (`delivered_at`, customer, `sales_rial`, `commission_rial`), targets and
  payouts, and returns tiles, the monthly table, yearly rows, top 5 and owed.
  One query feeds it; month bucketing happens here because Postgres has no
  Persian calendar.
- **Admin overview:** all-time earned per rep by SQL `GROUP BY`; this month's
  sales from the last 40 days of deliveries, bucketed with
  `persianYearMonth`.
- **Display:** `formatRial(rial, locale)` in `lib/money.ts` — whole rial,
  Persian digits in `fa`.

## B8. Routes

New:

| Route | Who |
| --- | --- |
| `/[locale]/rep/signin` | public |
| `/[locale]/rep/password` | rep (session) |
| `/[locale]/rep` (home) | rep |
| `/[locale]/rep/customers`, `/new`, `/[id]` | rep |
| `/[locale]/rep/orders`, `/[ref]` | rep |
| `/[locale]/rep/commission` | rep |
| `/[locale]/r/[code]` | public Route Handler |
| `/[locale]/pay/[token]` | public, token-gated |
| `/[locale]/account/password` | customer |
| `/[locale]/admin/(panel)/reps`, `/reps/[id]` | staff |
| `/[locale]/admin/(panel)/customers`, `/customers/[id]` | staff |

Changed: `/account/signin`, `/account/signup`, `/account`,
`/account/orders/[ref]`, `/cart`, `/quote`, `/invoice/[ref]`, admin order
queue, admin settings, admin tabs.

## B9. Caching and performance

- No catalog page reads a new cookie, and the masthead is unchanged, so every
  prerendered page stays cached. All new pages are dynamic.
- No action in this feature calls `revalidatePath`: nothing cached renders
  reps, customers, notes, pay pages or bank details.
- Rep home: one read of that rep's delivered orders (a few dozen bytes per
  row) plus four small queries. Measured on the demo data before hand-off.
  Revisit if a single rep passes ~20,000 delivered orders.
- Admin customers list: 50 per page; search is `ILIKE` over a few thousand
  rows — no new index at this size.

## B10. Language

Every string in both dictionaries. Persian terms: نماینده فروش (sales rep),
کد مشتری (customer ID), پورسانت (commission), لینک پرداخت (pay link), لینک
معرفی (referral link), پیگیری (follow-up), یادداشت (note), هدف فروش ماهانه
(monthly target), پرداخت پورسانت (payout), اطلاعات حساب بانکی (bank details).
Customer IDs and usernames render in Latin digits, isolated from the
surrounding text like part numbers; money and counts use Persian digits in
`fa`.

## B11. Testing

- **Unit (`npm test`):** rep password policy; rep session token (sign,
  verify, tamper, expiry, version, and a customer token failing as a rep
  token); customer codes; temporary passwords; Persian calendar (2026-03-21 →
  1 Farvardin 1405; 2026-09-23 → 1 Mehr 1405; month change at Tehran
  midnight); rep stats (tiles, table, top 5, average, owed, a target standing
  until changed, a year boundary Esfand → Farvardin).
- **Integration (`npm run test:db`, new
  `src/db/salesReps.integration.test.ts`, rolled back):** stamping (rep, rate
  and eligibility locked at placement; later reassignment or rate change
  leaves old orders alone; an inactive rep is not stamped); the money SQL
  against known values, including an order whose intermediate product passes
  2^53; rep scoping (rep B reads and updates nothing of rep A's); customer
  code allocation and collision; pay tokens unique and backfilled;
  deactivation moves customers atomically; constraints refuse bad rows.
- **End to end (`npm run test:e2e`, one new spec):** admin creates a rep →
  rep signs in, is forced to change password, weak password refused →
  creates a customer → orders for them via quick order → pay link opened
  signed out says "being priced" → admin invoices with a payment link → pay
  link shows Pay and bank details → admin walks it to delivered → rep home
  shows the sale and the commission. Runs in the existing EN/FA
  desktop/mobile projects with a unique username per run.
- **By hand:** each phase clicked through in the browser against the local
  database, admin paths included via a local server started with the CI test
  admin password (the documented e2e recipe).

## B12. Local demo data

`npm run db:seed:reps` — refuses any non-local database, like the catalog
seed. Creates 2 reps and about 15 customers of all three origins, notes,
follow-ups due, about 60 orders across the last 14 Persian months in every
status (delivered ones properly invoiced, paid and shipped, with frozen rates
and numbers from `invoice_seq`), payouts and targets. The demo sign-in
details are written at the top of the script. Re-running it replaces its own
rows (identified by a username prefix) and touches nothing else.

## B13. Build phases

Each phase ends with something usable, and all gates green.

1. **Accounts:** the migration (the whole schema above), rep sign-in,
   sessions, password policy and forced change, admin Sales reps (create,
   edit, reset, deactivate with customer move), customer IDs (backfill,
   sign-up, sign-in by ID), customer forced change.
2. **Customers and CRM:** rep customer list, new, page, edit, reset; notes;
   follow-ups; admin Customers (assign and move, commission switch, notes,
   reset); referral link; customer ID and rep on the account page; address and
   city on the profile.
3. **Orders and pay link:** stamping, rep checkout, rep orders, pay page,
   invoice key, bank details setting and display, email optional when signed
   in, admin queue labels and Copy pay link, reorder.
4. **Money:** calendar and money helpers, rep home, commission page, payouts,
   targets, admin rep numbers, demo seed, documentation.

## B14. Documentation and gates

- `docs/ARCHITECTURE.md`: routes table; "three independent auth systems";
  new invariants — credit and rate locked at placement, one SQL money
  definition, pay tokens, rep scoping, rial-only rep money, Persian calendar
  bucketing in JavaScript.
- `docs/DEPLOYMENT.md`: the new migration runs on the live database before
  the code deploys; `db:verify:remote` checks it.
- `docs/LOCAL-DEV.md`: `db:seed:reps`.
- Gates before hand-off: `npm run lint`, `npx tsc --noEmit`, `npm test`,
  `npm run test:db`, `npm run build`, and the e2e suite via the local recipe.
