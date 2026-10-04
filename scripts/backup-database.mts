import "dotenv/config";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * A plain-SQL copy of the app's data, written to db_backups/<host>-<UTC time>.sql.
 *
 * The live project is on Supabase's Free plan, which keeps no backups at all,
 * so this is the backup DEPLOYMENT.md asks for before `db:migrate:remote`.
 * Read-only against the database.
 *
 * pg_dump runs in Docker (`postgres:17`), so nothing needs installing, and a
 * version-17 pg_dump can read any server up to 17 — Supabase's 15 and 17, the
 * local container, and the self-hosted server to come. `supabase db dump` was
 * the obvious tool but works only against Supabase: it switches to a role
 * plain Postgres does not have.
 *
 * Only what the app owns: the `public` schema and Supabase's migration ledger.
 * Supabase's own schemas (auth, storage, …) are theirs to restore. Owners and
 * grants are left out so the file restores into any empty database with
 * `psql -f`, followed by `db:extensions`: extensions such as pg_trgm belong to
 * the database, not a schema, so the five trigram search indexes fail on
 * restore until it runs (checked 2026-10-04 on the local container: row counts
 * matched and the part-number trigger came back). The folder is gitignored; it holds customer names, phones and
 * password hashes, so it stays on this machine.
 */

const IMAGE = "postgres:17-alpine";

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("✗ No DIRECT_DATABASE_URL or DATABASE_URL set.");
  process.exit(1);
}

const parsedUrl = new URL(url);
const host = parsedUrl.hostname;
// Inside the container, "localhost" is the container itself.
if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
  parsedUrl.hostname = "host.docker.internal";
  if (!parsedUrl.searchParams.has("sslmode")) parsedUrl.searchParams.set("sslmode", "disable");
}

const hasLedger = spawnSync("docker", ["run", "--rm", IMAGE, "psql", parsedUrl.toString(), "-tAc",
  "SELECT 1 FROM pg_namespace WHERE nspname = 'supabase_migrations'"], { encoding: "utf8" });
if (hasLedger.status !== 0) {
  console.error(hasLedger.stderr.trim() || "✗ Could not reach the database (is Docker running?).");
  process.exit(1);
}
const schemas = ["public", ...(hasLedger.stdout.trim() === "1" ? ["supabase_migrations"] : [])];

// Owner-only: the dump holds customer data and password hashes. chmod as well,
// for a folder that already existed with looser permissions.
mkdirSync("db_backups", { recursive: true, mode: 0o700 });
chmodSync("db_backups", 0o700);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const file = join("db_backups", `${host.split(".")[0]}-${stamp}.sql`);
console.log(`→ backing up ${schemas.join(" + ")} on ${host} into ${file}`);

const out = openSync(file, "wx", 0o600);
const result = spawnSync(
  "docker",
  ["run", "--rm", IMAGE, "pg_dump", parsedUrl.toString(),
    ...schemas.flatMap((schema) => ["--schema", schema]),
    "--no-owner", "--no-privileges"],
  { stdio: ["ignore", out, "inherit"] },
);
closeSync(out);

// pg_dump writes its completion marker last; without it the file is a
// partial dump that looks like a whole one.
const complete =
  result.status === 0 && readFileSync(file, "utf8").includes("-- PostgreSQL database dump complete");
if (!complete) {
  unlinkSync(file);
  console.error("✗ Backup failed; nothing kept. Do not migrate.");
  process.exit(1);
}
console.log(`✓ ${file} (${(statSync(file).size / 1024).toFixed(0)} KB)`);
