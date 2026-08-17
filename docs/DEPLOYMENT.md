# Deployment

Everything needed to deploy this project, and the traps that have actually bitten
it. Read the traps before running any database command — every one of them was
found the hard way, and most fail silently.

## Where it deploys

| | |
| --- | --- |
| Host | **Vercel**, project `industrial-supply`, region `fra1` |
| Production branch | `main` — pushing to it deploys |
| Config | `vercel.ts` (committed). No `netlify.toml`; this is not a Netlify project |

## The two databases

There are two Supabase projects, and they are not interchangeable:

- **`myyjeiujwtkwlemidvow`** — the **live demo**. This is what Vercel serves.
- **`fgfbyqkgdmxmiywhxpfk`** — scratch, for local testing alongside Docker.

The client's real production instance will be **fully self-hosted on their own
servers**, so neither of these is the eventual production database. Anything
written here about Supabase specifics (poolers, IPv6, the REST API) applies to
the demo, not to the self-hosted target.

## Environment variables

Set in Vercel → Settings → Environment Variables → Production.

| Variable | Needed at | Missing → |
| --- | --- | --- |
| `DATABASE_URL` | **build and runtime** | build fails |
| `AUTH_SECRET` | **build and runtime** | **build fails** |
| `ADMIN_PASSWORD` | runtime | build fine, `/admin` throws |
| `USD_TO_TOMAN` | runtime | falls back to a hardcoded rate |
| `SELLER_*` | runtime | invoices print "set SELLER_NAME" |
| `SUPABASE_URL` | runtime Storage access | URL images still work; image/CSV upload reports not configured |
| `SUPABASE_PUBLIC_URL` | runtime Storage access | falls back to `SUPABASE_URL` |
| `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY` | runtime CSV import | signed browser upload reports not configured |
| `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` | runtime Storage access | image/CSV upload reports not configured |
| `SUPABASE_CATALOG_BUCKET` | runtime image upload | defaults to public `catalog-images` |
| `SUPABASE_IMPORT_BUCKET` | runtime CSV import | defaults to private `catalog-imports` |

`AUTH_SECRET` is the surprising one. `src/lib/session.ts` resolves it at module
import, so `next build` needs it during "Collecting page data" — not only the
running server. That is deliberate: a deploy that fails is better than a
customer who cannot sign in. Generate with `openssl rand -base64 32`.

`ADMIN_PASSWORD` must not be `changeme`. Production refuses both an unset value
and the example value, because `/admin` exposes every customer's name, email,
phone and address, issues invoices, resets customer passwords, exports the full
price list and can overwrite the catalog.

`DATABASE_URL` must be the **transaction pooler** (port `6543`).

## Database setup

Credentials live in `.env.production.local` (gitignored, never committed):

```
DATABASE_URL=<transaction pooler, port 6543>
DIRECT_DATABASE_URL=<session pooler, port 5432>
```

Initialized databases use only the forward migration ledger. Run **in this
order**:

```bash
npm run db:verify:remote        # what state is it in?
npm run db:migrate:check:remote # dry-run: prints the exact pending files
# Verify a restorable backup/PITR recovery point and a recent restore test.
MIGRATION_BACKUP_VERIFIED=YYYY-MM-DD npm run db:migrate:remote
npm run db:verify:remote        # confirm
```

`YYYY-MM-DD` must be today's UTC date. The migration command refuses a remote
write without it, which prevents a forgotten value in an env file becoming a
permanent bypass. Migration files are applied in timestamp order and recorded
in `supabase_migrations.schema_migrations`; a second run is a no-op.

A healthy result:

```
tables      13/13 ✓
columns     17/17 ✓
extensions.sql 12/12 ✓
submission key unique index ✓
migration ledger 20260817010000 ✓
migration ledger 20260817020000 ✓
invoice_seq ✓
search fns  4/4 ✓
row-level security ✓ on every table
✓ database looks correct
```

---

## Traps

### 0. Migration history starts at the adoption point

The live demo predates migration files. Its 2026-08-17 schema was verified to
already contain the earlier inventory, order-comments, dynamic-column and
catalog-media work, so those objects form the baseline rather than migrations
that would be replayed over live data. The first tracked forward migration is
`20260817010000_add_order_submission_key.sql`; the request-rate-limit table is
the next migration, `20260817020000_add_request_rate_limits.sql`.

Do not manufacture old ledger entries or replay the historical one-off scripts.
If a verifier reports baseline drift, stop and compare the actual schema before
choosing a repair. Every new schema change from this point gets a timestamped
file in `supabase/migrations`.

### 1. `drizzle-kit push` destroys things it cannot express

This has bitten the project three separate times. Push reconciles by diffing the
live database against `src/db/schema.ts`. Anything real that the schema file
cannot describe reads as drift, and push removes it:

- every index in `src/db/extensions.sql` (full-text, trigram, expression, partial)
- `invoice_seq` — **recreated from scratch it restarts at 1 and re-issues
  `INV-2026-0001`** against a unique index
- `users_email_lower_key` — without it `createUser` stops detecting duplicate
  accounts entirely, because it decides "email-taken" purely by catching the
  unique violation
- **row-level security on every table** — push emits
  `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` for each one

Two of those fail *silently*. Nothing looks wrong afterwards.

The mitigation: everything push cannot model lives in `src/db/extensions.sql`.
`db:push` is now an empty/local-bootstrap wrapper that refuses a remote host and
re-applies this file automatically. There is no `db:push:remote`; initialized
databases use `db:migrate:remote` only.
`scripts/apply-extensions.mts` then verifies 12/12 index objects plus the four catalog_* search functions, realigns
`invoice_seq` past whatever has been issued, and fails if any table lost RLS.

**Never run bare `drizzle-kit push` against live data.** If it was run locally,
immediately run `npm run db:extensions` and verify the database.

### 2. Rename before you push, never after

`quotes` → `orders` is a rename. To a diffing tool it is indistinguishable from
"drop `quotes`, create `orders`", which destroys every submitted order.

`npm run db:verify:remote` still warns when `quotes` exists because a very old
database may predate the rename. Stop and review that exceptional upgrade; do
not substitute a schema push. The retained `db:rename-orders:remote` command is
historical recovery tooling, not part of the normal release path.

### 3. Empty bootstrap and live migration are different commands

The old `db:setup:remote` and `db:seed:remote` convenience commands were
removed: they made a catalog-wide `TRUNCATE ... CASCADE` look like a normal
upgrade. Existing databases use `db:migrate:remote`, which never seeds.

A brand-new database can use:

```bash
EMPTY_DATABASE_CONFIRMED=1 npm run db:bootstrap:empty:remote
```

The script queries the target first and refuses if `public` has even one table;
there is no force flag. It then creates the schema, applies extensions, records
the forward migration ledger, and seeds the initial demo catalog. Local rebuilds
use `npm run db:bootstrap:local` and retain the existing local-only destruction
guard.

### 3a. Backups are a release gate, not a suggestion

Before a remote migration, verify that the target has a restorable backup/PITR
recovery point and that the restore procedure has been exercised recently. Only
then pass today's UTC date as `MIGRATION_BACKUP_VERIFIED`. A dry run never needs
the acknowledgement because it performs no write.

### 4. Row-level security is correct here, and push fights it

RLS on with **no policies** is the intended posture for the demo. Supabase
exposes these same tables over a REST API reached with a key that ships in
browser code; with RLS off, that key reads every order and customer directly,
bypassing the app.

The app is unaffected: it connects over raw Postgres as the role that **owns**
the tables, and an owner bypasses RLS. Verified by enabling RLS on a full local
copy and exercising reads, writes, search, cart and admin.

Because push turns it off, the enable lives in `extensions.sql` and both
`apply-extensions` and `db:verify:remote` fail rather than assume.

The future self-hosted Supabase stack can expose the same REST and Storage APIs,
so keeping RLS enabled and keeping service credentials out of browser code
remain required there too.

### 4a. Large catalog imports use a private bucket

The admin importer does not send a CSV through a Server Action or Vercel request
body. It asks `/api/admin/import` for a short-lived signed upload URL, uploads
directly from the browser to the private `SUPABASE_IMPORT_BUCKET`, then sends a
small signed handle back for review/apply. The server downloads the object,
verifies the claimed byte size and family, and removes it after a terminal
result. A later prepare request sweeps abandoned objects older than three hours.

The browser receives only the publishable/anon key and a path-specific signed
upload token. The secret/service-role key stays server-side. Keep the import
bucket distinct from the public catalog-image bucket; startup validation rejects
a shared name. The importer accepts at most 24 MB and 20,000 data rows.

### 5. Supabase's direct host is IPv6-only

`db.<ref>.supabase.co:5432` resolves to IPv6 and is unreachable from most home
and office connections (`EHOSTUNREACH`). Use the **session pooler**
(`aws-0-<region>.pooler.supabase.com:5432`) for `DIRECT_DATABASE_URL`. Same
credentials, same username format `postgres.<ref>`, different host and port.

A cold Supabase tenant can also refuse the first connection with
`password authentication failed` and accept the next one. Retry before assuming
the password is wrong.

### 6. Verifying storage is not verifying rendering

Two separate bugs in this project were "the value is correct in the database"
while the page rendered something else — the frozen FX rate, and the invoice
access check. Check the rendered HTML, not just the row.

Related: `grep -c` counts *lines*. Rendered HTML is one line, so every count is
`1` and means nothing. Use `grep -o … | wc -l`, or grep for a marker that only
appears in the case you are testing.
