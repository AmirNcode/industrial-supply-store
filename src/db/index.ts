import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://isupply:isupply@localhost:5433/isupply";

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
const isServerless = Boolean(process.env.VERCEL || process.env.NETLIFY);

/**
 * Next dev reloads modules on every edit; without a global the pool would leak
 * a new set of connections per reload until Postgres refuses them.
 */
const globalForDb = globalThis as unknown as {
  __isupplySql?: ReturnType<typeof postgres>;
};

export const sql =
  globalForDb.__isupplySql ??
  postgres(connectionString, {
    max: isServerless ? 2 : 12,
    idle_timeout: isServerless ? 10 : 20,
    // Neon and Supabase free tiers suspend an idle database; the first query
    // after a quiet spell has to wait for it to wake.
    connect_timeout: isServerless ? 15 : 10,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__isupplySql = sql;

export const db = drizzle(sql, { schema });
export { schema };
