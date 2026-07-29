import "dotenv/config";
import { sql, assertSafeTarget, targetHost } from "@/db/script-client";

/**
 * Drops everything so `drizzle-kit push` can rebuild from a clean slate.
 *
 * `DROP SCHEMA public CASCADE` is safe against the local container and
 * catastrophic against a hosted database — on Supabase the public schema also
 * carries grants their own roles rely on. The guard is the point of this file.
 */
async function main() {
  assertSafeTarget("drop and recreate the public schema", "ALLOW_REMOTE_RESET");

  await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  console.log(`✓ schema dropped and recreated on ${targetHost()}`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
