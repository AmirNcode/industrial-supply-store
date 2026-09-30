import type { Config } from "drizzle-kit";

/**
 * Local only. `drizzle-kit push` has destroyed live objects four times (it
 * drops everything the schema file cannot express, RLS included — see
 * DEPLOYMENT.md), and `push`/`studio` target whatever the shell exports. So
 * this refuses any host but this machine; live schema changes are migration
 * files (`db:migrate:remote`). Review finding M-12.
 */
const url =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://isupply:isupply@localhost:5433/isupply";
const host = new URL(url).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  throw new Error(`drizzle-kit is local-only; refusing ${host}. Use a migration and db:migrate:remote.`);
}

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // DDL over a transaction-mode pooler is unreliable, so schema pushes prefer
    // the direct connection when one is configured. See src/db/script-client.ts.
    url,
  },
  verbose: true,
  // Not `strict`: that prompts before *every* statement, which stalls the
  // non-interactive CI bootstrap. drizzle-kit still prompts before data-loss
  // statements without it, and the host refusal above is the real guard.
  strict: false,
} satisfies Config;
