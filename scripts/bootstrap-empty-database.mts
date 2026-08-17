import "dotenv/config";
import { spawnSync } from "node:child_process";
import { sql, targetHost } from "@/db/script-client";

if (process.env.EMPTY_DATABASE_CONFIRMED !== "1") {
  console.error(
    "\n✗ Empty-database bootstrap requires EMPTY_DATABASE_CONFIRMED=1.\n" +
      "  This command is for a brand-new database only; live upgrades use db:migrate:remote.\n",
  );
  process.exit(1);
}

const [{ tables }] = await sql<{ tables: number }[]>`
  SELECT count(*)::int AS tables
  FROM pg_tables
  WHERE schemaname = 'public'
`;
if (tables !== 0) {
  console.error(
    `\n✗ Refusing empty bootstrap on ${targetHost()}: public already has ${tables} table(s).\n` +
      "  No override exists. Use reviewed forward migrations for an initialized database.\n",
  );
  await sql.end();
  process.exit(1);
}
await sql.end();

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("No DIRECT_DATABASE_URL or DATABASE_URL set");
const migrationUrl = new URL(url);
if (["localhost", "127.0.0.1", "::1", "0.0.0.0", "db", "host.docker.internal"].includes(migrationUrl.hostname)) {
  if (!migrationUrl.searchParams.has("sslmode")) migrationUrl.searchParams.set("sslmode", "disable");
}

function run(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`→ confirmed empty database: ${targetHost()}`);
run("drizzle-kit", ["push"]);
run("tsx", ["scripts/apply-extensions.mts"]);
run("supabase", ["db", "push", "--db-url", migrationUrl.toString()]);
run("tsx", ["src/seed/index.ts"], { ALLOW_REMOTE_SEED: "1" });
console.log("✓ empty database bootstrapped; future changes must use db:migrate:remote");
