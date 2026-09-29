/**
 * Local demo data for the sales-rep feature: two reps, fifteen customers of
 * every origin, sixty orders across the last fourteen Persian months in every
 * status, notes, follow-ups, payouts and targets — so the dashboards have
 * something to show without walking sixty orders through the admin by hand.
 *
 * Local databases only. Re-running replaces this script's own rows (reps named
 * demo.*, customers with demo.*@example.invalid emails, their orders) and
 * touches nothing else. Stock counts for every product those orders used are
 * then re-derived from the order ledger — the same repair db:reconcile:apply
 * makes — so the integrity checks stay green.
 *
 * Demo sign-in, local database only:
 *   reps       demo.sara · demo.reza    password Demo-Rep-1405!
 *   customers  the IDs printed at the end  password Demo-Customer-1405!
 */
import "dotenv/config";
import { isLocalTarget, sql, targetHost } from "../src/db/script-client";
import { reconcileInventoryForProducts } from "../src/db/dataIntegrity";
import { hashPassword } from "../src/lib/password";
import { normalizeRepPassword } from "../src/lib/repPassword";
import { codeFromPhone } from "../src/lib/customerCode";
import { randomReferralCode } from "../src/lib/repAccount";
import { persianYearMonth } from "../src/lib/persianCalendar";

if (!isLocalTarget()) {
  console.error(`✗ Refusing to seed demo sales reps into non-local host "${targetHost()}".`);
  process.exit(1);
}

const REP_PASSWORD = "Demo-Rep-1405!";
const CUSTOMER_PASSWORD = "Demo-Customer-1405!";
const DAY = 24 * 60 * 60 * 1000;
const COMPANIES = [
  "Pars Hydraulic", "Kaveh Valves", "Tabriz Pumps", "Sepahan Steel", "Arya Seals",
  "Alborz Pipe", "Khazar Marine", "Zagros Mining", "Shiraz Petro", "Mashhad Gears",
  "Yazd Textiles", "Qom Fittings", "Ahvaz Drilling", "Rasht Foods", "Kerman Copper",
];
const OPEN_STATUSES = ["received", "invoiced", "preparing", "shipped", "cancelled"] as const;

// Deterministic, so every run produces the same shape of data.
let state = 1405;
function random(): number {
  state = (state * 16807) % 2147483647;
  return (state - 1) / 2147483646;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

const [repHash, customerHash] = await Promise.all([
  hashPassword(normalizeRepPassword(REP_PASSWORD)),
  hashPassword(CUSTOMER_PASSWORD),
]);

const printed = await sql.begin(async (tx) => {
  const demoOrders = tx`
    SELECT o.id FROM orders o
    WHERE o.rep_id IN (SELECT id FROM sales_reps WHERE username LIKE 'demo.%')
       OR o.user_id IN (SELECT id FROM users WHERE email LIKE 'demo.%@example.invalid')`;
  const touched = await tx<{ productId: number }[]>`
    SELECT DISTINCT product_id AS "productId" FROM order_items
    WHERE product_id IS NOT NULL AND order_id IN (${demoOrders})`;
  await tx`DELETE FROM orders WHERE id IN (${demoOrders})`;
  await tx`DELETE FROM users WHERE email LIKE 'demo.%@example.invalid'`;
  await tx`DELETE FROM rep_payouts WHERE rep_id IN (SELECT id FROM sales_reps WHERE username LIKE 'demo.%')`;
  await tx`DELETE FROM sales_reps WHERE username LIKE 'demo.%'`;

  const reps: { id: string; username: string; rateBp: number }[] = [];
  for (const [username, name, rateBp, phone] of [
    ["demo.sara", "Sara Ahmadi", 250, "0912 410 2233"],
    ["demo.reza", "Reza Karimi", 400, "0935 118 4455"],
  ] as const) {
    const [rep] = await tx<{ id: string }[]>`
      INSERT INTO sales_reps (username, password_hash, name, phone, commission_rate_bp,
                              referral_code, must_change_password)
      VALUES (${username}, ${repHash}, ${name}, ${phone}, ${rateBp}, ${randomReferralCode()}, false)
      RETURNING id`;
    reps.push({ id: rep.id, username, rateBp });
  }

  const customers: { id: string; code: string; company: string; rep: (typeof reps)[number]; earns: boolean }[] = [];
  for (let i = 0; i < COMPANIES.length; i++) {
    const rep = reps[i % reps.length];
    const origin = i < 8 ? "rep" : i < 12 ? "referral" : "self";
    // Self sign-ups start without commission; the last one has had it switched on.
    const earns = origin !== "self" || i === COMPANIES.length - 1;
    const phone = `0912${String(4_100_000 + i * 7919)}`;
    const followUp = i % 4 === 0 ? -1 : i % 4 === 1 ? 3 : null;
    const [customer] = await tx<{ id: string; code: string }[]>`
      INSERT INTO users (email, password_hash, company, contact_name, phone, locale, customer_code,
                         rep_id, origin, origin_rep_id, rep_earns_commission, next_follow_up_on)
      VALUES (${`demo.c${i}@example.invalid`}, ${customerHash}, ${COMPANIES[i]}, ${`Buyer ${i + 1}`},
              ${phone}, 'fa', ${codeFromPhone(phone)!}, ${rep.id}, ${origin},
              ${origin === "self" ? null : rep.id}, ${earns},
              ${followUp === null ? null : new Date(Date.now() + followUp * DAY).toISOString().slice(0, 10)})
      RETURNING id, customer_code AS code`;
    customers.push({ id: customer.id, code: customer.code, company: COMPANIES[i], rep, earns });
    if (i < 5) {
      await tx`
        INSERT INTO customer_notes (user_id, author_rep_id, body)
        VALUES (${customer.id}, ${rep.id}, 'Called — interested in O-rings and gate valves.'),
               (${customer.id}, ${rep.id}, 'Sent the catalog link; follow up next week.')`;
    }
  }

  const products = await tx<{ id: number; partNumber: string; priceCents: number; familyName: string }[]>`
    SELECT p.id, p.part_number AS "partNumber", p.price_cents AS "priceCents", f.name_fa AS "familyName"
    FROM products p JOIN product_families f ON f.id = p.family_id
    WHERE p.price_cents > 0 ORDER BY p.id LIMIT 40`;
  if (products.length === 0) throw new Error("No priced products — run npm run db:seed first.");

  const now = Date.now();
  for (let n = 0; n < 60; n++) {
    const customer = pick(customers);
    const created = new Date(now - (10 + Math.floor(random() * 410)) * DAY);
    // ISO text, not Date: the script client passes values through untouched
    // (drizzle replaces postgres-js's date serializers), and a Date is refused.
    const at = (days: number) => new Date(created.getTime() + days * DAY).toISOString();
    const status = n < 44 ? "delivered" : pick(OPEN_STATUSES);
    const invoiced = !["received", "cancelled"].includes(status);
    const paid = ["preparing", "shipped", "delivered"].includes(status);
    const shipped = ["shipped", "delivered"].includes(status);
    const lines = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
      product: pick(products),
      qty: 1 + Math.floor(random() * 20),
    }));
    const total = lines.reduce((sum, line) => sum + line.product.priceCents * line.qty, 0);
    const [order] = await tx<{ id: number }[]>`
      INSERT INTO orders (ref, company, contact_name, email, phone, locale, currency, total_cents,
                          requested_total_cents, status, user_id, rep_id, commission_rate_bp,
                          placed_by_rep, invoice_number, fx_rate_to_rial,
                          created_at, invoiced_at, paid_at, shipped_at, delivered_at)
      VALUES (${`ORD-DEMO${String(n).padStart(3, "0")}`}, ${customer.company}, 'Buyer',
              ${`demo.c-order@example.invalid`}, '', 'fa', 'IRR', ${total}, ${total}, ${status},
              ${customer.id}, ${customer.rep.id}, ${customer.earns ? customer.rep.rateBp : 0},
              ${n % 3 === 0},
              ${invoiced ? tx`(SELECT 'INV-' || to_char(${at(1)}::timestamptz, 'YYYY') || '-' || lpad(s.n::text, greatest(4, length(s.n::text)), '0') FROM (SELECT nextval('invoice_seq') AS n) s)` : null},
              ${invoiced ? 1_000_000 + Math.floor(random() * 100_000) : null},
              ${created.toISOString()}::timestamptz, ${invoiced ? at(1) : null}::timestamptz,
              ${paid ? at(3) : null}::timestamptz, ${shipped ? at(5) : null}::timestamptz,
              ${status === "delivered" ? at(9) : null}::timestamptz)
      RETURNING id`;
    for (const line of lines) {
      await tx`
        INSERT INTO order_items (order_id, product_id, part_number, family_name, qty,
                                 unit_price_cents, requested_unit_price_cents)
        VALUES (${order.id}, ${line.product.id}, ${line.product.partNumber}, ${line.product.familyName},
                ${line.qty}, ${line.product.priceCents}, ${line.product.priceCents})`;
    }
  }

  const current = persianYearMonth(new Date(now));
  const yearAgo = persianYearMonth(new Date(now - 365 * DAY));
  // Payouts and targets follow the demo's own scale, so "owed" stays positive
  // and a target bar reads as a plausible share of a month's sales. The money
  // is computed in SQL with the same formula as db/repMoney.ts.
  const money = await tx<{ repId: string; earned: number; sales: number }[]>`
    SELECT o.rep_id AS "repId",
           SUM(ROUND(o.total_cents::numeric * o.fx_rate_to_rial * o.commission_rate_bp / 1000000))::float8 AS earned,
           SUM(ROUND(o.total_cents::numeric * o.fx_rate_to_rial / 100))::float8 AS sales
    FROM orders o
    WHERE o.status = 'delivered'
      AND o.rep_id IN (SELECT id FROM sales_reps WHERE username LIKE 'demo.%')
    GROUP BY o.rep_id`;
  const byRep = new Map(money.map((row) => [row.repId, row]));
  const roundTo = (value: number, step: number) => Math.max(step, Math.round(value / step) * step);
  for (const rep of reps) {
    const earned = byRep.get(rep.id)?.earned ?? 0;
    await tx`
      INSERT INTO rep_payouts (rep_id, amount_rial, note, created_at)
      VALUES (${rep.id}, ${roundTo(earned * 0.4, 1000)}, 'Demo payout', now() - interval '60 days'),
             (${rep.id}, ${roundTo(earned * 0.3, 1000)}, 'Demo payout', now() - interval '20 days')`;
  }
  const monthlyTarget = (repId: string) =>
    roundTo(((byRep.get(repId)?.sales ?? 0) / 12) * 1.2, 1_000_000);
  await tx`
    INSERT INTO rep_targets (rep_id, persian_year, persian_month, amount_rial)
    VALUES (${reps[0].id}, ${yearAgo.year}, ${yearAgo.month}, ${monthlyTarget(reps[0].id)}),
           (${reps[1].id}, ${current.year}, ${current.month}, ${monthlyTarget(reps[1].id)})`;

  const used = await tx<{ productId: number }[]>`
    SELECT DISTINCT product_id AS "productId" FROM order_items
    WHERE product_id IS NOT NULL AND order_id IN (${demoOrders})`;
  await reconcileInventoryForProducts(tx, [
    ...new Set([...touched, ...used].map((row) => row.productId)),
  ]);

  return { reps, customers };
});

console.log("✓ Demo sales reps seeded (local database).");
for (const rep of printed.reps) console.log(`  rep ${rep.username}  password ${REP_PASSWORD}`);
for (const c of printed.customers) {
  console.log(`  customer ${c.code}  ${c.company}  (${c.rep.username}${c.earns ? "" : ", no commission"})`);
}
console.log(`  customer password ${CUSTOMER_PASSWORD}`);
await sql.end();
