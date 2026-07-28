/**
 * Lists spec values that render as English in the Persian UI.
 *
 * Run after changing the taxonomy: `npm run i18n:missing`
 *
 * Standard designations are expected in the output and should stay untranslated
 * — thread sizes (M12 x 1.75, #10-24), NEMA/ANSI/ISO ratings, filter classes
 * (N95, P100), garment sizes, belt sections, and tolerances (±0.001") are
 * identifiers that Iranian buyers match against manufacturer literature in
 * Latin. What matters is that no descriptive *word* appears in this list.
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";

const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://isupply:isupply@localhost:5433/isupply",
);

const src = readFileSync("src/lib/specValues.ts", "utf8");
const known = new Set(
  [...src.matchAll(/^\s*"?([^":\n]+)"?:\s*"/gm)].map((m) => m[1].trim()),
);

const rows = await sql`
  SELECT DISTINCT v.val_text
  FROM product_spec_values v
  JOIN spec_defs d ON d.family_id = v.family_id AND d.key = v.spec_key
  WHERE d.kind = 'text'
`;

const missing = rows
  .map((r) => r.val_text)
  .filter(
    (v) =>
      !known.has(v) &&
      !/^[\d.,\-\/×x\s"']+$/.test(v) && // pure dimensions
      !/^-?\d/.test(v), // leading-digit designations
  )
  .sort();

console.log(`${missing.length} spec values render as English in /fa:\n`);
console.log(missing.join("\n"));
await sql.end();
