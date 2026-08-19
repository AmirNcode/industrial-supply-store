import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Serverless changes the pooling maths completely.
 *
 * One long-lived container can happily hold a dozen connections. A managed
 * functions platform runs many instances, so the same `max` multiplies by the
 * instance count and exhausts Postgres. Each instance therefore keeps a very
 * small pool and leans on the provider's connection pooler (Neon's `-pooler`
 * host, Supabase's pgBouncer port) to fan out.
 *
 * `prepare: false` is what makes that safe: transaction-mode poolers reject
 * prepared statements, because a statement prepared on one backend is not
 * visible to the next. It was originally set for jsonb payloads and happens to
 * be exactly the setting a pooler needs.
 *
 * `sql.begin()` in the RFQ submission is still fine — transaction mode is
 * precisely what pgBouncer supports.
 */
/**
 * The build is not serverless, even though it runs on Vercel.
 *
 * `VERCEL` is set during `next build` as well as at request time, so the build
 * used to take the two-connection request-time pool. It is the opposite case:
 * one long-lived process prerendering every page in the app, each needing
 * several queries, all funnelled through two connections. That is what made
 * the home pages time out during prerender — `/fa` exceeded the 60s budget and
 * had to be retried — and a build that slow is also a build that can fail.
 */
const isBuild = process.env.NEXT_PHASE === "phase-production-build";
const isServerless = Boolean(process.env.VERCEL || process.env.NETLIFY) && !isBuild;

/**
 * The build goes direct; requests go through the pooler.
 *
 * Transaction pooling exists for many short-lived function instances. A build
 * is the opposite — one long-lived process prerendering every page — and on
 * 2026-08-19 two consecutive deploys stalled there for exactly 120s at the
 * same point, both cancelled by the database's own `statement_timeout`. The
 * Postgres logs for that window show an idle server: two scheduled
 * checkpoints, no lock waits, no connection errors. The work was not the
 * problem and the pool was not the problem, so what stalled was the path
 * between `iad1` and `eu-central-1` — the extra pooler hop being the part of
 * it this repository can remove.
 *
 * `POSTGRES_URL_NON_POOLING` is set by the Vercel/Supabase integration in
 * every environment; `DIRECT_DATABASE_URL` is what the repository's own remote
 * scripts use. Either is the direct 5432 endpoint. Falling through to
 * `DATABASE_URL` means a missing direct URL costs nothing but the old
 * behaviour, and request-time pooling is deliberately left exactly as it was.
 *
 * `VERCEL` is load-bearing here, not belt-and-braces. `.env.local` is a
 * `vercel env pull`, so it holds `POSTGRES_URL_NON_POOLING` pointing at
 * production, and `next build` loads `.env.local`. Without this guard a local
 * `npm run build` would quietly prerender every page against the live
 * database.
 */
const isHostedBuild = isBuild && Boolean(process.env.VERCEL);
const connectionString =
  (isHostedBuild
    ? process.env.DIRECT_DATABASE_URL ?? process.env.POSTGRES_URL_NON_POOLING
    : undefined) ??
  process.env.DATABASE_URL ??
  "postgres://isupply:isupply@localhost:5433/isupply";

/**
 * Next dev reloads modules on every edit; without a global the pool would leak
 * a new set of connections per reload until Postgres refuses them.
 */
const globalForDb = globalThis as unknown as {
  __isupplySql?: ReturnType<typeof postgres>;
};

/**
 * Tuned against the 2026-08-15 production incident: requests hanging the full
 * 300s function budget while the database showed the same queries completing
 * in under two seconds. Two client-side causes, both addressed here:
 *
 *   `max: 2` starved warm instances. Fluid Compute routes several concurrent
 *   requests into one instance, a single family page runs six queries, and a
 *   queued query waits for a pool slot with no timeout — one slow or stale
 *   connection wedged everything behind it. Six connections give one instance
 *   room for two concurrent page renders; the provider's pooler (200 client
 *   connections) is what absorbs the instance count.
 *
 *   `idle_timeout: 10` churned connections instead of keeping them. The
 *   pooler's auth counter showed ~21k client connects in days — every reap is
 *   a TLS handshake, an auth round trip and a type fetch on the next query.
 *   20s keeps a warm instance's pool alive between a person's clicks.
 *
 * `keep_alive` sends TCP probes so a peer that silently dropped a connection
 * (pooler idle-out, NAT expiry while the instance was suspended) is detected
 * and the socket replaced, instead of a query being written into a black hole
 * — the one failure with no server-side timeout to catch it. `max_lifetime`
 * caps how long any socket lives, bounding how stale one can get.
 *
 * The database's own `statement_timeout` (120s on the hosted project) stays
 * the backstop for statements that genuinely run away; a client-set
 * `statement_timeout` was tested and does not survive the transaction pooler.
 */
export const sql =
  globalForDb.__isupplySql ??
  postgres(connectionString, {
    max: isServerless ? 6 : 12,
    idle_timeout: 20,
    max_lifetime: 60 * 5,
    keep_alive: 30,
    // Neon and Supabase free tiers suspend an idle database; the first query
    // after a quiet spell has to wait for it to wake.
    connect_timeout: isServerless ? 15 : 10,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__isupplySql = sql;

export const db = drizzle(sql, { schema });
export { schema };
