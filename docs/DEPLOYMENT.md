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

Then, **in this order**:

```bash
npm run db:verify:remote        # what state is it in?
npm run db:rename-orders:remote # ONLY if `quotes` still exists
npm run db:push:remote          # schema + re-applies extensions.sql
npm run db:verify:remote        # confirm
```

A healthy result:

```
tables      11/11 ✓
extensions.sql 11/11 ✓
invoice_seq ✓
row-level security ✓ on every table
✓ database looks correct
```

---

## Traps

### 0. A schema change is pending for the live demo

The 2026-08-06 work added `products.inventory_available` / `_on_hold` / `_sold`
and the `order_comments` table. The live demo does not have them yet. Before
that release is deployed:

```bash
npm run db:push:remote && npm run db:verify:remote
```

Until then the deployed build will error on any admin order or products page.

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

The mitigation: everything push cannot model lives in `src/db/extensions.sql`,
and both `db:push` and `db:push:remote` chain the re-apply automatically.
`scripts/apply-extensions.mts` then verifies 11/11 objects, realigns
`invoice_seq` past whatever has been issued, and fails if any table lost RLS.

**If you ever run bare `drizzle-kit push`, run `npm run db:extensions` (or
`db:extensions:remote`) immediately after.**

### 2. Rename before you push, never after

`quotes` → `orders` is a rename. To a diffing tool it is indistinguishable from
"drop `quotes`, create `orders`", which destroys every submitted order.

`npm run db:verify:remote` warns when `quotes` still exists. If it does, run
`db:rename-orders:remote` **first**. That script renames rather than drops, runs
entirely in one transaction, and is safe to run twice.

### 3. `db:setup:remote` truncates

It sits next to the other `:remote` scripts and looks like a setup convenience.
It runs the seeder, which begins with `TRUNCATE ... CASCADE` — the whole
catalog, every cart and every order. Only use it on a genuinely empty database.

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

This trap disappears on the self-hosted instance, which has no REST API — but
leaving RLS on there costs nothing.

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
