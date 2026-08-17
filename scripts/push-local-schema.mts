import "dotenv/config";
import { spawnSync } from "node:child_process";
import { isLocalTarget, targetHost } from "@/db/script-client";

if (!isLocalTarget()) {
  console.error(
    `\n✗ Refusing schema push against remote host "${targetHost()}".\n\n` +
      "  Live databases use reviewed forward migrations: npm run db:migrate:remote\n",
  );
  process.exit(1);
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`→ empty/local schema bootstrap: ${targetHost()}`);
run("drizzle-kit", ["push"]);
run("tsx", ["scripts/apply-extensions.mts"]);
