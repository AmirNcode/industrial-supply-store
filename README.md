# TEMEX — Tools, Equipment & Materials Express

A McMaster-Carr–style industrial parts catalog for the Iranian market, in
Persian and English with full RTL. Buyers browse dense spec tables, filter by
specification, and send their cart as an order; staff price it, issue an
invoice, and confirm the bank-transfer receipt. Customers have accounts, sales
reps have their own portal, and prices show in Rial, USD, or by language.

**The catalog is generated demo data.** Dimensions follow real standard
progressions, but this is not a certified reference table and must not be used
to select a real part. Prices are invented. The footer says so on every page.

## Run it locally

Requires Docker and Node 24+. The database runs in Docker; everything else runs
on the host.

```bash
docker compose up -d db
npm install
npm run db:bootstrap:local   # first time only: schema, indexes, demo catalog
npm run dev
```

Open http://localhost:3000 — it redirects to `/fa`; English is at `/en`. Admin
is at `/fa/admin` with `ADMIN_PASSWORD` from `.env`. After pulling code that
adds a migration, run `npm run db:migrate` instead of bootstrapping again.

Postgres is published on host port **5433**. [`docs/LOCAL-DEV.md`](docs/LOCAL-DEV.md)
explains each command, the Docker details, the quality gate, and what to check
when something will not connect.

## Where to read next

| | |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | How to work in this repository and how to report back. Coding agents start here. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Routes, the three auth systems, the invariants that bite, where things live. |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Vercel, the two Supabase projects, environment variables, migration order, and the traps that have already caused incidents. |
| [`docs/LOCAL-DEV.md`](docs/LOCAL-DEV.md) | Running it on a Mac, step by step. |

## Stack

Next.js 16 App Router (Server Components and Server Actions), PostgreSQL 17
with hand-written SQL through postgres-js, Drizzle for the schema definition
only, Tailwind CSS v4 with logical properties so RTL mirrors for free, and
`node:test` plus Playwright for tests. Deployed on Vercel; the client's
production instance will be self-hosted with `docker-compose.yml`.

## Known gaps

- `/admin` is one shared password: no named staff accounts, no MFA. The audit
  trail records "admin", not a person.
- No email or SMS. Customer email addresses are never verified (see
  `docs/DEPLOYMENT.md`, "Open before the next deploy").
- Product imagery is in-house SVG line art wherever no picture has been set.
- Run `npm run audit:prod` before releases.
