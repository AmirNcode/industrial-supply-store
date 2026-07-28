import "dotenv/config";
import { sql } from "@/db";

/** Drops everything so `drizzle-kit push` can rebuild from a clean slate. */
async function main() {
  await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  console.log("✓ schema dropped and recreated");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
