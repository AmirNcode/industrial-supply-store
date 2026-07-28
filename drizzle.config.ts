import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://isupply:isupply@localhost:5433/isupply",
  },
  verbose: true,
  strict: false,
} satisfies Config;
