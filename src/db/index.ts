import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://isupply:isupply@localhost:5433/isupply";

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
    max: 12,
    idle_timeout: 20,
    // Spec tables are wide; do not truncate large jsonb payloads.
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__isupplySql = sql;

export const db = drizzle(sql, { schema });
export { schema };
