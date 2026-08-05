# Full codebase review — 2026-08-05

Run after Phase 5, before the first production deploy. Covers all five phases.

Scope: a production build, every `process.env` read, every SQL construction
site, both public API routes, the admin gate, and the Phase 5 code written the
same day.

## Findings

### 1. `AUTH_SECRET` is required to *build*, not only to run — Blocker (by design, now documented)

`src/lib/session.ts` resolves the signing key at module import. During
`next build`, "Collecting page data" imports that module, so a build without
`AUTH_SECRET` fails outright:

```
Error: Failed to collect configuration for /[locale]/account
  [cause]: Error: AUTH_SECRET is required in production (16+ characters)
```

Kept as-is. Failing the deploy is the correct outcome — the alternative is a
site that builds happily and then cannot sign a session for a real customer.
But it is a hard prerequisite rather than a warning: **`AUTH_SECRET` must exist
in the deploy environment before the first push**, and on Netlify and Vercel a
normal environment variable covers both build and runtime.

Documented in `.env.example` rather than changed.

### 2. `ADMIN_PASSWORD` fell back to `changeme` in production — Critical, fixed

`src/lib/admin.ts` read `process.env.ADMIN_PASSWORD ?? "changeme"` in two
places, and `.env.example` ships that literal. A deploy that forgot the
variable would accept `changeme` at `/admin`, which is:

- every order's company, contact name, email, phone and delivery address
- invoice issuance and order status transitions
- customer password resets
- (new in Phase 5) a CSV export of the entire price list, and a bulk overwrite
  of the catalog

Nothing about the running site would look wrong.

Fixed: production refuses both an unset value and the example value. Resolved
per call rather than at import, so — unlike `AUTH_SECRET` — it throws when
someone opens `/admin` rather than during the build, which has no business
needing the admin credential. Verified across all four combinations of
`NODE_ENV` and the variable.

### 3. `writeImport` would duplicate a SKU whose case differed — Critical, fixed

Introduced in Phase 5 the same day. `ON CONFLICT (part_number)` is
case-sensitive and the unique index is on the raw column, so uploading
`abc-100` where the catalog holds `ABC-100` did not conflict: it inserted a
second product. Every lookup in the app upper-cases before matching, so both
would then be found, and the parse-level duplicate check only covers duplicates
*within* one file.

Fixed: the pre-flight check inside the transaction now matches on
`upper(part_number)` and refuses the import, naming the catalog's spelling so
the fix is to copy it. Refusing rather than normalising, because either
spelling could be the intended one and guessing silently is what caused the
bug. Verified on a throwaway database: `abc-100` refused with `ABC-100` named
and no row written, `ABC-100` updates, product count unchanged at 2.

### 4. `db:push:remote` dropped the extension objects — Critical, fixed

Phase 3 made local `db:push` re-apply `src/db/extensions.sql`, because
`drizzle-kit push` drops every object in it on every run. The `:remote`
variant — the one that touches production — was left running bare
`drizzle-kit push`.

Two of those objects fail silently rather than loudly:

- `users_email_lower_key`: `createUser` decides "email-taken" purely by
  catching the unique violation, so without the index duplicate accounts are
  created without complaint.
- `invoice_seq`: recreated from scratch it restarts at 1 and re-issues
  `INV-2026-0001` against a partial unique index.

Fixed: `db:push:remote` now chains `db:extensions:remote`.

## Checked and clean

- **SQL injection.** Every user-reachable query uses postgres-js tagged-template
  parameters, including the facet filters, which are the largest untrusted
  surface. `sql.unsafe` appears only in the seed scripts, with literal SQL.
- **XSS.** No `dangerouslySetInnerHTML` anywhere.
- **Open redirects.** No `redirect()` interpolates anything but a validated
  locale; `safeLocale` is the single definition.
- **Public API routes.** `/api/cart` validates product ids as positive integers
  and clamps quantities; `/api/suggest` requires two characters and caches
  privately. Both are meant to be public.
- **New admin routes.** `/api/admin/family/[id]/{template,export}` gate on
  `isAdmin()` and return 404 rather than 401, so they do not confirm a family
  exists to someone signed out. Verified signed in and signed out.
- **`DEMO_MODE`.** `assertAdminWrite()` refuses every import write under it;
  the disabled buttons are cosmetic, the gate is real.
- No `TODO`/`FIXME`, no stray `console.log` outside seed and scripts, no
  `any` casts or `@ts-expect-error` in the Phase 5 code.

## Left open

- **No rate limiting** on sign-in or guest tracking (recorded in the spec).
- **A staff password reset does not end existing customer sessions** (recorded
  in the spec).
- **`DATABASE_URL` falls back to a localhost URL** rather than throwing. Unlike
  the two above this fails loudly on the first query, so it is a confusing
  error rather than a silent wrong behaviour.
- **A spec key named `price_usd`, `part_number`, `pack_qty`, `lead_days` or
  `in_stock`** would make `columnsFor` emit a duplicated column and the
  resulting template would be rejected on re-upload. No family has one today.
