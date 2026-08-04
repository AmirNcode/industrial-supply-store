# Invoices — Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A printable, bilingual invoice page for an invoiced order, rendering at the rate the order was invoiced at, that staff save as PDF and email.

**Architecture:** One Server Component route, `/[locale]/invoice/[ref]`, driven entirely by the locale path segment — English and Persian differ only in dictionary lookups and text direction. A print stylesheet hides the site chrome so the browser's Save-as-PDF produces the document. Money comes from `orders.fx_rate_to_toman`, frozen when the invoice was issued; the live rate is never consulted.

**Tech Stack:** Next.js 16 App Router (Server Components), postgres-js raw SQL, Tailwind v4, `node:test` via `tsx`.

**Source spec:** `docs/superpowers/specs/2026-07-31-accounts-orders-admin-design.md`, section `/[locale]/invoice/[ref]`.

**Depends on:** Phase 1 (`docs/superpowers/plans/2026-07-31-orders-domain-and-exchange-rate.md`), merged and on this branch.

## Global Constraints

- **The invoice renders at `orders.fx_rate_to_toman` and never calls `getFxRate()`.** That column is frozen when the invoice is issued precisely so reprinting cannot restate what is owed. A whole-branch review in Phase 1 found this column written and never read; this phase is where it finally earns its place. Calling the live rate here reintroduces the exact defect that review caught.
- Money is integer USD cents everywhere. Never floats.
- `formatPrice`/`formatPriceBare` take `rate` as a required third argument. Never add a default.
- Only an order with an `invoice_number` has an invoice. Anything else is a 404 — not an empty invoice, not a draft.
- Access in this phase is staff-only, matching `/admin`: signed in, or `DEMO_MODE=1`. Customer access to their own invoice arrives in Phase 3 and must not be pre-built here.
- Every user-visible string goes in **both** dictionaries in `src/lib/i18n.ts`. `fa` is typed as `typeof en`, so a missing key is a compile error.
- Invoice numbers, part numbers and order references stay Latin digits in both locales — `class="tech"`, which already sets `direction: ltr; unicode-bidi: isolate`.
- Locale comes from `safeLocale`/`isLocale` in `src/lib/i18n.ts`. Never interpolate an unvalidated path segment into a redirect.
- TypeScript strict mode, ES modules, `@/*` aliased to `src/*`.
- Postgres runs in Docker as container `isupply-db` on host port **5434**. Do not run `npm run db:push` — this phase needs no schema change, and push silently drops everything in `src/db/extensions.sql`, including `invoice_seq`.

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/lib/invoice.ts` | Pure invoice arithmetic: line totals, subtotal. No imports, so it is testable without a database. |
| `src/lib/invoice.test.ts` | Tests for that arithmetic. |
| `src/lib/seller.ts` | The "from" block — company name, address, contact — read from the environment with defaults. |
| `src/db/invoiceQueries.ts` | `getInvoiceByRef(ref)`: one query returning the order and its lines, or null. |
| `src/app/[locale]/invoice/[ref]/page.tsx` | The invoice document. |
| `src/components/PrintButton.tsx` | Client component; calls `window.print()`. |

**Modified**

| File | Change |
| --- | --- |
| `src/lib/i18n.ts` | Invoice strings in both dictionaries. |
| `src/app/globals.css` | `@media print` rules and the invoice sheet's own styles. |
| `src/app/[locale]/admin/page.tsx` | A link to the invoice on every order that has one. |
| `.env.example` | Document the seller variables. |

---

### Task 1: Invoice arithmetic and the seller block

Pure logic and configuration. No database, no rendering.

**Files:**
- Create: `src/lib/invoice.ts`
- Create: `src/lib/invoice.test.ts`
- Create: `src/lib/seller.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `type InvoiceLine = { qty: number; unitPriceCents: number }`,
  `lineTotalCents(line: InvoiceLine): number`,
  `subtotalCents(lines: readonly InvoiceLine[]): number`;
  `type Seller = { name: string; addressLines: string[]; email: string; phone: string; taxId: string }`,
  `getSeller(locale: Locale): Seller`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/invoice.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineTotalCents, subtotalCents } from "./invoice";

test("a line total is unit price times quantity, in cents", () => {
  assert.equal(lineTotalCents({ qty: 5, unitPriceCents: 50 }), 250);
  assert.equal(lineTotalCents({ qty: 1, unitPriceCents: 35 }), 35);
});

test("a zero-priced line is a legitimate zero, not a missing value", () => {
  assert.equal(lineTotalCents({ qty: 10, unitPriceCents: 0 }), 0);
});

test("a subtotal sums every line", () => {
  assert.equal(
    subtotalCents([
      { qty: 5, unitPriceCents: 50 },
      { qty: 2, unitPriceCents: 125 },
    ]),
    500,
  );
});

test("an empty invoice subtotals to zero rather than NaN", () => {
  assert.equal(subtotalCents([]), 0);
});

test("totals stay integers — no floating point creeps in", () => {
  // 3 x 33 cents is where a naive (price/100)*qty*100 round-trips to 98.999…
  const total = subtotalCents([{ qty: 3, unitPriceCents: 33 }]);
  assert.equal(total, 99);
  assert.equal(Number.isInteger(total), true);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test`

Expected: fails, `Cannot find module './invoice'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/invoice.ts`:

```ts
/**
 * Invoice arithmetic, kept free of imports so it can be tested without a
 * database or a renderer.
 *
 * Everything is integer cents. The invoice is the one document in this system
 * a customer may hold us to, so its totals are computed the same way twice —
 * here, and by the SQL that set `orders.total_cents` when the invoice was
 * issued. If those two ever disagree, the page is wrong and the disagreement
 * should be visible rather than rounded away.
 */

export type InvoiceLine = {
  qty: number;
  unitPriceCents: number;
};

export function lineTotalCents(line: InvoiceLine): number {
  return line.unitPriceCents * line.qty;
}

export function subtotalCents(lines: readonly InvoiceLine[]): number {
  return lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test`

Expected: `pass 29`, `fail 0` (24 existing plus 5 new). Task 1 also adds `seller.test.ts`, taking the total to 36.

- [ ] **Step 5: Write the seller block**

Create `src/lib/seller.ts`:

```ts
import type { Locale } from "./i18n";

/**
 * Who the invoice is from.
 *
 * Environment rather than a database table: this changes when the company
 * moves office, not when a user clicks something, and putting it behind an
 * admin form would be a settings screen nobody opens twice. The defaults are
 * deliberately obviously-placeholder, so an unconfigured deployment produces
 * an invoice that looks unfinished instead of one that looks real and is wrong.
 */
export type Seller = {
  name: string;
  addressLines: string[];
  email: string;
  phone: string;
  /** Printed only when set — not every jurisdiction requires one. */
  taxId: string;
};

export function getSeller(locale: Locale): Seller {
  const suffix = locale === "fa" ? "_FA" : "";
  const pick = (key: string, fallback: string) =>
    process.env[`SELLER_${key}${suffix}`] ?? process.env[`SELLER_${key}`] ?? fallback;

  return {
    name: pick("NAME", "Parstech Supply — set SELLER_NAME"),
    addressLines: pick("ADDRESS", "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean),
    email: pick("EMAIL", "sales@parstech.example"),
    phone: pick("PHONE", "+98 21 8888 0000"),
    taxId: pick("TAX_ID", ""),
  };
}
```

The `_FA` suffix means a deployment can give a Persian company name and address
without a second mechanism; unset, it falls back to the Latin one.

- [ ] **Step 6: Document the variables**

Append to `.env.example`:

```
# Invoice "from" block. ADDRESS is pipe-separated, one line per segment.
# Append _FA to any of these to give a Persian variant, e.g. SELLER_NAME_FA.
SELLER_NAME=Parstech Supply Co.
SELLER_ADDRESS=Unit 4, Sanat Street|Tehran 1234567|Iran
SELLER_EMAIL=sales@parstech.example
SELLER_PHONE=+98 21 8888 0000
SELLER_TAX_ID=
```

- [ ] **Step 7: Verify and commit**

Run: `npx tsc --noEmit` (no output), then `npm test` (`pass 29`).

```bash
git add src/lib/invoice.ts src/lib/invoice.test.ts src/lib/seller.ts .env.example
git commit -m "Add invoice arithmetic and the seller block"
```

---

### Task 2: The invoice query

**Files:**
- Create: `src/db/invoiceQueries.ts`

**Interfaces:**
- Consumes: `sql` from `@/db`.
- Produces: `type InvoiceOrder`, `type InvoiceItem`, `getInvoiceByRef(ref: string): Promise<{ order: InvoiceOrder; items: InvoiceItem[] } | null>`.

- [ ] **Step 1: Write the query module**

Create `src/db/invoiceQueries.ts`:

```ts
import "server-only";
import { sql } from "./index";

export type InvoiceOrder = {
  id: number;
  ref: string;
  invoiceNumber: string;
  /** Toman per USD, frozen when the invoice was issued. Never null here. */
  fxRateToToman: number;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  poNumber: string;
  address: string;
  city: string;
  country: string;
  paymentUrl: string;
  totalCents: number;
  status: string;
  invoicedAt: string;
};

export type InvoiceItem = {
  id: number;
  partNumber: string;
  familyName: string;
  qty: number;
  unitPriceCents: number;
};

/**
 * An invoice exists only once a number has been assigned.
 *
 * The `invoice_number IS NOT NULL` predicate is the whole access rule for
 * "is there an invoice here": an order still being priced has no document to
 * show, and rendering an empty one would invite someone to send it. The
 * `fx_rate_to_toman IS NOT NULL` predicate pairs with it — the two are written
 * in the same statement, so a row with one and not the other means something
 * has gone wrong and we would rather 404 than print a total at the wrong rate.
 */
export async function getInvoiceByRef(
  ref: string,
): Promise<{ order: InvoiceOrder; items: InvoiceItem[] } | null> {
  const rows = await sql<InvoiceOrder[]>`
    SELECT id, ref, invoice_number AS "invoiceNumber",
           fx_rate_to_toman AS "fxRateToToman",
           company, contact_name AS "contactName", email, phone,
           po_number AS "poNumber", address, city, country,
           payment_url AS "paymentUrl", total_cents AS "totalCents",
           status, invoiced_at AS "invoicedAt"
    FROM orders
    WHERE ref = ${ref}
      AND invoice_number IS NOT NULL
      AND fx_rate_to_toman IS NOT NULL
    LIMIT 1
  `;
  const order = rows[0];
  if (!order) return null;

  const items = await sql<InvoiceItem[]>`
    SELECT id, part_number AS "partNumber", family_name AS "familyName",
           qty, unit_price_cents AS "unitPriceCents"
    FROM order_items WHERE order_id = ${order.id} ORDER BY id
  `;
  return { order, items };
}
```

- [ ] **Step 2: Verify it returns the live invoiced order**

Postgres is in Docker on port 5434 (`docker compose up -d db` if it is not
running). Order `ORD-7647RZ` is invoiced as `INV-2026-0001`.

```bash
node --import tsx --conditions=react-server -e "import('./src/db/invoiceQueries.ts').then(async m => { const r = await m.getInvoiceByRef('ORD-7647RZ'); console.log(JSON.stringify({ num: r?.order.invoiceNumber, rate: r?.order.fxRateToToman, lines: r?.items.length })); const miss = await m.getInvoiceByRef('ORD-DH4XH5'); console.log('uninvoiced order returns:', miss); process.exit(0); })"
```

Expected: the first line reports `INV-2026-0001`, rate `110000`, 1 line.
The second prints `null` — `ORD-DH4XH5` is delivered but was never invoiced,
so it has no invoice number and correctly has no invoice.

If this fails with `password authentication failed`, the shell is picking up
`.env.production.local`. Prefix the command with
`DATABASE_URL=postgres://isupply:isupply@localhost:5434/isupply`.

- [ ] **Step 3: Commit**

```bash
git add src/db/invoiceQueries.ts
git commit -m "Add the invoice lookup, gated on a number having been issued"
```

---

### Task 3: The invoice document

**Files:**
- Create: `src/app/[locale]/invoice/[ref]/page.tsx`
- Create: `src/components/PrintButton.tsx`
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Consumes: `getInvoiceByRef` (Task 2); `lineTotalCents`, `subtotalCents` (Task 1); `getSeller` (Task 1); `formatPrice`, `formatInt` from `@/lib/money`; `isAdmin` from `@/lib/admin`; `DEMO_MODE` from `@/lib/demo`; `isLocale`, `getDict` from `@/lib/i18n`.
- Produces: the route; `<PrintButton locale />`.

- [ ] **Step 1: Add the strings**

Add to the `en` object in `src/lib/i18n.ts`:

```ts
  // Invoice
  invoice: "Invoice",
  invoiceTo: "Bill to",
  invoiceFrom: "From",
  invoiceDate: "Date",
  invoiceOrderRef: "Order reference",
  invoiceDescription: "Description",
  invoiceLineTotal: "Amount",
  invoiceSubtotal: "Subtotal",
  invoiceTotal: "Total due",
  invoicePay: "Pay online",
  invoiceDownload: "Download PDF",
  invoiceTaxId: "Tax ID",
  invoiceFxNote:
    "Converted from US dollars at the rate in force when this invoice was issued.",
  invoiceThanks: "Thank you for your business.",
```

and the matching Persian to `fa`:

```ts
  invoice: "صورتحساب",
  invoiceTo: "صورتحساب برای",
  invoiceFrom: "از طرف",
  invoiceDate: "تاریخ",
  invoiceOrderRef: "شماره سفارش",
  invoiceDescription: "شرح کالا",
  invoiceLineTotal: "مبلغ",
  invoiceSubtotal: "جمع جزء",
  invoiceTotal: "مبلغ قابل پرداخت",
  invoicePay: "پرداخت آنلاین",
  invoiceDownload: "دریافت PDF",
  invoiceTaxId: "شناسه مالیاتی",
  invoiceFxNote:
    "مبالغ از دلار آمریکا و با نرخ زمان صدور این صورتحساب تبدیل شده است.",
  invoiceThanks: "از خرید شما سپاسگزاریم.",
```

- [ ] **Step 2: Write the print button**

Create `src/components/PrintButton.tsx`:

```tsx
"use client";

import { getDict, type Locale } from "@/lib/i18n";

/**
 * The whole PDF pipeline.
 *
 * A server-side renderer was considered and rejected: the browser already does
 * Arabic-script shaping and bidi correctly, which is the hard part of a Persian
 * invoice, and it does it with the same fonts the rest of the site ships. The
 * cost is that the customer gets a print dialog rather than a download — which
 * is fine, because in this version staff are the ones producing the PDF.
 */
export function PrintButton({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  return (
    <button type="button" onClick={() => window.print()} className="btn-primary no-print">
      {t.invoiceDownload}
    </button>
  );
}
```

- [ ] **Step 3: Write the route**

Create `src/app/[locale]/invoice/[ref]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getInvoiceByRef } from "@/db/invoiceQueries";
import { lineTotalCents, subtotalCents } from "@/lib/invoice";
import { getSeller } from "@/lib/seller";
import { isAdmin } from "@/lib/admin";
import { DEMO_MODE } from "@/lib/demo";
import { PrintButton } from "@/components/PrintButton";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatPrice, formatInt } from "@/lib/money";

/**
 * The invoice document.
 *
 * Two things about this page are load-bearing.
 *
 * The rate comes off the order, not from `getFxRate()`. It was frozen when the
 * invoice was issued so that reprinting a month later cannot change what is
 * owed; reading the live rate here would undo that silently, and the number
 * would look perfectly reasonable while being wrong.
 *
 * The language comes from the path segment, not from the order. Staff email
 * whichever version the customer reads, and the same order can legitimately be
 * printed in both.
 */
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ locale: string; ref: string }>;
}) {
  const { locale, ref } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  // Staff-only in this phase. A customer reading their own invoice needs an
  // account, which is Phase 3; until then the only route to a customer is a
  // PDF a human attached to an email. DEMO_MODE matches /admin, where the
  // whole inbox is already public and the RFQ form says so before anyone types.
  if (!DEMO_MODE && !(await isAdmin())) notFound();

  const found = await getInvoiceByRef(ref);
  if (!found) notFound();
  const { order, items } = found;

  const rate = order.fxRateToToman;
  const seller = getSeller(l);
  const subtotal = subtotalCents(items);
  const issued = new Date(order.invoicedAt).toISOString().slice(0, 10);

  return (
    <main className="invoice-sheet mx-auto max-w-[820px] px-6 py-8">
      <header className="mb-8 flex items-start justify-between gap-6 border-b-2 border-[var(--color-ink)] pb-4">
        <div>
          <h1 className="text-[26px] font-bold text-[var(--color-pine)]">{t.invoice}</h1>
          <p className="tech mt-1 text-[15px] font-bold">{order.invoiceNumber}</p>
        </div>
        <div className="text-end text-[12px] leading-relaxed">
          <p className="font-bold">{seller.name}</p>
          {seller.addressLines.map((line) => (
            <p key={line} className="text-[var(--color-ink-muted)]">{line}</p>
          ))}
          <p className="tech text-[var(--color-ink-muted)]">{seller.email}</p>
          <p className="tech text-[var(--color-ink-muted)]">{seller.phone}</p>
          {seller.taxId && (
            <p className="text-[var(--color-ink-muted)]">
              {t.invoiceTaxId}: <span className="tech">{seller.taxId}</span>
            </p>
          )}
        </div>
      </header>

      <section className="mb-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
            {t.invoiceTo}
          </h2>
          <p className="text-[14px] font-bold">{order.company}</p>
          <p className="text-[12px]">{order.contactName}</p>
          {order.address && <p className="text-[12px]">{order.address}</p>}
          {(order.city || order.country) && (
            <p className="text-[12px]">{[order.city, order.country].filter(Boolean).join(", ")}</p>
          )}
          <p className="tech text-[12px] text-[var(--color-ink-muted)]">{order.email}</p>
          {order.phone && (
            <p className="tech text-[12px] text-[var(--color-ink-muted)]">{order.phone}</p>
          )}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 self-start text-[12px] sm:justify-self-end">
          <dt className="font-bold">{t.invoiceDate}</dt>
          <dd className="tech">{issued}</dd>
          <dt className="font-bold">{t.invoiceOrderRef}</dt>
          <dd className="tech">{order.ref}</dd>
          {order.poNumber && (
            <>
              <dt className="font-bold">{t.poNumber}</dt>
              <dd className="tech">{order.poNumber}</dd>
            </>
          )}
        </dl>
      </section>

      <table className="invoice-table w-full">
        <thead>
          <tr>
            <th className="text-start">{t.partNumber}</th>
            <th className="text-start">{t.invoiceDescription}</th>
            <th className="num">{t.qty}</th>
            <th className="num">{t.unitPrice}</th>
            <th className="num">{t.invoiceLineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td className="tech font-semibold">{i.partNumber}</td>
              <td>{i.familyName}</td>
              <td className="num tech tech-num">{formatInt(i.qty, l)}</td>
              <td className="num tech tech-num">{formatPrice(i.unitPriceCents, l, rate)}</td>
              <td className="num tech tech-num">
                {formatPrice(lineTotalCents(i), l, rate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 flex justify-end">
        <dl className="grid w-full max-w-[280px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[13px]">
          <dt>{t.invoiceSubtotal}</dt>
          <dd className="num tech tech-num">{formatPrice(subtotal, l, rate)}</dd>
          <dt className="border-t border-[var(--color-ink)] pt-1.5 font-bold">
            {t.invoiceTotal}
          </dt>
          <dd className="num tech tech-num border-t border-[var(--color-ink)] pt-1.5 text-[15px] font-bold">
            {formatPrice(order.totalCents, l, rate)}
          </dd>
        </dl>
      </section>

      {order.paymentUrl && (
        <p className="mt-6 text-[12px]">
          <a href={order.paymentUrl} className="font-bold" rel="noopener noreferrer">
            {t.invoicePay}
          </a>{" "}
          <span className="tech break-all text-[var(--color-ink-faint)]">{order.paymentUrl}</span>
        </p>
      )}

      <footer className="mt-8 border-t border-[var(--color-rule)] pt-3 text-[11px] text-[var(--color-ink-muted)]">
        <p>{t.invoiceThanks}</p>
        {l === "fa" && (
          <p className="mt-1">
            {t.invoiceFxNote}{" "}
            <span className="tech">
              1 USD = {formatInt(rate, l)}
            </span>
          </p>
        )}
      </footer>

      <div className="mt-6 flex justify-end">
        <PrintButton locale={l} />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify it compiles and renders**

Run: `npx tsc --noEmit` — no output.

Then start the dev server with `DEMO_MODE=1 npm run dev` (this makes the page
readable without signing in — **do not type a password**) and check:

1. `http://localhost:3000/en/invoice/ORD-7647RZ` renders with `INV-2026-0001`,
   one line item, and a total of `$2.50`.
2. `http://localhost:3000/fa/invoice/ORD-7647RZ` renders right-to-left, in
   Persian, with the total in Toman and the FX footnote showing `110000`.
3. `http://localhost:3000/en/invoice/ORD-DH4XH5` is a 404 — that order was
   delivered but never invoiced.
4. `http://localhost:3000/en/invoice/NOPE` is a 404.

- [ ] **Step 5: Verify the frozen rate is genuinely frozen**

This is the point of the phase. With a *different* live rate set, the invoice
must not move:

```bash
docker exec isupply-db psql -U isupply -d isupply -c "INSERT INTO app_settings (key,value) VALUES ('fx_mode','manual'),('fx_manual_rate','145000') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;"
curl -s "http://localhost:3000/fa/invoice/ORD-7647RZ" | grep -oE "[۰-۹٬]{5,}[^<]{0,12}تومان" | head -3
docker exec isupply-db psql -U isupply -d isupply -c "DELETE FROM app_settings;"
```

Expected: `۲۷۵٬۰۰۰ تومان` (250 cents at the frozen 110,000). If it reads
`۳۶۲٬۵۰۰` the page is using the live rate and the fix is to pass
`order.fxRateToToman`, not `getFxRate()`. Record the actual figure.

- [ ] **Step 6: Commit**

```bash
git add src/lib/i18n.ts src/components/PrintButton.tsx "src/app/[locale]/invoice"
git commit -m "Render the invoice at the rate it was issued at"
```

---

### Task 4: Print stylesheet and the admin link

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/[locale]/admin/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `.invoice-sheet`, `.invoice-table`, `.no-print` styles; a link from each invoiced order to its invoice.

- [ ] **Step 1: Add the invoice and print styles**

Append to `src/app/globals.css`:

```css
/* --------------------------------------------------------------------------
   Invoice
   -------------------------------------------------------------------------- */

.invoice-table {
  border-collapse: collapse;
  font-size: var(--text-xs);
}
.invoice-table thead th {
  border-bottom: 1.5px solid var(--color-ink);
  padding: 6px 8px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-ink-muted);
  white-space: nowrap;
}
html[lang="fa"] .invoice-table thead th {
  text-transform: none;
  letter-spacing: 0;
  font-size: 11.5px;
}
.invoice-table td {
  border-bottom: 1px solid var(--color-rule-light);
  padding: 7px 8px;
  vertical-align: top;
}

/*
 * Print.
 *
 * The site chrome is navigation for a person at a screen; on paper it is a
 * masthead, a category rail and a footer of links nobody can click, wasting
 * the top third of page one. Hiding it is what turns this route into a
 * document. `@page` sets the margin because the browser's default leaves the
 * sheet floating in the middle of A4.
 */
@media print {
  body > header,
  body > footer,
  .no-print {
    display: none !important;
  }

  body {
    background: #fff;
  }

  .invoice-sheet {
    max-width: none;
    padding: 0;
  }

  /* A line item must not be split across a page break. */
  .invoice-table tr {
    break-inside: avoid;
  }

  a {
    text-decoration: none;
    color: var(--color-ink);
  }

  @page {
    size: A4;
    margin: 16mm;
  }
}
```

- [ ] **Step 2: Hide the remaining chrome**

The layout renders a skip link and the demo banner as direct children of
`<body>`, before the header. Read `src/app/[locale]/layout.tsx` and confirm
which elements those are, then add `no-print` to the skip link's `className`
and to the root element of `src/components/DemoBanner.tsx`. Do not change
their behaviour on screen.

If `Header` or `Footer` render something other than a bare `<header>` /
`<footer>` element, add `no-print` to their root element too rather than
widening the CSS selector — say in your report which you found.

- [ ] **Step 3: Link the invoice from the admin queue**

In `src/app/[locale]/admin/page.tsx`, the detail list already renders the
invoice number when present. Make it a link. Find the `Row` that renders
`t.invoiceNumber` and replace that block with:

```tsx
              {q.invoiceNumber && (
                <div className="flex gap-1.5">
                  <dt className="font-bold">{t.invoiceNumber}:</dt>
                  <dd>
                    <Link href={`/${l}/invoice/${q.ref}`} className="tech" prefetch={false}>
                      {q.invoiceNumber}
                    </Link>
                  </dd>
                </div>
              )}
```

`Link` is already imported in that file.

- [ ] **Step 4: Verify the printed output**

With `DEMO_MODE=1 npm run dev` running, open
`http://localhost:3000/fa/invoice/ORD-7647RZ` and use the browser's print
preview (do not print). Confirm:

1. The masthead, category rail, demo banner and site footer are absent.
2. The invoice starts at the top of page one.
3. Persian text is right-to-left and the part number stays Latin and unmirrored.
4. From `/en/admin`, the invoice number on `ORD-7647RZ` is now a link that
   reaches the invoice.

Take a screenshot of the print preview for the report if your tooling allows;
otherwise describe what you saw.

- [ ] **Step 5: Verify nothing else regressed and commit**

Run: `npx tsc --noEmit` (no output), `npm test` (`pass 29`).

Load `/en` and `/fa` normally and confirm the site chrome is unaffected on
screen — the print rules must not leak into the screen stylesheet.

```bash
git add src/app/globals.css "src/app/[locale]/admin/page.tsx" "src/app/[locale]/layout.tsx" src/components/DemoBanner.tsx
git commit -m "Hide the site chrome when printing, and link invoices from the queue"
```

---

## Phase 2 done

Staff can open an invoiced order's invoice in either language, save it as PDF
from the browser, and email it with the payment link. The frozen rate is now
read as well as written.

Not built here: customer access to their own invoice, which needs an account
and lands in Phase 3.
