# Code review — `main` (live) and `feat/sales-reps`

Date: 2026-09-28. Reviewer: Claude (full read of the server-side code, the
schema, the migrations and the scripts; client components skimmed for logic).
A second, independent `/code-review` pass ran in parallel; its findings were
re-checked and merged here (H-10, H-11, M-19–M-22, L-21–L-24 and additions to
H-8, M-15, L-9 and L-10 come from it).
Branch state reviewed: `feat/sales-reps` **including the uncommitted working
tree** (78 changed/untracked files at review time). `main` has no commits that
the branch lacks, so everything on `main` was reviewed as part of the branch;
each finding says whether it is already live.

**Since 2026-09-29** all of that work is committed and `feat/sales-reps` is
merged (fast-forward) into the **local** `main`, which is **not pushed**. In
this document "LIVE" still means what is deployed from GitHub's `main`
(commit `0294705`), which is what visitors get until Amir says to push.

This document is written for the agents who will fix these issues. Amir owns
the product and does not write code — see `CLAUDE.md` for how to report back
to him when a fix is done.

---

## How to use this document

**Rules that apply to every fix** (from `CLAUDE.md` and `docs/ARCHITECTURE.md`):

1. One finding per commit, on the local `main`. **Never push**: pushing
   `main` deploys the live site. All six new migrations are on the live
   database (verified 2026-09-30), so the push is the only step left, and
   Amir says when.
2. Find the root cause first; the IDs below give the cause where it is known.
3. `npx tsc --noEmit` and `npm test` must be clean; `npm run build` too for
   anything touching a route segment. Add the test named in each finding.
4. Both locales (`src/lib/i18n.ts` types Persian as `typeof en`). RTL is real.
5. Schema changes are forward SQL files in `supabase/migrations/`, mirrored in
   `src/db/schema.ts`, `src/db/extensions.sql` (if drizzle cannot express it)
   and the lists in `scripts/verify-remote.mts`. **Never** run `drizzle-kit
   push` against a hosted database.
6. `npm run build` / `npm run start` / `npm run test:e2e` on this Mac load
   `.env.production.local` and talk to the **live** database unless you export
   the local `DATABASE_URL` first (recipe in the project memory / M-12 below).
7. Comments in this codebase explain *why* and the trap avoided. Several
   comments are now wrong (L-9); fix the comment in the same change as the code
   it describes.

**Status legend**

| Status | Meaning |
| --- | --- |
| CONFIRMED-LIVE | Reproduced against the production site or database (read-only) |
| CONFIRMED | Reproduced locally (Postgres, test, script) or proved from live data |
| CODE | Established by reading the code; the reasoning is given |
| PLAUSIBLE | Likely, with evidence, but the cause is not proven |

**Scope legend**: `LIVE` = on `main`, deployed now · `BRANCH` = only on
`feat/sales-reps` · `SELF-HOST` = only on the planned self-hosted (Iran)
deployment · `ALL` = everywhere.

**Severity**

- **Critical** — outsiders (or a single insider) can read customer data or
  move money/goods without authorisation, now or the moment the branch merges.
  Fix before anything else ships.
- **High** — serious money, security or availability defect under realistic
  conditions. Fix before real customers.
- **Medium** — real defect with a narrower trigger or impact. Fix before the
  production launch.
- **Low** — hardening, latent risk, hygiene, documentation drift.

---

## Summary

| ID | Sev | Title | Scope | Status |
| --- | --- | --- | --- | --- |
| C-1 | Critical | Every admin page is sent to anonymous visitors inside the login redirect | LIVE | **FIXED in `f205741` (local `main`, not pushed); the live site leaks until it is pushed** |
| C-2 | Critical | A sales rep alone can mark an order paid (own "receipt" + own confirmation), including a zero-price invoice | BRANCH | **FIXED 2026-09-29 in `1ba6cf5`** |
| C-3 | Critical | Pay tokens (a bearer credential) are rendered on admin pages; with C-1 anyone can change order state and read bank receipts | BRANCH | **FIXED 2026-09-29 in `588b56b`** |
| H-1 | High | Admin price changes do not reach customers for 94% of live products (stale seeded quantity-break prices win) | LIVE | **FIXED 2026-09-29 in `de10422`** |
| H-2 | High | Production is running out of database connections right now (342 × EMAXCONN, 140 × 60 s timeouts in 7 days) | LIVE | **Main driver FIXED 2026-09-29 in `73c70bd`; confirm on live after the push** |
| H-3 | High | Invoice numbers collide after invoice #9,999; the repair script then winds the sequence backwards | ALL | **FIXED 2026-09-29 in `334c981`** |
| H-4 | High | A rep can take over any assigned customer's account via "reset password" | BRANCH | **FIXED 2026-09-29 in `ad70ae3`** |
| H-5 | High | Self-hosted: every rate limit (incl. admin login) is bypassed by a spoofed forwarding header | SELF-HOST | **FIXED 2026-09-29 in `b526f48`** |
| H-6 | High | Self-hosted compose publishes Postgres to the network with password `isupply`; cron secret never reaches the app | SELF-HOST | **FIXED 2026-09-29 in `58a0aaf`** |
| H-7 | High | A fresh database prices the catalog at 1,100,000 rial/USD (~47% of market) with no warning | SELF-HOST / ALL | **FIXED 2026-09-29 in `a6b1c2d`** |
| H-8 | High | `DEMO_MODE` publishes pay tokens, receipts and the product table to the public | BRANCH | **FIXED 2026-09-29 in `965ce9e`** |
| H-9 | High | Admin "session" is a permanent, unrevocable password-derived bearer token without the `Secure` flag | LIVE | **FIXED 2026-09-29 in `74917ab`** |
| H-10 | High | Applying the sales-rep migration first (as the deploy doc says) breaks live sign-up until the new code is live — and again after a rollback | BRANCH → LIVE | **FIXED 2026-09-29 in `830d351`** |
| H-11 | High | Admin "Reset password" on an order resets whichever account owns the email typed on that order | LIVE | **FIXED 2026-09-29 in `63e738c`** |
| M-1 | Medium | Customer sign-in is rate-limited per IP only | LIVE | **FIXED 2026-09-29 in `d961dc6`** |
| M-2 | Medium | Customer sessions cannot be revoked; password change/reset leaves other sessions alive 30 days | LIVE | **FIXED 2026-09-29 in `f38e435`** |
| M-3 | Medium | `/api/cart` adds any product id, including hidden and non-existent ones | LIVE | **FIXED 2026-09-29 in `5c767ce`** |
| M-4 | Medium | Heavy public pages have no rate limit (`/search`, family `?view=all`) | LIVE | **FIXED 2026-09-29 in `0c04cec`** |
| M-5 | Medium | `/_next/image` is an open image proxy for any HTTPS host | LIVE | **FIXED 2026-09-29 in `bb65ed9`** |
| M-6 | Medium | No security headers (framing, CSP, nosniff, referrer); `x-powered-by` exposed | LIVE | **FIXED 2026-09-29 in `016cf44`** (CSP beyond framing not done) |
| M-7 | Medium | Per-click admin actions purge the whole site cache (the 2026-08-15 incident pattern) | LIVE | **FIXED 2026-09-29 in `d0b322a`** |
| M-8 | Medium | Stock updates lock product rows in arbitrary order → deadlocks under concurrency | ALL | **FIXED 2026-09-29 in `41e42b5`** |
| M-9 | Medium | 32-bit overflow on order and invoice totals → 500 errors (anonymous can trigger) | ALL | **FIXED 2026-09-29 in `8056c30`** |
| M-10 | Medium | Paid orders can be cancelled with no refund record; stock stays "sold" | ALL | **FIXED 2026-09-29 in `ecbb637`** |
| M-11 | Medium | No audit trail for money/state changes; rep payouts can be deleted outright | BRANCH | **FIXED 2026-09-29 in `bae3df3`** |
| M-12 | Medium | Local tooling defaults to the live database (e2e, build, start, drizzle) | LIVE (process) | **FIXED 2026-09-29 in `cab39c8`** |
| M-13 | Medium | Customer emails are never verified → an address can be squatted permanently | LIVE | **DEFERRED 2026-09-30 by Amir** — revisit before the next deploy (noted in DEPLOYMENT.md) |
| M-14 | Medium | Anyone can lock a rep out by failing sign-ins against their username | BRANCH | **FIXED 2026-09-29 in `9064654`** |
| M-15 | Medium | Lists silently truncate (admin queue 200, rep orders 300, rep customers 500) | ALL | **FIXED 2026-09-29 in `e527b83`** |
| M-16 | Medium | 4.25 MB request bodies accepted by every Server Action, including anonymous ones | LIVE | **FIXED 2026-09-30 in `e632a05`** |
| M-17 | Medium | Rep visibility over a moved customer's history is broader than needed | BRANCH | **FIXED 2026-09-30 in `5d6d476`** (recommended default; Amir to confirm) |
| M-18 | Medium | Reassignment/deactivation checks race; moved customers keep the old commission flag | BRANCH | **FIXED 2026-09-30 in `d1cdcc4`** |
| M-19 | Medium | Browser Back/Forward silently discards unsaved product-table edits | BRANCH | **FIXED 2026-09-30 in `0ee9f4a`** |
| M-20 | Medium | About 1 in 290 temporary passwords is mangled in the "share" message (`$$` → `$`) | BRANCH | **FIXED 2026-09-30 in `8276c3f`** |
| M-21 | Medium | Product-table JSON is unpaged; large families will exceed Vercel's 4.5 MB response cap | BRANCH | **FIXED 2026-09-30 in `fa76f4c`** |
| M-22 | Medium | An unrelated feature (admin product-table editor) is bundled into the sales-rep release | BRANCH (process) | **DECLINED by Amir 2026-09-29 — everything ships together on this branch** |
| L-1 … L-24 | Low | Hardening and hygiene (see section) | mixed | mixed |
| F-1 | High | One address can lock every admin out (from the H-5 fix) | BRANCH | **FIXED 2026-09-30 in `8c9e94b`** |
| F-2 | Medium | The M-16 body cap is skipped by a form posted without the `Next-Action` header, and on the admin sign-in page | BRANCH | **FIXED 2026-09-30 in `fcdf9d7`** (pay-link addresses stay open by design) |
| F-3 | Low | Receipt photos can lose their orientation when the server strips metadata (L-15) | BRANCH | **FIXED 2026-09-30 in `c643447`** |
| F-4 | Low | The sign-in "known device" mark never expires on the server and survives a password change (M-1/M-14) | BRANCH | **FIXED 2026-09-30 in `bbf1d93`** |

### Do first (in this order)

1. **C-1** — fixed in `f205741` (2026-09-29) on the local `main`. Amir chose
   to ship everything together, so the live leak remains until `main` is
   pushed; do not re-fix it.
2. **C-3 / H-8** — do not merge the branch until pay tokens stop appearing in
   any page an outsider can reach, and `DEMO_MODE` cannot expose receipts.
3. **C-2, H-4** — need a product decision from Amir (see each finding); the
   recommended defaults are given.
4. **H-1, H-2, H-3, H-11** — money, availability and account-safety defects
   already live.
5. **H-10** — must be fixed (migration made backward-compatible) before the
   sales-rep migration is applied to the live database.
6. Everything else before the self-hosted launch; H-5/H-6/H-7 are launch
   blockers for the Iran servers.

---

## Critical

### C-1 — Every admin page is sent to anonymous visitors inside the login redirect

> **Fix status (2026-09-29): FIXED in commit `f205741`, on the local `main`
> (not pushed).**
> `requireAdmin(locale)` added to `src/lib/admin.ts` and called first in all 11
> `admin/(panel)` pages; comments and `docs/ARCHITECTURE.md` corrected;
> `src/lib/adminGate.test.ts` (structural: every panel page gates before any
> other await) and `e2e/admin-gate.spec.ts` (runtime: no order refs, pay links,
> stock or foreign emails in anonymous responses) added — both proven to fail
> with the gate removed. Verified on a local production build: anonymous
> responses dropped from up to 455 KB (52 refs, 51 emails, 64 pay links) to the
> ~14 KB shell. Full e2e suite 36 passed / 10 device-skipped. **The live site
> still leaks until `main` is pushed and deployed.** Not done: fix step 2
> (data-access-layer checks) — `getInvoiceDraft` and others are shared with rep
> pages, so it needs its own change.

- **Scope**: LIVE (orders, settings, products, product-column, new-product and
  category-media pages). On the branch the same flaw also exposes the
  customers list and detail pages, the reps list and detail pages, and the
  admin draft-invoice page.
- **Status**: CONFIRMED-LIVE. An anonymous `GET https://www.temex.ir/fa/admin/orders`
  returns `307 → /fa/admin/login`, but the 71 KB response body contains the
  full rendered orders page: 6 order references, 7 distinct email addresses
  (several look like real people's), ~15 phone numbers, company names, order
  lines and prices, and the staff-only internal-notes section.
  `/en/admin/products` returned 133 KB including stock figures (219 rows of
  `inventoryAvailable`/`inventoryOnHold`/`inventorySold`) for hidden families;
  `/en/admin/settings` returned the settings page. A browser follows the
  redirect, so nothing looks wrong on screen.
- **Where**: `src/app/[locale]/admin/(panel)/layout.tsx:45-46` is the only
  gate. None of the pages under `(panel)/` checks the admin session itself
  (every `page.tsx` there has zero `isAdmin()`/`assertAdminWrite()` calls).
- **Root cause**: Next.js 16 renders route segments independently of the
  layout. Its own guide (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`,
  "Layouts and auth checks") says: *"A layout also does not control whether
  the rest of the route renders. Route segments … are rendered by the router,
  so a layout that hides or swaps them does not stop them from running or from
  appearing in the RSC Payload."* The layout's `redirect()` sets the status
  code; the page still runs its queries and streams its output into the same
  response. Client-side RSC navigations and prefetches have the same problem.
- **Failure scenario**: `curl -s https://www.temex.ir/fa/admin/orders | grep -o 'ORD-[A-Z0-9]\{6\}'`
  lists every open order; the same body carries each customer's contact
  details. Add `?status=delivered` / `?status=cancelled` to page through the
  rest. On the branch, `/fa/admin/customers` dumps the customer database
  (sign-in IDs, phones, emails, addresses) and `/fa/admin/reps` dumps rep
  usernames (half of each rep's credentials), phones and commission owed.
- **Fix**:
  1. Add a server-only `requireAdmin(locale)` in `src/lib/admin.ts` that
     returns when `DEMO_MODE || await isAdmin()` and otherwise calls
     `redirect(`/${locale}/admin/login`)`. Call it as the **first statement**
     of every `page.tsx` (and any `generateMetadata`) under
     `src/app/[locale]/admin/(panel)/`, before any query or `Promise.all`.
  2. Defence in depth, per the Next docs: put the check in the data-access
     layer too — the admin-only query functions (the inline `sql` in
     `orders/page.tsx`, `listCustomersAdmin`, `getCustomerAdmin`, `listReps`,
     `listRepTotals`, `getFamiliesGrouped`, `getInvoiceDraft`, …) should
     assert admin themselves or be reachable only through a guarded wrapper.
  3. Keep the layout check for UX, but stop relying on it.
  4. Same audit for the rep portal: every `rep/(portal)` page already calls
     `requireRep()` before its queries — keep it that way and add a lint-style
     test (below) so a new page cannot forget.
- **Test to add**: a Playwright or `node:test` check that, for every admin
  route (including `/admin/orders?status=delivered` and one
  `/admin/orders/<ref>/invoice`), an anonymous `fetch(url, { redirect: "manual" })`
  returns 307 **and** a body that contains no `ORD-` reference, no seeded
  customer email and no `inventoryAvailable`. Plus a static test that every
  `page.tsx` under `admin/(panel)` calls `requireAdmin(`.
- **After fixing**: tell Amir the live leak existed, for how long (the gate
  has been layout-only since the panel was built), and that the exposed data
  includes third-party email addresses — he decides whether anyone needs to be
  told.

### C-2 — A sales rep alone can mark an order paid, including a zero-price invoice

> **Fix status (2026-09-29): FIXED in `1ba6cf5` (local `main`, not pushed).**
> Amir's decision: reps may upload receipts, only the admin confirms payment;
> no invoice (rep or admin) while any line is priced 0. The rep confirm
> action and button are gone (reps see "the admin confirms"); `confirmPayment`
> takes no rep id, and `orders.paid_confirmed_by_rep_id` was removed from the
> not-yet-live migration `20260929120000_add_payment_proofs.sql` (and from the
> schema, verifier, integrity check and local database). `issueInvoice`
> returns `"unpriced"` when any line is ≤ 0 after the admin's prices apply;
> the admin price input and `parsePriceDollars` refuse 0; a rep sees "the
> admin prices it" instead of Create invoice. Tests:
> `salesReps.integration.test.ts` (zero line refused for rep and admin paths,
> price rollback; no rep code reaches `confirmPayment`) and
> `invoiceDraft.test.ts`.

- **Scope**: BRANCH. **Status**: CODE. Needs a product decision (below).
- **Where**:
  - `src/app/[locale]/rep/actions.ts:309` `uploadPaymentProofForRepAction` —
    any order the rep can see (`repCanSeeOrder`), any JPEG/PNG/WebP/PDF;
    the first file moves `invoiced → payment_review`.
  - `src/app/[locale]/rep/actions.ts:332` `confirmPaymentForRepAction` —
    `payment_review → preparing`, sets `paid_at`, converts held stock to sold
    (`confirmPayment`, `src/db/paymentProofQueries.ts:103`).
  - `src/app/[locale]/rep/actions.ts:282` `issueInvoiceForRepAction` — issues
    an invoice at the order's own prices with no check that any line is
    priced. 384 live products have `price_cents = 0` ("call for price",
    `isPriceOnRequest`), so a rep can issue an invoice totalling 0.
- **Failure scenario**: a rep (or a rep colluding with a customer) places an
  order, finalises the invoice (possibly at 0), uploads any photo as the
  "receipt", presses Confirm payment. The order is now `preparing` —
  "paid" as far as every screen is concerned — and the admin's next action is
  to ship it. The rep earns commission when it is delivered. The only record
  is `orders.paid_confirmed_by_rep_id`; nothing stops or flags it.
- **Decision for Amir** (recommended default first):
  1. *(Recommended)* A rep may upload receipts but may **not** confirm payment;
     confirmation is the admin's alone. Reps see "waiting for confirmation".
  2. Or: a rep may confirm only receipts **the customer** uploaded (never their
     own upload), and never an order whose invoice total is 0.
  3. Either way: refuse to issue any invoice (rep or admin) while a line is
     priced 0, unless the admin explicitly ticks "this line is free".
- **Fix**: implement the chosen rule in the action **and** in the SQL guard
  (`confirmPayment`'s `WHERE`), not only by hiding the button. Record who
  uploaded and who confirmed (see M-11).
- **Tests**: integration tests in `src/db/salesReps.integration.test.ts`:
  a rep cannot move an order to `preparing`; an invoice with a zero-priced
  line is refused.

### C-3 — Pay tokens are rendered on admin pages; with C-1 anyone can change order state and read bank receipts

> **Fix status (2026-09-29): FIXED in `588b56b` (local `main`, not pushed).**
> The admin queue no longer renders any token: "Show pay link" fetches one
> order's link through `payLinkForOrderAction` (behind `assertAdminWrite`, so
> never in `DEMO_MODE`), and "New pay link" replaces a leaked token
> (`replacePayLinkAction`). The admin draft invoice omits the link in
> `DEMO_MODE`. A pay link no longer opens receipts: `?key=` was removed from
> `/api/payment-proofs/[id]`, and the pay page lists receipts without links.
> Test: `e2e/sales-rep-flow.spec.ts` asserts the signed-in queue's HTML does
> not contain the order's token until "Show pay link" is pressed;
> `e2e/admin-gate.spec.ts` already asserts no pay link reaches a stranger.
> Not done: per-key rate limiting of the receipt route (moot now that keys
> do not open it).

- **Scope**: BRANCH. **Status**: CODE (the mechanism is C-1, which is
  CONFIRMED-LIVE; the pay-token markup is branch-only).
- **Why it matters**: a pay token (`orders.pay_token`) is a bearer credential.
  Holding one lets anyone open `/pay/<token>`, **upload receipts** (which moves
  an `invoiced` order to `payment_review`), and **read every receipt** through
  `/api/payment-proofs/<id>?key=<token>` — receipts carry customers' bank and
  card details.
- **Where tokens are rendered**:
  - `src/app/[locale]/admin/(panel)/orders/page.tsx:276-277` — a copy button
    whose `text` prop is `…/pay/${q.payToken}` for **every** order in the queue
    (props of a client component are serialised into the page payload).
  - `src/app/[locale]/admin/(panel)/orders/[ref]/invoice/page.tsx:141` —
    `proofUrl` with the token.
  - Both pages leak to anonymous visitors through C-1.
- **Failure scenario** (after merge, before C-1 is fixed): `curl` the admin
  orders page → harvest every pay token → POST garbage images to each pay
  link → every invoiced order flips to "Confirming payment", and every
  receipt already uploaded can be downloaded.
- **Fix**:
  1. Fix C-1 first.
  2. Stop sending full tokens to the admin queue by default: render the pay
     link only on explicit request (a Server Action that returns it after
     `assertAdminWrite()`), or at least never in `DEMO_MODE` (H-8).
  3. Narrow what a pay token grants: uploading, yes; **reading** receipts via
     `?key=` — reconsider. A customer rarely needs to re-download their own
     receipt from a shared link; admin, rep and the signed-in owner already
     have access. If kept, rate-limit `/api/payment-proofs/[id]` per key/IP.
  4. Make tokens revocable (a "regenerate pay link" admin action) — today the
     only way to kill a leaked link is a migration (ARCHITECTURE.md admits it).
- **Tests**: anonymous admin-page test from C-1 must also assert no 64-hex
  token appears in the body.

---

## High

### H-1 — Admin price changes do not reach customers for 94% of live products

> **Fix status (2026-09-29): FIXED in `de10422` (local `main`, not pushed).**
> `price_cents` is now the price everywhere: `src/lib/priceTiers.ts` ignores
> any stored rung at one unit and applies only breaks above it (highest
> `minQty ≤ qty`, any stored order — this also fixes L-20); the family page,
> product panel and card list display `price_cents`. `writeImport` (used by
> the CSV import, the product table and Add a product) clears `price_tiers`
> whenever a product's price changes and keeps them when it does not. No data
> migration: the review found tier[0] equal to `price_cents` on every live
> product, so nothing a customer sees changes until a price is edited.
> Tests: `src/lib/priceTiers.test.ts`; `partNumbers.integration.test.ts`
> "an import that changes a price changes what the customer is charged"
> (fails with the upsert change removed).

- **Scope**: LIVE. **Status**: CONFIRMED (code + live data).
- **Evidence**: on the live database, 33,427 of 35,717 products carry seeded
  `price_tiers` = `[{minQty: 1, priceCents: <price>}, {minQty: 10, …}]`
  (`src/seed/generate.ts:157`). Today `tier[0]` equals `price_cents` for all of
  them — only because nobody has edited a price yet.
- **Root cause**: `price_tiers` is written **only by the seeder**. The CSV
  import (`src/db/importQueries.ts:530`, the `ON CONFLICT … DO UPDATE SET`
  list), the admin product table (`saveFamilyProductsAction`) and "Add a
  product" all update `price_cents` and never touch `price_tiers`. But every
  customer-facing price reads the tiers first:
  - display: `src/app/[locale]/f/[slug]/page.tsx:542`,
    `src/components/ProductDetails.tsx:221`,
    `src/components/ProductCardList.tsx:167` (`priceTiers[0]?.priceCents ?? priceCents`);
  - cart, checkout and the order's requested price: `unitPriceAt`
    (`src/lib/cart.ts:257`), which returns the tier price for any qty ≥ 1.
- **Failure scenario**: the admin raises a product from $1.00 to $2.00 in the
  product table. The admin table shows $2.00; the storefront, the cart, the
  checkout total and the order lines still say $1.00, and a rep invoice
  (issued "at the order's own prices", C-2) bills $1.00. Bulk tiers keep the
  old bulk price forever.
- **Fix** (pick one, the first is simplest):
  1. Clear `price_tiers` whenever an import or table save writes a product
     (`price_tiers = '[]'` in the upsert), and write a forward migration that
     sets `price_tiers = '[]'` where `price_tiers->0->>'priceCents'` equals
     `price_cents` and there is no real bulk pricing; or
  2. Make tiers a first-class editable column in the CSV/table and validate
     them (sorted, strictly increasing `minQty`, tier[0].minQty = 1 equals
     `price_cents`).
  Also make `unitPriceAt` pick the tier with the highest `minQty ≤ qty`
  regardless of array order (L-20), and make display use `price_cents` as the
  base price.
- **Tests**: unit test that an import changing `price_cents` changes what
  `unitPriceAt` returns; integration test through `writeImport`.

### H-2 — Production is running out of database connections right now

> **Fix status (2026-09-29): main driver FIXED in `73c70bd` (local `main`,
> not pushed); effect on live to be measured after the push.**
> Cause found: default `<Link>` prefetching. Next 16 prefetches a static
> (ISR) route in full and a dynamic one down to its layout the moment the link
> is on screen. The home page's 26 top-level category titles, the header,
> mobile header, footer, cart link and language switch all prefetched, so a
> home-page view rendered every stale category page in the same second (the
> exact burst shape in the error log: all `/fa/c/<top-level>` pages failing
> together, latest 2026-09-29 12:15:46 UTC) and every page view ran four
> extra functions (`/cart`, `/track`, `/quick-order`, `/account`, each with
> the header's settings query). Live evidence: in the last hour of logs those
> four paths had identical counts (16 each). Measured on a local production
> build with Playwright: loading `/fa` fired **15** prefetch renders before,
> **0** after; a category page **9 → 0**. All those links are now
> `prefetch={false}`; `src/lib/prefetch.test.ts` fails if one reverts.
> Errors in the 48 h before the fix: EMAXCONN ×195, 60 s timeouts ×39,
> ECHECKOUTTIMEOUT ×6. Not changed: the pool size (6 per instance) — with the
> bursts gone it should not be reached, and shrinking it re-risks the
> 2026-08-15 starvation; revisit only if EMAXCONN persists after the push.
> Not done: a bigger Supabase pooler (costs money — Amir's call) and
> `attachDatabasePool` (needs a new dependency; not needed unless errors
> persist). Vercel's runtime logs on this plan reach back only about an hour
> (`ExceedsBillingLimitError` for older windows), so per-minute burst
> analysis of past windows was not possible.

- **Scope**: LIVE. **Status**: symptoms CONFIRMED-LIVE (Vercel runtime errors,
  last 7 days); root cause PLAUSIBLE.
- **Evidence** (Vercel project `prj_Xozrthrf8PUYTvD5tHK2DWkhbIzk`,
  `get_runtime_errors` for 7 days, latest on the current deployment
  `dpl_5MxMGUXFBRTiKXY86Snvne2Ad6mf`):
  - `(EMAXCONN) max client connections reached, limit: 200` — **342**
    occurrences, routes `/[locale]/cart`, `/c/…`, `/f/…`, `/track`; last seen
    2026-09-28 23:02 UTC.
  - `Task timed out after 60 seconds` — **140**, 11 users, including `/en`,
    `/fa`, `/account`, `/track`.
  - `(ECHECKOUTTIMEOUT) unable to check out connection from the pool after
    60000ms in Transaction mode` — 68.
  - Bursts where ~26 category pages fail in the same second
    (2026-09-25 11:04, 2026-09-27 09:14) — the shape of a mass ISR
    regeneration (after a deploy or a whole-site purge, M-7).
  - The live database has `max_connections = 60`; the pooler caps clients at
    200.
- **Probable cause**: each Fluid instance keeps up to 6 pooled connections
  (`src/db/index.ts:132`, raised from 2 after the 2026-08-15 incident) for 20 s
  idle and up to 300 s lifetime. Under a crawl or regeneration burst Vercel
  runs many instances, and 34 instances × 6 already exhaust 200 client slots.
  The 2026-08-15 fix traded pool starvation for pooler exhaustion.
- **Fix direction** (measure first; do not guess):
  1. Pull per-minute instance counts and request paths for the burst windows
     (`get_runtime_logs` grouped by `requestPath`) to confirm who drives them
     (crawler, deploy warm-up, admin purge).
  2. Size the pool to the budget: e.g. `max: 2–3` per instance with a short
     `idle_timeout`, and use `attachDatabasePool` from `@vercel/functions` so
     idle connections close before an instance suspends (check the installed
     docs before using it).
  3. Remove per-click whole-site purges (M-7) and stagger ISR (`revalidate`
     jitter or on-demand tags) so all category pages do not expire together.
  4. Consider a larger pooler tier; and add `export const maxDuration` is
     already 60 s — keep it.
- **Report back**: measured before/after error counts.

### H-3 — Invoice numbers collide after invoice #9,999; the repair script winds the sequence backwards

> **Fix status (2026-09-29): FIXED in `334c981` (local `main`, not pushed).**
> Amir's decision: keep one running sequence; just stop the truncation.
> `issueInvoice` (and the demo seeder) pad to *at least* four digits
> (`lpad(n, greatest(4, length(n)), '0')`), so #10,000 is `INV-YYYY-10000`.
> `db:extensions` now calls `realignInvoiceSequence` (`src/db/invoiceSequence.ts`),
> which takes the greater of the sequence's own position and the numeric
> maximum of well-formed numbers, so it can only move forward and no longer
> throws on an odd number. Test: `orderIntegrity.integration.test.ts` issues
> invoices 9,999 / 10,000 / 10,001 and proves the realignment does not wind
> back (including from a recreated sequence). L-5 later changed the year to
> the Persian one; the count is unaffected.

- **Scope**: ALL (live: `src/app/[locale]/admin/actions.ts:349` on `main`;
  branch: `src/db/invoiceQueries.ts:73-74`). **Status**: CONFIRMED on local
  Postgres: `SELECT lpad('10000',4,'0')` → `1000`, `lpad('12345',4,'0')` →
  `1234`.
- **Root cause**: `'INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 4, '0')`.
  PostgreSQL's `lpad` **truncates** strings longer than the width. The
  sequence is global (never resets per year), so from the 10,000th invoice
  ever issued, ten sequence values map to each 4-digit string. The unique
  index `orders_invoice_number_key` refuses duplicates, so ~90% of attempts
  fail with an unhandled 500, each burning a sequence value.
- **Second defect**: `scripts/apply-extensions.mts:28-33` realigns the
  sequence to `max(split_part(invoice_number,'-',3)::int)` — after truncation
  that maximum is at most 9,999, so running `db:extensions` would set the
  sequence **backwards** and cause more collisions. It also throws if any
  invoice number is not three dash-separated parts.
- **Fix**: format with no truncation (`lpad(n::text, greatest(4, length(n::text)), '0')`
  or `to_char(n, 'FM0000')`), and realign from the sequence's own
  `last_value` / the numeric maximum of all issued numbers. Decide with Amir
  whether numbering should restart per Persian fiscal year (see L-5); if so,
  that is a per-year counter table, not one global sequence.
- **Tests**: integration test that issues an invoice with the sequence set to
  9,999 and 10,000 and gets distinct numbers.

### H-4 — A rep can take over any assigned customer's account

> **Fix status (2026-09-29): FIXED in `ad70ae3` (local `main`, not pushed).**
> Amir's decision: reps may reset only customers they created themselves who
> have never set their own password. New column `users.chose_own_password`
> (default true, so every existing account counts as self-chosen; false only
> for rep-created accounts; set true by any password the customer is not
> forced to replace) added to the not-yet-live migration
> `20260927120000_add_sales_reps.sql`, the schema and the verifier. The rule
> is in `resetCustomerPasswordForRep`'s WHERE (`origin = 'rep' AND
> origin_rep_id = rep AND NOT chose_own_password`); the rep page shows "only
> the admin can reset" otherwise. Tests: `salesReps.integration.test.ts`
> (own-before-choosing allowed; after choosing, self sign-up, and a
> customer created by another rep all refused, hashes unchanged) and
> `repAccount.test.ts`. The session-version bump the fix mentions is M-2.

- **Scope**: BRANCH. **Status**: CODE. Needs a product decision.
- **Where**: `src/app/[locale]/rep/actions.ts:200` →
  `resetCustomerPasswordForRep` (`src/db/customerQueries.ts:157`). Works on
  **any** customer whose `rep_id` is the rep — including customers who signed
  up themselves or through a referral and chose their own password.
- **Failure scenario**: the rep presses "reset password", is shown the new
  temporary password (`setShownOnce`), signs in as the customer, and is forced
  to choose a new password — which the rep now owns. The real customer is
  locked out with no recovery path (no email, M-13). Their existing session
  keeps working for up to 30 days (M-2), so they may not notice. Nothing tells
  the customer or the admin. The admin can also reassign a customer to a rep,
  handing that rep this power over an account they never created.
- **Decision for Amir** (recommended first):
  1. *(Recommended)* Reps may reset only accounts they created themselves
     (`origin = 'rep' AND origin_rep_id = rep`) **and** only while the
     customer has never set their own password; everyone else goes through the
     admin.
  2. Or keep it, but log every reset (M-11) and show the customer
     "Your password was reset by <rep> on <date>" on next sign-in.
- **Fix**: enforce in the `UPDATE … WHERE` clause; add a customer
  `session_version` (M-2) and bump it on every reset.
- **Tests**: integration test that a rep cannot reset a self-sign-up
  customer's password.

### H-5 — Self-hosted: every rate limit (including admin login) is bypassed by a spoofed header

> **Fix status (2026-09-29): FIXED in `b526f48` (local `main`, not pushed).**
> `clientAddress` reads exactly one header (`trustedAddressHeader`):
> `TRUSTED_PROXY_HEADER` when set, `x-vercel-forwarded-for` on Vercel,
> `x-forwarded-for` in development — and a production server with none of
> these throws instead of guessing. `docker-compose.yml` now ships an nginx
> `proxy` service (`deploy/nginx.conf`) that overwrites `X-Real-IP` and
> `X-Forwarded-For` and blanks `X-Vercel-Forwarded-For`; the app is no longer
> published directly and runs with `TRUSTED_PROXY_HEADER=x-real-ip`. Admin
> sign-in also consumes a site-wide ceiling (60 attempts / 15 min, logged when
> tripped). Playwright and CI set `TRUSTED_PROXY_HEADER=x-forwarded-for` for
> their local `next start`. Tests: `rateLimit.test.ts`. Not verified: the
> nginx config was not run (no self-hosted stack here); TLS is still to be
> added on that server.

- **Scope**: SELF-HOST. **Status**: CODE (plus Next.js source).
- **Where**: `src/lib/rateLimit.ts:43-49` trusts, in order,
  `x-vercel-forwarded-for`, `x-forwarded-for`, `x-real-ip` from the request.
  On Vercel the platform overwrites these. On a self-hosted Next server the
  client sets them: Next only fills `x-forwarded-for` **when it is absent**
  (`node_modules/next/dist/server/base-server.js:612`, `??=`), and nothing
  strips `x-vercel-forwarded-for`. `docker-compose.yml` exposes the app on
  `3000:3000` with no reverse proxy.
- **Failure scenario**: an attacker sends `X-Vercel-Forwarded-For: <random IP>`
  on every request. The admin sign-in limit (8 per 15 min, IP-only — there is
  no account to key on) never triggers, so the single shared admin password
  can be guessed at full speed. Every other limit (sign-up, checkout, tracking,
  proof uploads) is equally void.
- **Fix**: take the client address from a configured trust source — e.g.
  `TRUSTED_PROXY_HEADER` env (`x-vercel-forwarded-for` on Vercel,
  `x-real-ip` set by the self-hosted nginx) and ignore all others; refuse to
  start in production on self-host without it. Ship the reverse proxy in
  `docker-compose.yml`. Add a global (non-IP) ceiling on admin login failures
  with alerting, since the admin password is shared.
- **Tests**: unit tests for `clientAddress` with each configuration.

### H-6 — Self-hosted compose publishes Postgres with password `isupply`; the cron secret never reaches the app

> **Fix status (2026-09-29): FIXED in `58a0aaf` (local `main`, not pushed).**
> Postgres is published on `127.0.0.1` only; its password comes from
> `POSTGRES_PASSWORD` (default kept for the laptop) and the app's URL follows
> it. The app now receives `CRON_SECRET`, `SELLER_ADDRESS[_FA]`,
> `SELLER_TAX_ID` and `SUPABASE_PAYMENT_PROOF_BUCKET`. A `scheduler` service
> (busybox crond) calls `/api/cron/fx-rate` at 17:30 UTC — the option
> `DEPLOYMENT.md` already preferred. `docker compose config` renders; the
> stack itself was not started here. `ADMIN_PASSWORD` still defaults to
> `changeme`, which production refuses (fails closed) — the compose comment
> says to set it. Not done: a compose *secret* for the DB password (the app
> reads `DATABASE_URL` from the environment, so the password must be in it).

- **Scope**: SELF-HOST (compose is the documented path for the Iran servers).
  **Status**: CODE.
- **Where**: `docker-compose.yml:7-14` (`POSTGRES_PASSWORD: isupply`,
  `ports: "5433:5432"` = all interfaces), `:38-49` (app environment).
- **Problems**:
  1. On a server with a public IP, Postgres is reachable from the internet
     with a password printed in the repository.
  2. The `app` environment has no `CRON_SECRET`, no `SELLER_*`, no
     `SUPABASE_PAYMENT_PROOF_BUCKET`, no `DIRECT_DATABASE_URL`, so the evening
     rate job is refused (H-7) and invoices print no seller address.
  3. `ADMIN_PASSWORD` defaults to `changeme`, which production refuses — good
     (fails closed), but it means the documented stack does not work without
     an extra step nobody wrote down.
- **Fix**: bind the database port to `127.0.0.1` or remove it (the app reaches
  `db:5432` inside the compose network); read the DB password from a compose
  secret; pass every variable in `docs/DEPLOYMENT.md`'s table; add the
  scheduler service the deployment doc already recommends.

### H-7 — A fresh database prices the catalog at 1,100,000 rial/USD with no warning

> **Fix status (2026-09-29): FIXED in `a6b1c2d` (local `main`, not pushed).**
> `isStale(null)` is now true, and the rate panel says "no market reading yet,
> prices use the fallback of N rial". `fxRateSource` names where the rate came
> from; when it is the 1,100,000 placeholder (no reading, no manual rate, no
> `USD_TO_RIAL`), Settings shows a red banner and **both admin and rep invoice
> issuance refuse** ("no exchange rate set"), because an invoice locks its
> rate for good. The compose default `USD_TO_RIAL=1100000` is removed so the
> Iran launch starts in that guarded state. Deviation: storefront display and
> checkout are not blocked — an order stores dollars, and the rate is locked
> only at invoicing, which is now guarded. Tests: `fxMarket.test.ts`,
> `fxRate.test.ts`.

- **Scope**: SELF-HOST (the Iran launch starts from a fresh database); ALL in
  principle. **Status**: CODE.
- **Root cause chain**:
  - no `fx_mode` row → mode defaults to `auto` (`src/lib/fx.ts:44`);
  - no accepted market reading yet → `resolveFxRate` falls back to
    `USD_TO_RIAL`, else `DEFAULT_FX_RATE = 1_100_000` (`src/lib/fxRate.ts:23`),
    also the compose default (`docker-compose.yml:41`). The live market rate is
    2,505,000 (live `fx_market_rate`), so the fallback is ~47% of market;
  - the first reading needs **both** exchanges to answer and agree
    (`combinePrices`, `needs-both`) — the deployment doc says neither had been
    proven reachable from the hosting servers, and on self-host the cron is
    never authorised (H-6);
  - `isStale(null)` returns `false` (`src/lib/fxMarket.ts:269-270`), so the
    admin panel shows no staleness warning when there has never been a
    reading.
- **Failure scenario**: launch day on the Iran servers — every rial price is
  less than half what it should be, invoices lock that rate in, and nothing on
  the admin screen says anything is wrong.
- **Fix**: refuse to price in `auto` mode without a market reading (fall back
  to `manual` with a mandatory admin-entered rate, or block checkout with a
  clear admin warning); treat "never read" as stale in `isStale`; remove the
  1,100,000 constant or make it fail loudly in production.
- **Tests**: `fxRate` / `fxMarket` unit tests for the never-read state.

### H-8 — `DEMO_MODE` publishes pay tokens, receipts and the product table

> **Fix status (2026-09-29): FIXED in `965ce9e` (local `main`, not pushed).**
> Under `DEMO_MODE` the issued invoice and the admin draft render no pay link
> (the queue renders none at all since C-3); `receivePaymentProof` and the
> pay-link upload action refuse every receipt and the pay page offers no
> upload; the receipt route serves nothing (no `?key=` since C-3, and
> `isAdmin()` is false for a demo visitor); the product-table JSON is gated
> like the CSV export. Test: `e2e/demo-mode.spec.ts` (runs when the server is
> started with `DEMO_MODE=1` and `E2E_DEMO_MODE=1` is set) — passed against a
> local demo-mode production server. Not done: a separate demo database.

- **Scope**: BRANCH (`DEMO_MODE` is off on the live site today — the admin
  pages redirect — but the flag exists for the hosted demo).
  **Status**: CODE.
- **Where**:
  - `src/app/[locale]/invoice/[ref]/page.tsx:82` treats every visitor as staff
    in demo mode and renders `proofUrl` with the pay token (`:172-176`);
  - admin orders page and draft invoice page render tokens (C-3) and are
    public in demo mode by design;
  - `src/app/api/payment-proofs/[id]/route.ts:17-18` claims receipts are
    "deliberately not open under DEMO_MODE", but any demo visitor can read a
    token off those pages and pass it as `?key=`;
  - `src/app/api/admin/family/[id]/products/route.ts:24` returns every
    product row (prices, stock, hidden families) to anonymous demo visitors —
    contradicting the template/export routes' stated "stricter" policy;
  - `uploadPaymentProofWithKeyAction` (`src/app/[locale]/pay/[token]/actions.ts:15`)
    has no `DEMO_MODE` check, so on a demo that `assertAdminWrite` promises is
    read-only, any visitor holding a harvested token can store files and move
    invoiced orders to `payment_review`.
- **Fix**: in `DEMO_MODE`, never render pay tokens, disable receipt upload and
  download entirely, and gate the product JSON like the export. Better: make
  the demo run against a separate demo database so the flag cannot coexist
  with real receipts.

### H-9 — Admin session is a permanent, unrevocable, password-derived bearer token without `Secure`

> **Fix status (2026-09-29): FIXED in `74917ab` (local `main`, not pushed).**
> The admin cookie is now `a1.<version>.<expiry>.<sig>` (`src/lib/adminSessionToken.ts`),
> signed with a key derived from `AUTH_SECRET` and a hash of `ADMIN_PASSWORD`:
> expiry (8 h) is checked on the server; changing the password invalidates
> every cookie; `app_settings.admin_session_version` is checked on each request
> and bumped by the new Settings → "Sign out everywhere"; `secure` is set in
> production; passwords are compared as equal-length hashes (no length
> timing). Every admin is signed out once when this deploys (old cookie
> format). Tests: `adminSessionToken.test.ts`. "Sign out everywhere" was
> proven end to end once with a Playwright spec (two signed-in browsers; the
> second lands on sign-in afterwards), then removed from the suite: run in
> parallel it signs out the other admin tests, and its extra sign-ins push the
> suite past the 8-per-15-minutes admin limit.
> Not done: named staff accounts (known gap).

- **Scope**: LIVE. **Status**: CODE.
- **Where**: `src/lib/admin.ts:42-44, 60-70`.
- **Problems**:
  1. The cookie value is `HMAC-SHA256(ADMIN_PASSWORD, "isupply-admin-v1")` —
     identical for every admin, forever. The server never checks age; `maxAge`
     only tells the browser when to forget it. A copied cookie works until the
     password changes. Sign-out deletes the local copy only.
  2. The value is a fast hash of the password with a known message: a leaked
     cookie lets anyone brute-force the admin password offline.
  3. No `Secure` attribute (the customer and rep cookies have it). A request
     over plain `http://` — a fresh browser before HSTS is cached, or any
     self-hosted setup without forced TLS — sends the admin cookie in clear.
  4. `signInAdmin` returns early on length mismatch, leaking the password
     length by timing.
- **Fix**: sign `admin.<issuedAt>.<expiry>` with a key derived from
  `AUTH_SECRET` (same pattern as the rep cookie), check expiry server-side,
  include an admin session version stored in `app_settings` so "sign out
  everywhere" / password change revokes all, set `secure` in production, and
  compare HMACs of both passwords. Longer term: named staff accounts (known
  gap in ARCHITECTURE.md).

### H-10 — The sales-rep migration breaks live sign-up if applied before the new code (as the deploy doc instructs)

> **Fix status (2026-09-29): FIXED in `830d351` (local `main`, not pushed).**
> `20260927120000_add_sales_reps.sql` edited in place (not yet on live): a
> `BEFORE INSERT` trigger `users_customer_code_default` assigns the phone's
> last seven digits (or a free random code) whenever an insert names no code,
> mirroring the backfill loop; the new code always supplies one. Every other
> new `NOT NULL` column has a default (checked: `users` origin,
> rep_earns_commission, must_change_password, chose_own_password, address,
> city; `orders` placed_by_rep, pay_token); the new checks accept the old
> writes. Local database updated; `db:verify` checks the trigger.
> `DEPLOYMENT.md` gains the "accept the previous release's writes" rule.
> Test: `salesReps.integration.test.ts` runs live `main`'s user and order
> insert shapes against the migrated schema. Residual: two old-code sign-ups
> with the same phone digits at the same instant can collide on the code's
> unique index, which old code reports as "email taken"; retrying works.

- **Scope**: BRANCH migration, damage on LIVE. **Status**: CONFIRMED (code on
  both branches).
- **Where**: `supabase/migrations/20260927120000_add_sales_reps.sql:83`
  (`ALTER TABLE users ALTER COLUMN customer_code SET NOT NULL`, no default).
  `main`'s `createUser` (`src/db/userQueries.ts:73` on `main`) inserts
  `(email, password_hash, company, contact_name, phone, locale)` only.
- **Failure scenario**: `docs/DEPLOYMENT.md` says to apply the migration
  **before** pushing the code. From that moment until the new deployment is
  live, every sign-up on the live site fails with `23502 not_null_violation`
  (only `23505` is caught, so it is a 500). If the Vercel build fails, the
  window is indefinite; an instant rollback to a pre-rep deployment re-opens
  it.
- **Fix**: make the migration expand-only: give `customer_code` a column
  default (or a `BEFORE INSERT` trigger) that assigns a free seven-digit code
  when none is supplied, so old and new code both insert successfully; keep
  the application's phone-derived choice in the new code. Check every other
  new `NOT NULL` column the same way (the others have defaults today). Add a
  "compatible with the previous release" check to the migration review list
  in `docs/DEPLOYMENT.md`.
- **Test**: in CI, run `main`'s `createUser` insert shape against the migrated
  schema.

### H-11 — Admin "Reset password" on an order resets whoever owns the email typed on that order

> **Fix status (2026-09-29): FIXED in `63e738c` (local `main`, not pushed).**
> The order queue's email-keyed "Reset password" (`resetCustomerPasswordAction`,
> `findUserIdByEmail`, `emailsWithAccounts`) is removed. An order placed from
> an account now shows that account's customer ID, linked by the order's own
> `user_id` to the admin customer page, which already resets by id. Guest
> orders show no account. The false L-9 comment about the reset cookie went
> with the code. Test: `src/lib/adminReset.test.ts`. Not done: an audit
> record of resets (M-11).

- **Scope**: LIVE (the branch also touched this function to set
  `must_change_password`). **Status**: CODE.
- **Where**: `src/app/[locale]/admin/actions.ts:342-372`
  (`resetCustomerPasswordAction` → `findUserIdByEmail(email)`); the button is
  shown on any queue row whose typed email matches an account
  (`emailsWithAccounts`, `admin/(panel)/orders/page.tsx`).
- **Failure scenario**: an attacker places a guest order typing a real
  customer's email (never verified, M-13), then phones the shop: "I forgot my
  password — order ORD-XXXXXX." The queue shows "Reset password" on that
  order, so the admin presses it and reads the temporary password aloud. The
  attacker signs in as the victim and sets their own password. The victim is
  locked out; their order history, addresses and pay links are exposed.
- **Fix**: remove the email-based reset from the order queue. Reset only by
  the order's own `user_id` (and only when the order has one), or only from
  the customer's admin page after an identity check the admin performs
  deliberately (e.g. calling back the phone number stored on the account, not
  the one typed on the order). Log every reset (M-11).

---

## Medium

### M-1 — Customer sign-in is rate-limited per IP only

> **Fix status (2026-09-29): FIXED in `d961dc6`.** Failed sign-ins now also
> count against the account, keyed on the normalised login string (so an
> unknown login costs the same): 10 failures / 15 min from any addresses
> locks further attempts (`src/lib/signInGuard.ts`). To avoid the M-14
> lock-out problem, only failures count and a browser that has signed in to
> that account before (a signed "known device" cookie) is let through. The
> per-address limit is unchanged. Test: `rateLimit.integration.test.ts`.
> Not done: exponential backoff (the fixed window plus known-device bypass
> was judged enough).

`src/app/[locale]/account/actions.ts:116` consumes only the IP counter;
`accountId` is never passed even though the login identifier is known after
`parseLogin`. Customer sign-in IDs are seven digits derived from the phone
number, and the password rule is "8 characters, anything". A distributed
guesser gets 10 tries per IP per 15 minutes against every account without
limit. **Fix**: also consume an account-scoped counter (key on the normalised
login string, not the user id, so unknown logins cost the same), add an
exponential backoff per account. Scope LIVE, status CODE.

### M-2 — Customer sessions cannot be revoked

> **Fix status (2026-09-29): FIXED in `f38e435`.** New `users.session_version`
> (default 1; added to the not-yet-live `add_sales_reps` migration, the schema
> and the verifier) is carried in the customer cookie and re-read by
> `currentUserId()` each request. `setPassword`, the rep reset and the admin
> reset all bump it, ending every other session; the customer's own change
> reissues their current cookie. Cookies issued before this read as version 1,
> so nobody is signed out by the deploy. Tests: `sessionToken.test.ts`,
> `salesReps.integration.test.ts`. Cost: one indexed read per request that
> checks a customer session.

`src/lib/sessionToken.ts` signs only `userId.expiry` (30 days). Password
change (`changePasswordAction`), admin reset and rep reset (H-4) leave every
other session valid. Documented as a known gap, but reps resetting passwords
make it exploitable. **Fix**: add `users.session_version` (forward migration),
embed it in the token, re-read it in `currentUser()` exactly as `currentRep()`
does, bump it on every password change/reset. Scope LIVE, status CODE.

### M-3 — `/api/cart` adds any product id, including hidden and non-existent ones

> **Fix status (2026-09-29): FIXED in `5c767ce`.** `addLine` inserts only
> through a join on the visible catalog (`FAMILY_VISIBLE`) and returns null
> otherwise; `/api/cart` answers 404 for hidden and non-existent ids alike.
> The cart page and checkout read only visible lines, so a product hidden
> after it was added drops out. Test: `salesReps.integration.test.ts`
> (checkout with a hidden line orders only the visible one); the 404 was
> checked by hand on a local build (hidden family → 404, visible → 200).

`src/app/api/cart/route.ts:57-69` → `addLine` (`src/lib/cart.ts:121`) checks
neither existence nor visibility. Product ids are sequential. There are 22
hidden families live. **Failure**: add hidden product ids to a cart to read
their part numbers, specs and prices on the cart page, and order them; a
non-existent id raises a foreign-key error (500 + log noise). Quick order and
rep reorder already refuse hidden products — the cart must too. **Fix**: insert
through `SELECT … FROM products p JOIN product_families f … WHERE p.id = $1 AND
<FAMILY_VISIBLE>` and return 404 when nothing matches; drop hidden lines at
checkout. Scope LIVE, status CODE.

### M-4 — Heavy public pages have no rate limit

> **Fix status (2026-09-29): FIXED in `0c04cec`.** `/search` consumes a
> per-address limit (60 queries/min; an empty query costs nothing) and shows
> "too many searches" instead of running the query when over. Family
> `?view=all` is capped at 1,000 rows (`FAMILY_VIEW_ALL_MAX`; the footer then
> reads "showing 1,000 of N") and limited to 20 per address per 10 minutes,
> after which the request gets the ordinary first 100 rows. Test:
> `familyWindow.test.ts`. Not done: a short-lived cache of search results
> (the limit was judged enough) and a CSV download past 1,000 rows.

`/[locale]/search` runs `search()` (`src/db/queries.ts:457`) — a relevance
function over every family and category plus three full-text/trigram passes
over 35,717 products — with no limit (only `/api/suggest` is limited).
`/[locale]/f/<slug>?view=all` renders the whole family (`src/lib/familyWindow.ts:29`
→ `getProducts(…, null)`); the largest live family has 2,400 products and 8
have over 1,000. Both are dynamic, uncached and cheap to request in a loop,
against a database that is already exhausting connections (H-2). **Fix**:
rate-limit both (search per IP; `view=all` per IP and cap it, e.g. 1,000 rows
with a CSV download beyond that); cache search results briefly by normalised
query. Scope LIVE, status CODE + live data.

### M-5 — `/_next/image` is an open image proxy for any HTTPS host

> **Fix status (2026-09-29): FIXED in `bb65ed9` and tightened in
> `01787d1`.** `remotePatterns` allows only `/storage/v1/object/public/**` on
> the one Storage host named by `SUPABASE_PUBLIC_URL`/`SUPABASE_URL` at build
> time. (The first version also allowed any `*.supabase.co`, which a
> background security review flagged: anyone can create a Supabase project.)
> If the build has neither variable, nothing is optimised. `CatalogImage`
> uses the same rule (`optimizableImageUrl`, tested in `catalogImages.test.ts`)
> and serves any other URL as a plain `<img>`. The false comment is fixed
> (part of L-9). Trade-off: supplier URLs pasted by an admin are no longer
> resized — heavier tiles for those images until they are uploaded instead.
> Self-hosted: the Docker build is not given `SUPABASE_URL`, so uploaded images
> there are also served unoptimised until it is.
> Verified on a local production build: a foreign URL through
> `/_next/image` now returns 400. Not verified at runtime: an uploaded Storage
> image still being optimised (the local database has none); the pattern is
> the live project's host shape and is unit-tested.

`next.config.ts:63` allows `hostname: "**"`. The comment (`:51-57`) says the
cost is "bounded by who can reach /admin" — it is not: anyone can request
`/_next/image?url=https://any-host/any.jpg&w=640&q=75`, and every distinct
URL/size is a billable transformation on Vercel and CPU on a self-hosted
server. **Fix**: copy admin-pasted images into the catalog bucket on save and
allow only that host (plus a short allow-list), or serve external URLs
unoptimised. Fix the comment. Scope LIVE, status CODE.

### M-6 — No security headers

> **Fix status (2026-09-29): FIXED in `016cf44`, except a full CSP.**
> `next.config.ts` `headers()`: `nosniff`, `Referrer-Policy:
> strict-origin-when-cross-origin`, a `Permissions-Policy` refusing camera,
> microphone and location, and `frame-ancestors 'self'` / `SAMEORIGIN`
> everywhere; `frame-ancestors 'none'` / `DENY` on admin, rep, account, pay and
> invoice; `no-referrer` on pay and invoice; `poweredByHeader: false`. Test:
> `e2e/security-headers.spec.ts` (passed on a local production build). Not
> done: a full Content-Security-Policy — the Enamad seal and Vercel Analytics
> need measured allowances, and report-only mode needs a report endpoint.

Live response headers for `/fa`: `strict-transport-security` (Vercel's
default) and `x-powered-by: Next.js` — no `Content-Security-Policy`, no
`frame-ancestors`/`X-Frame-Options`, no `X-Content-Type-Options`, no
`Referrer-Policy`, no `Permissions-Policy`. The admin and rep panels are
frameable, so their one-click confirm dialogs (`ConfirmSubmit`) can be
clickjacked. **Fix**: add headers in `next.config.ts` `headers()` (works for
both Vercel and Docker): `frame-ancestors 'none'` for `/admin`, `/rep`,
`/account`, `/pay`, `/invoice`; `nosniff`; `Referrer-Policy:
strict-origin-when-cross-origin` (and `no-referrer` on `/pay` and keyed
`/invoice`); a CSP starting in report-only mode (the Enamad seal and Vercel
Analytics need allowances); `poweredByHeader: false`. Scope LIVE, status
CONFIRMED-LIVE.

### M-7 — Per-click admin actions purge the whole site cache

> **Fix status (2026-09-29): FIXED in `d0b322a`.** No `revalidatePath("/",
> "layout")` remains. The only ISR pages are home and category, so catalog
> writes (add product, create/delete, taxonomy and media saves, site contact,
> CSV import) call `revalidateCatalogPages()`, which marks just those two
> routes stale. The exchange-rate and currency-display saves purge nothing:
> no cached page shows a price (checked: neither route reads the rate). No
> automated test — the change is a call-site swap; typecheck and lint cover it.

`revalidatePath("/", "layout")` — the pattern ARCHITECTURE.md says caused the
2026-08-15 outage — still runs on per-click actions:
`products/[id]/new/actions.ts:117` (every "Add a product"),
`products/actions.ts:48` (create family), `:272` (every taxonomy save with a
content/visibility change), `:355` (delete), `categories/[id]/actions.ts:250`,
plus `saveFxAction` (`admin/actions.ts:90`, which no priced page needs — they
render per request). Each marks every ISR page stale at once; the regeneration
burst is a candidate driver of H-2. **Fix**: revalidate only the paths/tags a
write changes (`/[locale]/c/[...slug]` page, the home page), or move catalog
pages to tag-based invalidation. Scope LIVE, status CODE.

### M-8 — Stock updates lock product rows in arbitrary order (deadlocks)

> **Fix status (2026-09-29): FIXED in `41e42b5`.** `holdStockForOrder`,
> `sellHeldStock` and `releaseHeldStock` first lock the order's product rows
> with `SELECT … ORDER BY id FOR UPDATE`; `writeImport` locks the family's
> rows the same way before upserting. Test: `orderIntegrity.integration.test.ts`
> runs 16 overlapping checkouts (lines in opposite orders) concurrently and
> checks the totals. Honest limit: the deadlock did not reproduce locally
> *without* the fix either (three runs), so the test guards the behaviour but
> does not prove the race; the fix rests on the lock-ordering argument. Not
> done: a retry on `40P01`/`40001`.

`holdStockForOrder`, `sellHeldStock`, `releaseHeldStock`
(`src/db/inventoryQueries.ts:35-71`) run `UPDATE products … FROM order_items`
with no ordering; `writeImport` upserts products in file order and then
rewrites **every** category row (`src/db/importQueries.ts:682`). Two checkouts
whose carts contain the same two products in opposite order, or a checkout
racing an import or a product-table save, can deadlock (SQLSTATE `40P01`); the
loser surfaces as a 500 with nothing retried. **Fix**: lock the affected
product rows first in id order (`SELECT … FOR UPDATE ORDER BY id`) inside each
transaction, or sort `order_items` by `product_id` and use a CTE that updates in
that order; retry once on `40P01`/`40001`. Scope ALL, status CODE.

### M-9 — 32-bit overflow on order and invoice totals

> **Fix status (2026-09-29): FIXED in `8056c30`.** Deviation from the
> suggested fix: the columns stay `integer` (max ≈ $21.4 M per order, far past
> any real order here; `bigint` would come back from postgres-js as a string
> and touch every money read, including the live release's). Instead checkout
> refuses a total past `MAX_ORDER_CENTS` with a clear message (`too-large`),
> and `issueInvoice` sums `unit_price_cents::bigint * qty` and refuses the same
> way; admin and rep see the message. Tests: `invoice.test.ts`,
> `salesReps.integration.test.ts` (99,999 × $500 at checkout and at invoice).

`orders.total_cents`/`requested_total_cents` and `order_items.unit_price_cents`
are `integer`. Checkout computes totals in JavaScript and inserts them
(`src/db/orderSubmissionQueries.ts:137`); invoicing computes
`SUM(i.unit_price_cents * i.qty)` where `int * int` overflows before `SUM`
widens (`src/db/invoiceQueries.ts:76`). Confirmed on Postgres:
`SELECT 50000::int * 99999::int` → `ERROR: integer out of range`. Quantity is
capped at 99,999 per line, so an anonymous user can make checkout throw by
putting 99,999 of a $500 product in the cart; an admin typing a large price
makes Finalize throw. **Fix**: `bigint` for totals (forward migration), cast
`unit_price_cents::bigint * qty` in SQL, validate line and order totals in the
action with a friendly error. Scope ALL, status CONFIRMED.

### M-10 — Paid orders can be cancelled with no refund record

> **Fix status (2026-09-29): FIXED in `ecbb637`.** Amir's decision: a paid
> order cannot be cancelled until there is a refund flow. `preparing →
> cancelled` is removed from the transitions, so the queue shows no Cancel on
> paid orders and the action's `assertTransition` + status-guarded UPDATE
> refuse a forged post. Test: `orders.test.ts`. Orders already cancelled after
> payment are unchanged.

`preparing → cancelled` is legal (`src/lib/orders.ts:37`; also on `main`).
Cancelling after payment leaves stock "sold", records no refund, and nothing
tells the admin money is owed back. **Fix**: either forbid cancelling paid
orders until a refund flow exists, or add a `refunded_at`/refund-amount record
and a "refund owed" list. Product decision for Amir; recommended: forbid.
Scope ALL, status CODE.

### M-11 — No audit trail for money and state changes; payouts can be deleted

> **Fix status (2026-09-29): FIXED in `bae3df3`.** New migration
> `20260930120000_add_audit_log.sql` (a fourth one to apply before the push):
> append-only `audit_log` and `rep_payouts.voided_at`. Written in the same
> transaction as the change: order shipped/delivered/cancelled, invoice issued
> (admin or rep), receipt uploaded, payment confirmed, customer password reset
> (admin or rep), rep password reset/changed, customer reassigned (before and
> after), pay link replaced, payout recorded and voided. "Delete payout" is now
> "Void": the row stays, marked, and stops counting as paid. Admin rows say
> "admin" (one shared password). Tests: `salesReps.integration.test.ts`
> (invoice + payment trail with actors; a refused change writes nothing;
> payout void keeps the row and records both steps). Not done: a screen to
> read the trail (SQL for now); catalog edits are not audited.

There is no record of who moved an order's status, issued an invoice, reset a
password, reassigned a customer or recorded a payout (the admin is one shared
password; only `paid_confirmed_by_rep_id` exists). `deletePayoutAction` →
`deletePayout` (`src/db/repMoney.ts:151`) hard-deletes a financial record.
**Fix**: an append-only `audit_log` table written in the same transaction as
each money/state write (actor kind + id, action, before/after); replace payout
delete with a reversing entry. Scope BRANCH, status CODE.

### M-12 — Local tooling defaults to the live database

> **Fix status (2026-09-29): FIXED in `cab39c8`.** The live credentials file
> was renamed `.env.production.local` → `.env.remote` on Amir's Mac (Next does
> not auto-load it) and every `db:*:remote` script now reads `.env.remote`
> (`db:verify:remote` checked: still reaches the live database, read-only).
> `playwright.config.ts` refuses a non-local `DATABASE_URL`; `drizzle.config.ts`
> refuses any non-local host (checked: `drizzle-kit check` against a remote URL
> exits with the refusal). `strict` stays false: it prompts before every
> statement and would stall CI's bootstrap; drizzle-kit still prompts before
> data-loss statements. Docs: `LOCAL-DEV.md`, `DEPLOYMENT.md`.

- `playwright.config.ts:25` starts `npm run start`, and `next start` loads
  `.env.production.local` (live credentials). Unless the operator exports the
  local `DATABASE_URL` first, the e2e suite creates orders, customers, reps
  and settings **on the live database**. Same for `npm run build`.
- `drizzle.config.ts` has `strict: false` (no confirmation prompt on
  destructive statements) and no host guard; `npm run db:studio` and a bare
  `drizzle-kit push` target whatever the shell exports. Push has already
  destroyed live objects four times (project memory).
**Fix**: rename `.env.production.local` to a name Next does not auto-load
(e.g. `.env.remote`) and update the `db:*:remote` scripts; make the Playwright
web server refuse to start unless `DATABASE_URL` is local; set `strict: true`
and a remote-host refusal in `drizzle.config.ts`. Scope LIVE (process),
status CODE.

### M-13 — Customer emails are never verified

Sign-up accepts any address (`signUpAction`); `createUser` rejects a second
account with the same address. Anyone can register a real customer's email
first; the owner can then never sign up with it and has no recovery (no email
system). The legacy admin reset (`resetCustomerPasswordAction`,
`src/app/[locale]/admin/actions.ts:342`) resets **by email typed on an
order**, which ties an order's typed address to someone else's account.
**Fix**: verification before the address is bound (email or SMS — SMS fits
Iran better), or at minimum an admin "release email" tool. Scope LIVE, status
CODE (known gap).

### M-14 — Anyone can lock a rep out

> **Fix status (2026-09-29): FIXED in `9064654`.** Rep sign-in now uses the
> same guard as customers (M-1): the address counter counts every attempt,
> the username counter counts failures only, and a browser the rep has signed
> in from before passes a username lockout. A stranger can still make a rep
> wait 15 minutes on a *new* device; they can no longer lock the rep out of
> the phone they use. Test: `rateLimit.integration.test.ts` (shared counters).

`repSignInAction` (`src/app/[locale]/rep/actions.ts:68`) consumes the
username-scoped counter on every attempt before checking anything. Ten failed
tries per 15 minutes from any IPs lock the named rep out of their own account,
repeatedly; rep usernames leak through C-1 on the branch. **Fix**: count only
failures against the account counter, and let a correct password through a
short account lockout from a previously successful device/IP (or add
progressive delays instead of a hard stop). Scope BRANCH, status CODE.

### M-15 — Lists silently truncate

> **Fix status (2026-09-29): FIXED in `e527b83`.** The admin queue, rep
> orders and rep customers lists carry `count(*) OVER ()` and show "Showing
> the first N of M — use a filter or search" when cut short. The rep checkout
> loads the chosen customer with `getCustomerForRep` (and adds them to the
> picker if past the first 500), so "New order" works for every customer.
> Test: `salesReps.integration.test.ts`. Not done: real paging; the smaller
> lists (notes 200, follow-ups 50, in-progress 200) keep their limits
> unannounced — they are per-customer or per-day and far from the limit.

Admin queue `LIMIT 200` of non-closed orders (`admin/(panel)/orders/page.tsx:121`,
also on `main`), `listOrdersForRep … LIMIT 300` (`src/db/repOrderQueries.ts:58`),
`listCustomersForRep … LIMIT 500` (`src/db/customerQueries.ts:90`, also feeding
the rep checkout's customer picker), `listInProgressForRep LIMIT 200`,
`listNotes LIMIT 200`, `listFollowUpsDue LIMIT 50`. Past the limit, rows simply
disappear with no "more" indicator — an order the admin never sees is an
order never fulfilled. The rep checkout is worse: `/quote`
(`src/app/[locale]/quote/page.tsx:64`) offers only the first 500 customers by
company name and then does `customers.find(c => c.id === wanted)`, so a rep
with 600 customers who presses "New order" on the 550th gets no selected
customer and cannot place the order (and each render also runs an unused
`max(created_at)` subquery for all 500). **Fix**: paginate or at least show
"showing N of M"; the checkout should load the one selected customer with
`getCustomerForRep` and search the rest on demand. Scope ALL, status CODE.

### M-16 — 4.25 MB bodies accepted by every Server Action

> **Fix status (2026-09-30): FIXED in `e632a05`.** `src/proxy.ts` runs only
> for Server Action posts and refuses a body over 1 MB — or one with no declared
> length — except on the pages that upload files (admin, pay link, customer and
> rep order pages), which keep the 4.25 MB allowance. Signed direct uploads were
> not needed for this. Test: `src/lib/actionBodyLimit.test.ts`.
> **Incomplete as first committed; see F-2** (the proxy missed header-less
> form posts, and the admin sign-in page counted as an upload page).

`next.config.ts:74` raises the limit globally for the image upload's sake, so
anonymous actions (cart, checkout, sign-up, sign-in) also accept 4.25 MB
multipart bodies that Next buffers before the action's own validation runs.
**Fix**: keep the global limit small and move the large uploads (catalog
images, receipts) to signed direct-to-Storage uploads like the CSV importer,
or a dedicated route handler with `readTextBodyWithin`-style streaming limits.
Scope LIVE, status CODE.

### M-17 — Rep visibility over a moved customer's history is broader than needed

> **Fix status (2026-09-30): FIXED in `5d6d476` with the review's recommended
> default — Amir did not rule on this one, so it is his to overturn.** A rep
> still *sees* every order of a customer now assigned to them, but may act only
> on orders credited to them: the pay token is returned only for those (list
> and detail), and invoicing, the draft invoice, receipt uploads and reading
> receipts use `repCanActOnOrder` (`o.rep_id = rep`). An inherited order shows
> "credited to another rep — read-only". Test: `salesReps.integration.test.ts`.

`visibleTo` (`src/db/repOrderQueries.ts:37`) grants a rep every order of any
customer currently assigned to them — including orders placed and credited
while the customer belonged to another rep — with prices, pay links (bearer
credentials), receipt upload and (C-2) payment confirmation. **Fix**: decide
with Amir; recommended: reps see and act on orders credited to them; older
orders of a newly assigned customer are read-only summaries without pay links.
Scope BRANCH, status CODE.

### M-18 — Reassignment races; moved customers keep the old commission flag

> **Fix status (2026-09-30): FIXED in `d1cdcc4`.** `assignCustomer` and
> `deactivateRep` check the destination rep `FOR SHARE` inside their
> transaction; checkout's `creditFor` reads the customer `FOR SHARE`, so a move
> in flight waits. Deactivation now asks explicitly whether moved customers
> earn commission for the new rep (checkbox, off by default) instead of
> carrying the old rep's flag; the move is audited (M-11). Test:
> `salesReps.integration.test.ts` (flag not inherited; assign to a deactivated
> rep refused). The race itself is argued from the locks, not reproduced.

- `deactivateRep` (`src/db/repQueries.ts:152`) moves customers with
  `UPDATE users SET rep_id = destination` but leaves `rep_earns_commission` as
  it was for the previous rep — the destination rep inherits eligibility
  decisions made for someone else.
- `assignCustomer` checks the rep is active outside any transaction;
  `deactivateRep` checks the destination without `FOR SHARE`;
  `creditFor` (`src/db/orderSubmissionQueries.ts:81`) reads the customer's
  rep without locking the row. Concurrent admin actions can assign customers
  to a rep that was deactivated a moment earlier, or credit an order to a rep
  mid-move.
**Fix**: lock the rows involved (`FOR SHARE`/`FOR UPDATE`) inside one
transaction; make the commission flag an explicit choice at move time.
Scope BRANCH, status CODE.

### M-19 — Browser Back/Forward silently discards unsaved product-table edits

> **Fix status (2026-09-30): FIXED in `0ee9f4a`.** `UnsavedOrderGuard`
> cancels a same-document Back/Forward through the Navigation API's
> `navigate` event (before the address changes, so nothing re-renders) and
> offers Save / Discard / Stay; leaving goes to the page Back was heading for.
> Where the Navigation API is missing, a capture-phase `popstate` fallback
> restores the address and shows the dialog — but by then Next has already
> re-rendered, so on those browsers the table's draft is still lost (Next 16's
> router acts before `popstate` reaches page code). `createNode`'s URL change
> now goes through the same guard. Test: `e2e/admin-products-taxonomy.spec.ts`
> (Back with an edited price → dialog, address kept, value kept; Chromium).

The admin product table keeps pending edits in React state; the selected
family comes from `?cat=` and the pane is keyed per family
(`src/app/[locale]/admin/(panel)/products/TaxonomyWorkbench.tsx` ~828,
`SelectedFamilyPane key={selected.key}`). `UnsavedOrderGuard` intercepts link
clicks and `beforeunload` only, so a `popstate` (Back/Forward), or
`createNode`'s direct `updateUrl`, remounts a fresh table and the draft is
gone with no Save/Discard/Stay prompt — contrary to ARCHITECTURE.md ("The
workbench's one leave-the-page guard covers the table's unsaved rows too").
**Fix**: handle `popstate` in the guard (re-push the current URL and show the
dialog), and route `updateUrl` through the same guard. Scope BRANCH, status
CODE.

### M-20 — About 1 in 290 temporary passwords is mangled in the "share" message

> **Fix status (2026-09-30): FIXED in `8276c3f`.** `src/lib/fillMessage.ts`
> fills `{placeholders}` through a replacer function, so values arrive
> literally. Used for every message that is copied or sent: the three
> credential messages (admin customer, admin rep, rep customer), both pay-link
> messages and the referral message. Other `.replace("{x}", …)` calls only
> build on-screen labels from numbers or admin-typed names and were left
> alone (converting all 93 was out of proportion). Test: `fillMessage.test.ts`.

`String.prototype.replace("{password}", credential.password)` treats `$$` in
the replacement as a literal `$`. `$` is in the temporary-password alphabet
(`src/lib/tempPassword.ts:6`), so a password containing `$$` is shown
correctly on screen but shared wrong (`"Ab3$$x!q9Zk"` → `"Ab3$x!q9Zk"`,
verified in Node). The customer or rep who uses the shared message cannot
sign in. Sites: `src/app/[locale]/rep/(portal)/customers/[id]/page.tsx:103`,
`src/app/[locale]/admin/(panel)/customers/[id]/page.tsx:111`,
`src/app/[locale]/admin/(panel)/reps/[id]/page.tsx:108`. **Fix**: use a
replacer function (`.replace("{password}", () => credential.password)`) — and
audit every other `.replace("{…}", value)` whose value is user- or
system-generated (`payLinkMessage` with company names, for instance).
Scope BRANCH, status CONFIRMED.

### M-21 — Product-table JSON is unpaged

> **Fix status (2026-09-30): FIXED in `fa76f4c`.** `/api/admin/family/[id]/products?page=N`
> returns one page of 100 rows plus the family's total (`getProductsPage`);
> the table fetches the page it shows and remembers every row loaded (with its
> position) so edits on several pages save together with the fingerprints they
> were loaded with. Measured on a local production build, largest family
> (2,400 rows): 27 KB per page, against ~735 KB for the whole family before.
> Tests: `partNumbers.integration.test.ts` (paging), `e2e/admin-products-taxonomy.spec.ts`.

`/api/admin/family/[id]/products` (`src/app/api/admin/family/[id]/products/route.ts:30`)
returns every product of the family on every family click. Measured locally,
the largest family (2,400 rows) is ~735 KB per click; at ~300 bytes a row a
family past ~15,000 rows (imports allow 20,000) exceeds Vercel's 4.5 MB
response limit and the table cannot load at all. **Fix**: page the route
(100 rows, as the table displays) and fetch pages on demand. Scope BRANCH,
status CODE + measurement.

### M-22 — An unrelated feature is bundled into the sales-rep release

> **Declined (2026-09-29):** Amir wants all of this work, and every fix in
> this document, to ship together. It is already committed on the local
> `main`; do not split the product-table editor out.

`CLAUDE.md`: "Do not bundle. One change per change." The uncommitted
sales-rep working tree also carries the admin product-table editor
(`FamilyProductTable.tsx`, `productTableActions.ts`, `src/lib/productEdits.ts`,
`src/lib/productTable.ts`, `src/app/api/admin/family/[id]/products/`, changes
to `e2e/admin-products-taxonomy.spec.ts`). It cannot ship until all three
rep/VAT/proof migrations are live, and any regression in it will be
attributed to the sales-rep release. **Fix**: split it onto its own branch
and commit sequence before merging; confirm with Amir which ships first.
Scope BRANCH (process), status CODE.

---

## Low

| ID | Finding | Where | Fix |
| --- | --- | --- | --- |
| L-1 | **FIXED 2026-09-30 in `2356bd6`** (`secure` in production, like the session cookies). Cart cookie has no `Secure` flag (the id is a bearer for the cart and its checkout) | `src/lib/cart.ts:57-62` | add `secure` in production |
| L-2 | **FIXED 2026-09-30 in `a80d412`** (mirrors `.gitignore`). `.dockerignore` misses `venv.txt` (a `vercel env pull` with real keys, per `.gitignore`), `other_ignore/`, `products/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo` — all copied into the builder stage and build cache | `.dockerignore` | mirror `.gitignore` |
| L-3 | **FIXED 2026-09-30 in `4ca4b3e`** at Amir's request: the title suffix, the `enamad` meta tag and `public/25626502.txt` are gone; the footer seal stays. (Earlier the same day: closed by Amir with no change, the seal being issued.) Temporary Enamad ownership marker still live: `— 25626502` in every page title and `public/25626502.txt` | `src/app/[locale]/layout.tsx:12-27` | remove once the seal is issued (ask Amir if it has been) |
| L-4 | **FIXED 2026-09-30 in `6fa9799`**: migration `20260930130000_drop_spec_defs_display.sql` (checked: neither the live release nor this one reads or writes the column), schema, verifier. `spec_defs.display` was to be dropped "next release" after 2026-08-20; still present | `src/db/schema.ts:247` | forward migration + schema + verifier |
| L-5 | **FIXED 2026-09-30**: the year in the number is the Persian year on Tehran time (Amir's decision), supplied by `persianYearMonth` because Postgres has no Persian calendar; the sequence stays one running count (H-3). Invoices issued before this keep their Gregorian numbers (`INV-2026-…`); the running count means old and new never collide. Invoice number year is the UTC Gregorian year (`to_char(now(),'YYYY')`); an invoice issued 00:00–03:30 Tehran on 1 January carries last year, and Iranian books run on the Persian fiscal year | invoice numbering (H-3) | — |
| L-6 | **FIXED 2026-09-30 in `f8b8e6b`**: admin and rep invoice issuance refuse while the contact email or phone is the stand-in value (`isPlaceholderContact`); the header still shows them. Live already has real values saved (checked: `sales@temex.ir` and a real phone on the live header). CI sets `SELLER_EMAIL`/`SELLER_PHONE`. Placeholder seller/contact values (`sales@temex.example`, `+98 21 8888 0000`) print on invoices and the header when settings are unset | `src/lib/seller.ts:39-40`, `src/lib/siteContact.ts:14-15` | refuse to issue invoices until real values are saved |
| L-7 | **FIXED 2026-09-30 in `76a60e7`**: only a whole-rial value is accepted from the environment; anything else falls through as unset. A non-integer `USD_TO_RIAL` is accepted, then `BigInt(rate)` throws in `invoiceAmounts` → invoice pages 500 | `src/lib/fxRate.ts:33-34`, `src/lib/invoice.ts:69` | require an integer at the boundary |
| L-8 | **FIXED 2026-09-30 in `2f70141`**: `noindex` and `no-referrer` metadata on the invoice page (plus the `Referrer-Policy: no-referrer` header from M-6). Not done: a POST-to-cookie key exchange, so keyed URLs can still land in browser history. Invoice URLs carrying `?key=<pay token>` have no `noindex` / `no-referrer` (the pay page has both); tokens also land in access logs and browser history | `src/app/[locale]/invoice/[ref]/page.tsx` | add metadata; prefer a POST-to-cookie exchange for keyed access |
| L-9 | **FIXED 2026-09-30** — the image-proxy and receipt-route comments with M-5/C-3, the reset-cookie comment with H-11, and the account order and password page comments in `478f787`. Comments that are now false: ~~`next.config.ts:51-57` ("bounded by who can reach /admin", M-5)~~ (fixed with M-5); `api/payment-proofs/[id]/route.ts:17-18` ("not open under DEMO_MODE", H-8); ~~`admin/actions.ts:360` says the reset cookie is not httpOnly but it is~~ (removed with H-11); (the `admin/(panel)/layout.tsx` "one place the sign-in gate lives" comment was corrected with C-1); `account/orders/[ref]/page.tsx:17` says the page is read-only with no customer actions, but it now takes receipt uploads that change order status; `account/password/page.tsx:20` says the form "asks for no current password", but it now requires the temporary one (dropping it would reopen the lock-out `setInitialPasswordAction` prevents) | as listed | fix with the related code |
| L-10 | **FIXED 2026-09-30 in `a18d3c5`**: one `DUMMY_PASSWORD_HASH`, one `latinDigits` (`lib/digits.ts`), `db/pgErrors.ts` `uniqueViolation`, `lib/ids.ts` `postedUuid`, `lib/percent.ts` `parsePercentBp` for VAT and commission (commission now also accepts a comma decimal mark and a leading `%`, like VAT). Duplicated logic that will drift: two dummy scrypt hashes (`src/lib/password.ts:75`, `src/app/[locale]/account/actions.ts:111`); private `latinDigits` copies in `src/lib/fxRate.ts:86` and `src/lib/siteContactValues.ts:12` beside `src/lib/digits.ts`; `uniqueViolation` in `customerQueries.ts` and `repQueries.ts`; `postedCustomerId` in the rep and admin customer actions; `parseVatPercent` re-implements `parseCommissionPercent` | as listed | one shared helper each |
| L-11 | **FIXED 2026-09-30 in `6e030cf`** (80 / 120 characters, `boundedString`, `maxLength` on the inputs). Courier and tracking-number fields have no length bound | `src/app/[locale]/admin/actions.ts:185-186` | `boundedString` |
| L-12 | **FIXED 2026-09-30 in `6ae9a83`**: N = 2^17 (measured ≈250 ms, 128 MiB per hash here), `maxmem` raised to match, stored N capped at 2^18; customer and rep sign-in rehash an older hash in place (hash only — no flag or session change). Follow-up (security review of that fix): a wrong password against a not-yet-rehashed 2^14 hash answered 8× faster than an unknown login against the 2^17 dummy, so timing told which accounts exist; a check against an older hash now runs throwaway rounds up to exactly one current-cost hash (commit `b631b1c`). scrypt `N = 16384` is below current guidance (2^17 for scrypt); parameters are stored per hash, so raising is backward-compatible | `src/lib/password.ts:24` | raise N, rehash on next sign-in |
| L-13 | **FIXED 2026-09-30 in `9fda634`**: `SET lock_timeout = '5s'` in all three (and in the two new ones). The `pay_token` rewrite of `orders` still takes an ACCESS EXCLUSIVE lock; the live table is small (orders in the hundreds), so it is seconds at most. The three branch migrations set no `lock_timeout` (earlier ones do); `add_sales_reps` rewrites `orders` for the volatile `pay_token` default under an ACCESS EXCLUSIVE lock | `supabase/migrations/2026092*` | add `SET lock_timeout = '5s'` |
| L-14 | **FIXED 2026-09-30 in `2360ea6`** (rendered only when `VERCEL` is set). `@vercel/analytics` is always rendered; on the self-hosted server its script 404s on every page | `src/app/[locale]/layout.tsx:77` | render only when `VERCEL` is set |
| L-15 | **FIXED 2026-09-30 in `39e6a8d`**: `stripImageMetadata` drops JPEG APP1/APP13/COM, PNG text/eXIf/tIME and WebP EXIF/XMP before storing, without re-encoding (a real JPEG checked: still decodes, 3.5 KB of metadata gone). PDFs keep theirs. Receipt photos keep EXIF metadata (GPS, device) — only the browser shrinks them, and a direct post skips that | `src/lib/paymentProofUpload.ts` | strip metadata server-side or accept only re-encoded images |
| L-16 | **FIXED 2026-09-30 in `98d21fb`**: migration `20260930140000_revoke_api_role_grants.sql` (tables, sequences, functions and default privileges; skipped where the roles do not exist); tested in a rolled-back transaction with temporary roles (TRUNCATE on `orders` and UPDATE on `invoice_seq`: true → false); `db:verify` now fails on any grant to those roles. Defence in depth: on the live database `anon`/`authenticated` hold every table privilege (including TRUNCATE) on 13 tables and USAGE/UPDATE on 9 sequences including `invoice_seq`; RLS with no policies is the only barrier | live DB grants | `REVOKE ALL … FROM anon, authenticated` in a migration (as `add_request_rate_limits` already does for its table) |
| L-17 | **FIXED 2026-09-30 in `3fef24c`**: says "schema behind — run db:migrate:check:remote, then db:migrate:remote (pending: …)", and mentions bootstrap only when no table exists (checked read-only against live). `scripts/verify-remote.mts:318-322` prints "only an empty database may use db:bootstrap:empty:remote" when the schema is merely behind on migrations, and exits before the integrity checks | verifier | say "run db:migrate:remote" |
| L-18 | **FIXED 2026-09-30 in `f9ffdf0`**: shown only when it parses as an issued reference (`normaliseRef`); test `e2e/quote-submitted-ref.spec.ts`. `/quote/submitted?ref=<anything>` prints any text as "your order reference" (content spoofing in a trusted frame) | `src/app/[locale]/quote/submitted/page.tsx:16-26` | show it only when it matches the reference format |
| L-19 | **FIXED 2026-09-30 in `af03a03`**: actions pinned to commit SHAs (tag in a comment); `npm audit fix` patched js-yaml, braces, brace-expansion, drizzle-kit and @vercel/config in place. Left, both dev-only and reachable only from our own build/tooling input: esbuild ≤0.24 inside drizzle-kit (fix is drizzle-kit 1.0 beta) and path-to-regexp inside @vercel/config (fix is a downgrade). `npm audit --omit=dev` is clean. CI actions pinned by major tag, not commit SHA; dev-only audit findings (esbuild via drizzle-kit, js-yaml, path-to-regexp via `@vercel/config`) | `.github/workflows/ci.yml`, `npm audit` | pin SHAs; upgrade when compatible |
| L-20 | **FIXED 2026-09-29 with H-1 in `de10422`.** `unitPriceAt` takes the *last* tier in array order whose `minQty ≤ qty`, so unsorted tiers price wrongly (no live product is unsorted today; see H-1 for tiers generally) | `src/lib/cart.ts:257-263` | choose the highest `minQty ≤ qty` |
| L-21 | **FIXED 2026-09-30 in `bc1ea90`**: demo reps are reset in place (upsert on username) instead of deleted, and only the demo customers' orders are removed, so UI-created customers and their orders keep their rep. Reproduced on the local database (a UI-style customer of demo.sara made the re-run fail on `users_rep_id_sales_reps_id_fk`); after the fix two consecutive re-runs succeed and reconcile is clean. No automated test: the script only runs by hand against a local database. Re-running `npm run db:seed:reps` aborts once a demo rep owns a customer created through the UI (it deletes only its own `demo.*@example.invalid` users before `DELETE FROM sales_reps`, and the rep foreign keys are `RESTRICT`), although its header promises re-runs replace its rows | `scripts/seed-reps.mts:67` | reassign or delete dependants first |
| L-22 | **FIXED 2026-09-30 in `17d53dc`**: the rate read runs alongside the other reads, and `loadRepSummary` returns the payouts it already read; covered by the rep and admin commission checks in `e2e/sales-rep-flow.spec.ts`. Wasted round trips: the admin rep page and the rep commission page await `getFxRate()` serially before their fan-out, and read payouts twice (`loadRepSummary` already reads them) | `admin/(panel)/reps/[id]/page.tsx:67`, `rep/(portal)/commission/page.tsx:19-24` | start in parallel; return payouts from `loadRepSummary` |
| L-23 | **FIXED 2026-09-30 in `989c854`**: the four queries take `HELD_STATUS_LIST` as a `text[]` parameter; test `src/lib/orders.test.ts` ("no query spells out the held statuses itself") fails on any literal copy left in `src/db`. `HELD_STATUSES` exists in `src/lib/orders.ts`, but the held-status list is still hard-coded as SQL literals in `src/db/importQueries.ts:710`, `src/db/dataIntegrity.ts:104` and `:191`, `src/db/inventoryQueries.ts:101` — the next new held status repeats the grep hunt, and a missed site makes imports, reconcile and the shortfall warning disagree | as listed | pass the constant as an array parameter |
| L-24 | **FIXED 2026-09-30 in `1477cde`**: the credential box calls `DELETE /api/shown-once` once rendered (a route handler, not a Server Action — deleting a cookie in an action re-renders the page and would take the credential off screen); `e2e/sales-rep-flow.spec.ts` checks the cookie is gone after both the admin and the rep see a new password. The "shown once" credential cookie is never cleared after it is read; the plaintext password stays in the browser and rides on every request for 30 s | `src/lib/shownOnce.ts` | delete the cookie in the page that displays it (via a tiny client-side action) |

---

## Fix review (2026-09-30)

A review of the 62 fix commits (`50c4ace..40a07b8`). Most fixes are complete
and correct; these four are new. All four are fixed.

### F-1 — One address can lock every admin out

> **Fix status (2026-09-30): FIXED in `8c9e94b`.**

The H-5 fix added a ceiling of 60 admin sign-in attempts per 15 minutes from
all addresses together, consumed in parallel with the per-address limit
(8 per 15 minutes) — so attempts the per-address limit had already refused
still counted. One address posting ~60 junk sign-ins every 15 minutes kept
every admin out indefinitely. **Fix**: the admin goes through
`lib/signInGuard.ts` like reps and customers: only failures count, only
after the per-address limit lets the attempt through, and a browser that has
signed in as admin before passes; the count and the mark are keyed to a digest
of the current password (`adminSignInKey`), so changing `ADMIN_PASSWORD`
retires both. Test: `e2e/admin-sign-in-lockout.spec.ts` (fails on the old
code with `error=rate-limit`).

### F-2 — The 1 MB action body cap could be skipped

> **Fix status (2026-09-30): FIXED in `fcdf9d7`**, with a residual by design.

`src/proxy.ts` matched only requests carrying `Next-Action`, but Next treats
every multipart POST as a possible action (a form posted before the page's
JavaScript runs names its action in the body), so leaving the header off
skipped the cap on every page; and `/admin/login`, a public page, matched the
upload-page pattern. **Fix**: the proxy also matches multipart posts; the
sign-in page gets the small limit. **Residual**: Next runs an action posted to
any page, forwarding it internally to the page that owns it (the forwarded
hop skips the proxy), so a stranger can still send 4.25 MB by posting to a
pay-link address — where customers without accounts upload receipts — or an
admin address. Only signed direct-to-Storage uploads would close that. Test:
`e2e/action-body-limit.spec.ts` (the header-less cart post returned 500 from a
processed action on the old code).

### F-3 — Receipt photos can show sideways

> **Fix status (2026-09-30): FIXED in `c643447`.** An EXIF segment that
> records a rotation is replaced by a minimal one carrying only the
> orientation; everything else in it still goes. JPEG only (phones photograph
> in JPEG). Test: `src/lib/imageMetadata.test.ts`.

`stripImageMetadata` (L-15) drops the whole JPEG APP1 segment, including the
EXIF orientation tag. The browser's shrink step bakes the orientation into the
pixels, but `PaymentProofUpload.tsx:123` sends the original when re-encoding
would make it larger, and a direct post skips the shrink: such a photo is
stored without its orientation and displays rotated. Inferred from the code,
not observed. **Fix**: keep a minimal APP1 carrying only the orientation tag,
or rotate on the server. Scope BRANCH.

### F-4 — The known-device mark never expires on the server

> **Fix status (2026-09-30): FIXED in `bbf1d93`.** `lib/deviceMark.ts`:
> `d1.<expiry>.<signature>`, signed over the account's session version, so the
> server checks the expiry and any password change or reset (for the admin,
> "Sign out everywhere") retires earlier marks. Sign-in now looks the account
> up before the lockout check. Test: `src/lib/deviceMark.test.ts`.

`deviceMark` in `lib/signInGuard.ts` is an HMAC of the login alone: the same
value for every browser, valid for ever on the server (the cookie's 180 days
is only the browser's), and unchanged by a password change. Anyone who once
signed in to a customer or rep account — someone who learnt an old password —
keeps a pass through that account's lockout; the per-address limit still
applies. (The admin's mark is keyed to the password since F-1.) **Fix**: put
an expiry in the mark and key it to the account's `session_version`. Scope
BRANCH.

---

## Test coverage gaps

The unit suite (284 tests) and the database suites (39 tests) all pass, and
typecheck and lint are clean. They test what the code intends; none of the
defects above is caught because nothing tests these properties:

1. Anonymous requests to protected routes return no protected data (C-1, C-3).
2. A rep cannot move an order to `preparing`, cannot invoice a zero-priced line,
   cannot reset a self-registered customer's password (C-2, H-4).
3. An import or table edit changes the price a customer is charged (H-1).
4. Invoice numbers stay unique past 9,999 (H-3).
5. `DEMO_MODE` never renders a pay token or serves a receipt (H-8).
6. The cart refuses hidden products (M-3).
7. Totals that exceed 32 bits are refused cleanly (M-9).
8. Concurrent checkouts on overlapping carts do not deadlock (M-8).
9. Each migration accepts the previous release's inserts (H-10) — run `main`'s
   write shapes against the migrated schema in CI.
10. The admin order queue cannot reset an account the order does not belong to
    (H-11).
11. Credential and pay-link messages survive `$`-sequences in their values (M-20).

`src/db/orderIntegrity.integration.test.ts` has three tests for the whole
order lifecycle; the payment-proof path, VAT locking and cancellation after
payment deserve their own cases.

---

## Deployment blockers before `main` is pushed (not bugs — required steps)

**Done 2026-09-30.** `npm run db:verify:remote` (read-only) reports every
table, column, constraint, index, the customer-code trigger and all six
migrations present on the live database — `20260927120000` (sales reps),
`20260928120000` (VAT), `20260929120000` (payment proofs), `20260930120000`
(audit log), `20260930130000` (drop `spec_defs.display`) and `20260930140000`
(revoke REST-role grants) — and the statements recorded in its migration
ledger match the current files exactly (compared ignoring whitespace), so the
H-10 and C-2 edits made before they were applied are in. Another session
applied them; the live site (the previous release) kept serving normally
afterwards. The only step left is pushing `main`, when Amir says. After the
push every admin is signed out once (new session format, H-9).

---

## Checked and found sound

- No `dangerouslySetInnerHTML`/`eval`; React 19 blocks `javascript:` URLs;
  product document URLs are always empty from import; `tel:`/`mailto:` values
  are sanitised.
- All SQL is parameterised (postgres-js tagged templates); `sql.unsafe` appears
  only in seed/migration scripts on fixed strings.
- Every exported Server Action checks its caller (`assertAdminWrite`,
  `requireRep`, session, or a rate limit for public ones); Next's Server Action
  origin check plus `SameSite=Lax` cookies cover CSRF; the import route checks
  `Origin` itself.
- Customer order pages, the invoice page and the receipt route check access
  in the query or before it; pay tokens are 244 random bits and compared in
  constant time.
- Order status moves are guarded twice (`assertTransition` +
  `WHERE status = <from>` with row counts); submission replay is enforced by a
  unique key; cart mutations serialise on the cart row.
- Live database: RLS on all 14 tables; `catalog-imports` bucket private;
  catalog images are stored in the **live** Supabase project (image URLs
  resolve to `myyjeiujwtkwlemidvow`), so the earlier worry that production
  storage points at the scratch project does not hold.
- Timestamps as text from the shared client parse correctly in V8
  (`"2026-09-28 15:02:56.887+00"` → valid `Date`).
- `npx tsc --noEmit`, `npx eslint .`, `npm test`, `npm run test:db`,
  `npm audit --omit=dev` (0 production vulnerabilities): all clean.

---

## What could not be verified

- **Admin-, rep- and customer-gated flows were not exercised in a browser**
  (no credentials were typed, by rule). They were reviewed in code and through
  the database integration tests.
- **Vercel environment variables**: the connector is not allowed to list them
  (403). Whether `CRON_SECRET`, `DEMO_MODE`, `USD_TO_RIAL` and the Supabase
  storage keys are set as the docs require is unverified; the live behaviour
  (admin pages redirect → `DEMO_MODE` off; images in the live project →
  storage URL correct) was inferred from responses.
- **The open image proxy (M-5)** was established from configuration and the
  Next docs; it was not exercised against production, to avoid creating
  billable transformations.
- **H-2's root cause** needs per-instance metrics; the error counts are
  confirmed, the mechanism is not.
- Client components (`TaxonomyWorkbench`, `ImportPanel`, `ColumnReview`,
  `CatalogMediaEditor`, `FamilyProductTable`) were skimmed, not line-read; they
  run only for the signed-in admin and write through the server paths reviewed
  above.

---

## Appendix — reproducing the evidence without exposing data

```bash
# C-1 (counts only, prints no personal data)
curl -s -o /tmp/a.html -w '%{http_code}\n' https://www.temex.ir/fa/admin/orders
grep -o 'ORD-[A-Z0-9]\{6\}' /tmp/a.html | sort -u | wc -l     # > 0 means leaking
grep -o -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' /tmp/a.html | sort -u | wc -l

# H-3
docker exec isupply-db psql -U isupply -d isupply -At -c "SELECT lpad('10000',4,'0')"   # 1000

# M-9
docker exec isupply-db psql -U isupply -d isupply -At -c "SELECT 50000::int * 99999::int"  # integer out of range

# H-1 (live, read-only)
#   SELECT count(*) FILTER (WHERE jsonb_array_length(price_tiers) > 0) FROM products;  -- 33,427 of 35,717

# M-6
curl -sI https://www.temex.ir/fa | grep -i -E 'content-security|x-frame|x-content-type|referrer-policy|x-powered-by'
```
