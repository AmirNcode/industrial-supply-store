/**
 * Local demo data for instant checkout, so every path can be walked by hand:
 * a family that is on the shelf (pish-factor at once), one with only three of
 * each on the shelf (over-stock → back order), one bought from a supplier
 * (always a quote), and one with no list prices (held, awaiting a quote).
 *
 * It also fills in what a pish-factor cannot be issued without and a fresh
 * local database lacks: the seller's contact details, a VAT rate and a bank
 * account — a made-up one, labelled as such.
 *
 * Local databases only. Safe to run again: it sets values, it does not add
 * rows. It changes stock counts and prices on the four families it names and
 * nothing else; `npm run db:bootstrap:local` puts the catalog back.
 */
import "dotenv/config";
import { isLocalTarget, sql, targetHost } from "../src/db/script-client";

if (!isLocalTarget()) {
  console.error(`✗ Refusing to seed checkout demo data into non-local host "${targetHost()}".`);
  process.exit(1);
}

const SETTINGS: Record<string, string> = {
  site_contact_email: "sales@temex.ir",
  site_contact_phone: "+98 912 277 4518",
  vat_rate_bp: "1000",
  bank_name_en: "Demo Bank (not a real account)",
  bank_name_fa: "بانک نمونه (حساب واقعی نیست)",
  bank_holder_en: "TEMEX Demo",
  bank_holder_fa: "تیمکس — نمونه",
  bank_account: "0000-1111-2222",
  bank_note_en: "Local demo data. Do not send money to this account.",
  bank_note_fa: "داده آزمایشی. به این حساب پولی واریز نکنید.",
};

const FAMILIES = {
  onShelf: "disposable-respirators",
  scarce: "industrial-degreasers",
  supplier: "corrugated-boxes",
  unpriced: "wire-markers",
} as const;

async function familyId(slug: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`SELECT id FROM product_families WHERE slug = ${slug}`;
  if (!row) throw new Error(`Family "${slug}" is not in this catalog — run npm run db:seed first.`);
  return row.id;
}

await sql.begin(async (tx) => {
  for (const [key, value] of Object.entries(SETTINGS)) {
    await tx`
      INSERT INTO app_settings (key, value, updated_at) VALUES (${key}, ${value}, now())
      ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = now()
    `;
  }
});

// `inventory_available` is the shelf; on-hold and sold are derived from orders
// and are left alone, so the inventory ledger check stays green.
await sql`UPDATE products SET in_stock = true, inventory_available = 25 WHERE family_id = ${await familyId(FAMILIES.onShelf)}`;
await sql`UPDATE products SET in_stock = true, inventory_available = 3 WHERE family_id = ${await familyId(FAMILIES.scarce)}`;
await sql`UPDATE products SET in_stock = false, inventory_available = 0 WHERE family_id = ${await familyId(FAMILIES.supplier)}`;
await sql`
  UPDATE products SET in_stock = true, inventory_available = 10, price_cents = 0, price_tiers = '[]'::jsonb
  WHERE family_id = ${await familyId(FAMILIES.unpriced)}
`;

console.log("✓ checkout demo data ready (local only)\n");
console.log(`  pish-factor at once     /en/f/${FAMILIES.onShelf}   (25 of each on the shelf)`);
console.log(`  over stock → back order /en/f/${FAMILIES.scarce}   (3 of each; order more than 3)`);
console.log(`  supplier → quote        /en/f/${FAMILIES.supplier}`);
console.log(`  no price → quote        /en/f/${FAMILIES.unpriced}`);
console.log("\n  Emails are not sent locally: read them at /en/admin/emails.");
await sql.end();
