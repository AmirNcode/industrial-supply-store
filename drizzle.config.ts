import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // DDL over a transaction-mode pooler is unreliable, so schema pushes prefer
    // the direct connection when one is configured. See src/db/script-client.ts.
    url:
      process.env.DIRECT_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgres://isupply:isupply@localhost:5433/isupply",
  },
  verbose: true,
  strict: false,
} satisfies Config;
