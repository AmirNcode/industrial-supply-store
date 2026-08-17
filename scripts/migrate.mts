import "dotenv/config";
import { spawnSync } from "node:child_process";

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("✗ No DIRECT_DATABASE_URL or DATABASE_URL set.");
  process.exit(1);
}

const parsedUrl = new URL(url);
const target = parsedUrl.hostname;
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "db", "host.docker.internal"]);
const dryRun = process.argv.includes("--dry-run");
const today = new Date().toISOString().slice(0, 10);

// The Supabase CLI assumes TLS for `--db-url`; the plain local Docker image
// intentionally has none. Hosted URLs keep their own SSL configuration.
if (localHosts.has(target) && !parsedUrl.searchParams.has("sslmode")) {
  parsedUrl.searchParams.set("sslmode", "disable");
}

// A remote migration is an intentionally gated operation. The dated value is
// short-lived so it cannot become a forgotten permanent bypass in an env file.
if (!dryRun && !localHosts.has(target) && process.env.MIGRATION_BACKUP_VERIFIED !== today) {
  console.error(
    `\n✗ Refusing to migrate remote host "${target}".\n\n` +
      "  Verify a restorable backup/PITR recovery point and a recent restore test, then run:\n\n" +
      `  MIGRATION_BACKUP_VERIFIED=${today} npm run db:migrate:remote\n`,
  );
  process.exit(1);
}

console.log(`→ ${dryRun ? "checking" : "migrating"}: ${target}`);
const args = ["db", "push", "--db-url", parsedUrl.toString()];
if (dryRun) args.push("--dry-run");

const result = spawnSync("supabase", args, { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
