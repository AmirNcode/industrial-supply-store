import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Database connection for CLI scripts (seed, reset), deliberately separate from
 * the app's connection in `./index.ts`.
 *
 * The two want opposite things. The app runs in many short-lived function
 * instances and must keep a tiny pool through a transaction-mode pooler. A
 * script is a single process doing bulk DDL and hundreds of thousands of
 * inserts, so it wants a large pool and a *direct* connection — DDL and bulk
 * loads through a transaction pooler are unreliable, and Supabase in particular
 * documents port 5432 for migrations and 6543 for application traffic.
 *
 * Hence `DIRECT_DATABASE_URL` takes precedence here and nowhere else.
 */
const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://isupply:isupply@localhost:5433/isupply";

/** Hosts we consider safe to drop and rebuild without an explicit override. */
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "db", // the docker-compose service name
  "host.docker.internal",
]);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function targetHost(): string {
  return hostOf(connectionString) || "unknown";
}

export function isLocalTarget(): boolean {
  return LOCAL_HOSTS.has(hostOf(connectionString));
}

/**
 * Refuses to run a destructive script against a remote database unless the
 * caller has explicitly opted in.
 *
 * Both of these scripts are routinely run with a `DATABASE_URL` already exported
 * in the shell. Getting that wrong once against a hosted database is
 * unrecoverable, and `reset` in particular runs `DROP SCHEMA public CASCADE` —
 * which on Supabase also destroys grants their own roles depend on.
 */
export function assertSafeTarget(action: string, overrideVar: string): void {
  if (isLocalTarget()) return;
  if (process.env[overrideVar] === "1") {
    console.warn(
      `⚠  ${action} targeting REMOTE host "${targetHost()}" (${overrideVar}=1)`,
    );
    return;
  }
  console.error(
    `\n✗ Refusing to ${action}.\n\n` +
      `  Target host: ${targetHost()}\n` +
      `  This is not a local database, and this command destroys data.\n\n` +
      `  If that is genuinely what you want, re-run with ${overrideVar}=1\n\n`,
  );
  process.exit(1);
}

export const sql = postgres(connectionString, {
  max: 12,
  idle_timeout: 20,
  // Matches the app: transaction-mode poolers reject prepared statements, and
  // a script may legitimately be pointed at a pooled URL.
  prepare: false,
});

export const db = drizzle(sql, { schema });
export { schema };
