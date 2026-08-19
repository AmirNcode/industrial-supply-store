import "dotenv/config";
import {
  derivedIntegrityProblems,
  inspectDatabaseIntegrity,
  integrityProblems,
  reconcileDerivedData,
} from "@/db/dataIntegrity";
import { isLocalTarget, sql, targetHost } from "@/db/script-client";

const args = new Set(process.argv.slice(2));
const unknown = [...args].filter((arg) => arg !== "--apply");
if (unknown.length > 0) {
  console.error(`✗ Unknown argument(s): ${unknown.join(", ")}`);
  process.exit(2);
}

const apply = args.has("--apply");
const today = new Date().toISOString().slice(0, 10);

function assertApplyAuthorized(): void {
  if (isLocalTarget()) {
    if (process.env.RECONCILIATION_APPLY_CONFIRMED === "1") return;
    throw new Error(
      "Refusing local reconciliation without RECONCILIATION_APPLY_CONFIRMED=1",
    );
  }

  if (
    process.env.MIGRATION_BACKUP_VERIFIED !== today ||
    process.env.RECONCILIATION_APPLY_CONFIRMED !== today
  ) {
    throw new Error(
      `Refusing remote reconciliation on ${targetHost()}. Verify a restorable backup/PITR point, ` +
        `review the check output, then set MIGRATION_BACKUP_VERIFIED=${today} and ` +
        `RECONCILIATION_APPLY_CONFIRMED=${today}.`,
    );
  }
}

async function main(): Promise<void> {
  const target = targetHost();
  console.log(`→ ${apply ? "reconciling" : "checking"}: ${target}`);

  if (!apply) {
    const report = await inspectDatabaseIntegrity(sql);
    const problems = integrityProblems(report);
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), target, report }, null, 2));
    if (problems.length > 0) {
      console.error(`\n✗ integrity problems:\n- ${problems.join("\n- ")}`);
      if (derivedIntegrityProblems(report).length > 0) {
        console.error("\n  Review the report, then use the explicitly gated --apply command.");
      }
      process.exitCode = 1;
    } else {
      console.log("\n✓ canonical and derived data agree");
    }
    return;
  }

  assertApplyAuthorized();
  const result = await sql.begin((tx) => reconcileDerivedData(tx));
  console.log(
    JSON.stringify(
      { reconciledAt: new Date().toISOString(), target, ...result },
      null,
      2,
    ),
  );
  console.log("\n✓ derived data reconciled and verified in one transaction");
}

main()
  .catch((error) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
