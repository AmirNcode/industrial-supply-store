# Bulk Product Import — Implementation Plan (Phase 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can download a CSV template for a product family, fill it in Excel, upload it, and have every row validated before anything is written — or export every SKU in that family, edit the prices, and upload the same file back.

**Architecture:** Per-family CSV, because a family owns its own spec columns and two families do not share a column set. Both downloads share one column set so either file can be uploaded back. Upload is all-or-nothing: every row is validated first, and if anything fails nothing is written. The write is one transaction that maintains everything a product touches — the facet index, the search text, and the denormalised counts — because inserting into `products` alone leaves the catalog subtly and silently wrong.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions + Route Handlers), postgres-js raw SQL, `csv-parse`, Tailwind v4, `node:test` via `tsx`.

**Source spec:** `docs/superpowers/specs/2026-07-31-accounts-orders-admin-design.md`, section `/[locale]/admin/import`.

**Depends on:** Phase 1 only (`assertAdminWrite`, `safeLocale`). Independent of Phases 2–4.

## Global Constraints

- **A product is never one insert.** Writing `products` alone leaves the catalog broken in ways that look fine: facets come from `product_spec_values`, search from `search_text`, and the counts on every category page from `product_families.product_count` rolled up into `categories.product_count`. All five move together, in one transaction, or the import is a bug.
- **Upload is all-or-nothing.** Validate every row first; if anything fails, write nothing and list every failure as row, column and reason. This replaces a dry-run preview — most of the safety for a fraction of the UI.
- **Upsert by part number.** Re-uploading an exported file with edited prices updates those SKUs; it never duplicates them.
- **Changing which columns a family has is out of scope.** Templates are generated from the existing `spec_defs`. Adding, removing or relabelling a column is a later version, and nothing here should half-build it.
- Money is integer USD cents in the database. The CSV carries dollars; convert with `Math.round(dollars * 100)`.
- **Every admin write action calls `assertAdminWrite()` first** and takes its redirect locale through `safeLocale(formData)`.
- **CSV parsing uses `csv-parse`.** Hand-rolling looks cheaper until a supplier sends a file with quoted fields containing commas, CRLF line endings, or a UTF-8 BOM in front of the first header — all of which Excel produces by default.
- Uploads are bounded: reject a file over 2 MB or 5,000 rows before parsing it.
- Every user-visible string goes in **both** dictionaries in `src/lib/i18n.ts`.
- **After any `npm run db:push`, re-apply `src/db/extensions.sql`.** This phase needs no schema change, so it should not run push at all.
- Postgres runs in Docker as `isupply-db` on host port **5434**.
- TypeScript strict mode, ES modules, `@/*` aliased to `src/*`.

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/lib/importCsv.ts` | Column set derivation, parsing and validation. Pure apart from `csv-parse`; no database. |
| `src/lib/importCsv.test.ts` | Quoting, CRLF, BOM, missing and unknown columns, duplicates, bad numbers. |
| `src/db/importQueries.ts` | `getFamilyForImport`, `getFamiliesGrouped`, `writeImport` — the transaction. |
| `src/app/[locale]/admin/import/page.tsx` | Families grouped by category, each with two download links and an upload form. |
| `src/app/[locale]/admin/import/actions.ts` | `importCsvAction`. |
| `src/app/api/admin/family/[id]/template/route.ts` | Template download. |
| `src/app/api/admin/family/[id]/export/route.ts` | Full export download. |

**Modified**

| File | Change |
| --- | --- |
| `package.json` | `csv-parse` dependency. |
| `src/lib/i18n.ts` | Import strings in both dictionaries. |
| `src/app/[locale]/admin/page.tsx` | A link to the import page. |

---

### Task 1: The column set, parsing and validation

All of the logic, none of the database. This is where the phase's correctness lives.

**Files:**
- Create: `src/lib/importCsv.ts`, `src/lib/importCsv.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `csv-parse/sync`.
- Produces: `type ImportSpecDef = { key: string; kind: "number" | "text" }`,
  `FIXED_COLUMNS: readonly string[]`,
  `columnsFor(defs: readonly ImportSpecDef[]): string[]`,
  `type ImportRow = { partNumber: string; specs: Record<string, string | number>; priceCents: number; packQty: number; leadDays: number; inStock: boolean }`,
  `type ImportError = { row: number; column: string; message: string }`,
  `parseImport(csvText: string, defs: readonly ImportSpecDef[]): { rows: ImportRow[]; errors: ImportError[] }`,
  `toCsv(columns: readonly string[], records: readonly (readonly string[])[]): string`.

- [ ] **Step 1: Add the dependency**

Run: `npm install csv-parse`

- [ ] **Step 2: Write the failing test**

Create `src/lib/importCsv.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { columnsFor, parseImport, toCsv, FIXED_COLUMNS } from "./importCsv";

const DEFS = [
  { key: "dash", kind: "text" as const },
  { key: "width", kind: "number" as const },
];

const HEADER = "part_number,dash,width,price_usd,pack_qty,lead_days,in_stock";

test("the column set is the family's spec keys between part number and the fixed tail", () => {
  assert.deepEqual(columnsFor(DEFS), [
    "part_number", "dash", "width", "price_usd", "pack_qty", "lead_days", "in_stock",
  ]);
  assert.ok(FIXED_COLUMNS.includes("price_usd"));
});

test("a well-formed file parses", () => {
  const { rows, errors } = parseImport(`${HEADER}\n1000A1,004,0.07,0.35,100,0,yes\n`, DEFS);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].partNumber, "1000A1");
  assert.equal(rows[0].specs.dash, "004");
  assert.equal(rows[0].specs.width, 0.07);
  assert.equal(rows[0].priceCents, 35);
  assert.equal(rows[0].inStock, true);
});

test("prices become integer cents, including the ones that float badly", () => {
  // 0.29 * 100 is 28.999999999999996 in IEEE 754.
  const { rows, errors } = parseImport(`${HEADER}\nP1,004,0.07,0.29,1,0,yes\n`, DEFS);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].priceCents, 29);
  assert.equal(Number.isInteger(rows[0].priceCents), true);
});

test("Excel's CRLF line endings and UTF-8 BOM are handled", () => {
  const withBom = `﻿${HEADER}\r\n1000A1,004,0.07,0.35,100,0,yes\r\n`;
  const { rows, errors } = parseImport(withBom, DEFS);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].partNumber, "1000A1");
});

test("a quoted field containing a comma stays one field", () => {
  const defs = [{ key: "note", kind: "text" as const }];
  const header = "part_number,note,price_usd,pack_qty,lead_days,in_stock";
  const { rows, errors } = parseImport(`${header}\nP1,"black, oil-resistant",0.35,1,0,yes\n`, defs);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].specs.note, "black, oil-resistant");
});

test("a missing column is an error naming the column", () => {
  const { errors } = parseImport("part_number,dash,price_usd,pack_qty,lead_days,in_stock\nP1,004,0.35,1,0,yes\n", DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "width");
  assert.match(errors[0].message, /missing/i);
});

test("an unknown column is an error rather than being ignored", () => {
  // Silently dropping it would let a supplier think they had set something.
  const header = `${HEADER},colour`;
  const { errors } = parseImport(`${header}\n1000A1,004,0.07,0.35,100,0,yes,black\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "colour");
  assert.match(errors[0].message, /unknown/i);
});

test("a duplicate part number within the file is an error on the second row", () => {
  const { errors } = parseImport(
    `${HEADER}\n1000A1,004,0.07,0.35,100,0,yes\n1000A1,005,0.08,0.40,100,0,yes\n`,
    DEFS,
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 3);
  assert.equal(errors[0].column, "part_number");
});

test("an unparseable number is an error naming its row and column", () => {
  const { errors } = parseImport(`${HEADER}\nP1,004,wide,0.35,1,0,yes\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 2);
  assert.equal(errors[0].column, "width");
});

test("a negative price is refused", () => {
  const { errors } = parseImport(`${HEADER}\nP1,004,0.07,-1,1,0,yes\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "price_usd");
});

test("in_stock accepts what people actually type", () => {
  const { rows, errors } = parseImport(
    `${HEADER}\nP1,004,0.07,0.35,1,0,YES\nP2,004,0.07,0.35,1,0,no\nP3,004,0.07,0.35,1,0,TRUE\n`,
    DEFS,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map((r) => r.inStock), [true, false, true]);
});

test("an unrecognised in_stock value is an error, not a silent false", () => {
  const { errors } = parseImport(`${HEADER}\nP1,004,0.07,0.35,1,0,maybe\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "in_stock");
});

test("a blank part number is an error", () => {
  const { errors } = parseImport(`${HEADER}\n,004,0.07,0.35,1,0,yes\n`, DEFS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].column, "part_number");
});

test("every bad row is reported, not just the first", () => {
  const { rows, errors } = parseImport(
    `${HEADER}\nP1,004,bad,0.35,1,0,yes\nP2,004,0.07,also-bad,1,0,yes\n`,
    DEFS,
  );
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map((e) => e.row), [2, 3]);
  assert.equal(rows.length, 0, "nothing is returned when anything failed");
});

test("an empty file is an error, not an import of nothing", () => {
  const { errors } = parseImport("", DEFS);
  assert.equal(errors.length, 1);
});

test("toCsv quotes what needs quoting and round-trips", () => {
  const csv = toCsv(["a", "b"], [["plain", 'has "quotes" and, comma']]);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines[0], "a,b");
  assert.equal(lines[1], 'plain,"has ""quotes"" and, comma"');
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test` — fails, `Cannot find module './importCsv'`.

- [ ] **Step 4: Implement**

Create `src/lib/importCsv.ts`. Requirements the tests pin down:

- `FIXED_COLUMNS = ["price_usd", "pack_qty", "lead_days", "in_stock"] as const`, and `columnsFor` returns `["part_number", ...defs.map(d => d.key), ...FIXED_COLUMNS]`.
- Parse with `parse` from `csv-parse/sync`, options `{ columns: true, skip_empty_lines: true, bom: true, trim: true }`. `bom: true` is what handles Excel's byte-order mark; without it the first header reads as `﻿part_number` and every row fails on a missing part number.
- Row numbers in errors are **1-based including the header**, so the first data row is row 2 — that is what the person sees in Excel's gutter, and an error naming a row they cannot find is worse than no error.
- Compare the file's header set against `columnsFor(defs)`: anything missing is one error per column, anything extra is one error per column, both reported before any row is examined.
- Per row: part number non-empty and unique within the file; each `number`-kind spec parses as finite; `price_usd` parses as a finite number `>= 0` and converts with `Math.round(dollars * 100)`; `pack_qty` and `lead_days` parse as non-negative integers; `in_stock` accepts `yes/no/true/false/1/0` case-insensitively and errors otherwise.
- `text`-kind spec values pass through as trimmed strings.
- **Return `rows: []` whenever `errors` is non-empty.** The caller must not be able to write a partial import by ignoring the errors array.
- `toCsv` emits CRLF-free `\n` lines, wraps a field in quotes when it contains a comma, quote or newline, and doubles embedded quotes.

- [ ] **Step 5: Run it and watch it pass**

Run: `npm test` — 16 more tests than before, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/importCsv.ts src/lib/importCsv.test.ts
git commit -m "Parse and validate a product import, all-or-nothing"
```

---

### Task 2: The download routes

**Files:**
- Create: `src/app/api/admin/family/[id]/template/route.ts`, `src/app/api/admin/family/[id]/export/route.ts`
- Create: `src/db/importQueries.ts` (the read half)

**Interfaces:**
- Consumes: `columnsFor`, `toCsv`; `isAdmin`, `DEMO_MODE`.
- Produces: `getFamilyForImport(id)`, `getFamiliesGrouped()`, `getProductsForExport(familyId)`.

- [ ] **Step 1: Write the read queries**

Create `src/db/importQueries.ts` with:

- `getFamilyForImport(id: number)` → `{ id, slug, nameEn, nameFa, categoryPath, defs: ImportSpecDef[] }` or null. `defs` comes from `spec_defs WHERE family_id = $1 ORDER BY sort`, selecting `key` and `kind`.
- `getFamiliesGrouped()` → every family with its category path and name in both locales, ordered by `c.sort, f.sort`, for the page's grouped list.
- `getProductsForExport(familyId: number)` → `partNumber, specs, priceCents, packQty, leadDays, inStock` for every product in the family, ordered by `sort`.

- [ ] **Step 2: Write the two routes**

Both are Route Handlers gated on `isAdmin()` — and **not** on `DEMO_MODE`.
An export is the entire price list; the demo page being publicly readable is a
decision about an inbox of generated data, not a reason to hand out the
catalog. Return 404 when not signed in, so the route does not confirm the
family exists.

`template/route.ts` returns `columnsFor(defs)` as the header plus three example
rows built from the family's first three products if it has any, or a single
row of empty strings if it does not.

`export/route.ts` returns the header plus every product, with each spec value
rendered as it is stored: numbers via `String(value)`, text as-is, absent as an
empty field.

Both respond with:

```ts
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-template.csv"`,
      "cache-control": "no-store",
    },
  });
```

Prefix the body with `﻿`. Excel on Windows opens a UTF-8 CSV without a
BOM as Windows-1252, which turns every Persian family name into mojibake — and
`csv-parse` is configured with `bom: true`, so the same file still uploads.

- [ ] **Step 3: Verify**

`npx tsc --noEmit` clean. With `npm run dev` running and signed out, confirm
`/api/admin/family/1/template` returns 404. Then verify the content by calling
the query and formatter directly from the command line rather than signing in:

```bash
node --import tsx --conditions=react-server -e "import('./src/db/importQueries.ts').then(async m => { const f = await m.getFamilyForImport(1); console.log(f?.slug, f?.defs.map(d => d.key).join(',')); process.exit(0); })"
```

Expected: the family's slug and its spec keys.

- [ ] **Step 4: Commit**

```bash
git add src/db/importQueries.ts src/app/api/admin
git commit -m "Serve a per-family import template and a full export"
```

---

### Task 3: The transactional write

The task where getting it wrong is invisible.

**Files:**
- Modify: `src/db/importQueries.ts` (add the write half)

**Interfaces:**
- Consumes: `sql` from `@/db`; `ImportRow` from `@/lib/importCsv`.
- Produces: `writeImport(familyId: number, rows: readonly ImportRow[]): Promise<{ inserted: number; updated: number }>`.

- [ ] **Step 1: Read how the seeder does it**

Read `src/seed/index.ts` around the product insert — it is the existing,
working description of everything a product touches, including
`buildSearchText` and the count roll-up SQL at the end. Match it; do not invent
a second convention.

- [ ] **Step 2: Write the transaction**

Add `writeImport` to `src/db/importQueries.ts`. In one `sql.begin`:

1. **Upsert `products`** by `part_number`:
   `ON CONFLICT (part_number) DO UPDATE SET specs = …, price_cents = …, pack_qty = …, lead_days = …, in_stock = …, search_text = …`. Count inserts and updates by comparing `xmax = 0` in the `RETURNING` clause, which is 0 for an insert and non-zero for an update.
   Do **not** update `family_id` on conflict: a part number that already exists in a different family is a mistake, and silently moving it between families is worse than leaving it. Report it instead.
2. **Replace `product_spec_values`** for exactly the touched products: `DELETE WHERE product_id = ANY(...)` then insert one row per filterable spec key with a non-empty value, with `val_num` set only for `number` kinds. This is the facet index — skip it and filters return wrong results while every page still renders.
3. **Recompute `search_text`** per product from part number, family name in both locales, and the spec values, matching `buildSearchText` in the seeder.
4. **Recompute `product_families.product_count`** for this family from a `COUNT(*)`, then roll it up into `categories.product_count` for every ancestor using the same statement the seeder ends with.

Chunk inserts at 800 rows — Postgres caps a statement at 65,535 bind
parameters, and the seeder already uses that number.

Write a comment at the head of the function listing the five things that move
together and why each matters, so the next person to edit it knows what breaks
if they drop one.

- [ ] **Step 3: Verify against a throwaway copy, not the real catalog**

Do not test this against `isupply`. Create a scratch database, load the schema
into it, import a small file, and check all five effects:

```bash
docker exec isupply-db psql -U isupply -d postgres -c "DROP DATABASE IF EXISTS importtest;" -c "CREATE DATABASE importtest;"
docker exec -i isupply-db pg_dump -U isupply -d isupply --schema-only | docker exec -i isupply-db psql -U isupply -d importtest
```

Then seed one family's worth of rows into it by hand, run `writeImport`
against it with `DATABASE_URL` pointed at `importtest`, and confirm:

1. New part numbers inserted, existing ones updated, none duplicated.
2. `product_spec_values` holds exactly the filterable specs for the touched
   products, and no stale rows from before the import.
3. `search_text` is non-empty and contains the part number.
4. `product_families.product_count` equals `COUNT(*)` for the family.
5. `categories.product_count` on the family's category and each of its
   ancestors reflects the change.

Then `DROP DATABASE importtest;` and confirm the real database is untouched.

- [ ] **Step 4: Commit**

```bash
git add src/db/importQueries.ts
git commit -m "Write an import in one transaction, maintaining the facet index and counts"
```

---

### Task 4: The import page

**Files:**
- Create: `src/app/[locale]/admin/import/page.tsx`, `src/app/[locale]/admin/import/actions.ts`
- Modify: `src/lib/i18n.ts`, `src/app/[locale]/admin/page.tsx`

**Interfaces:**
- Consumes: everything above; `assertAdminWrite`, `safeLocale`.
- Produces: `importCsvAction`.

- [ ] **Step 1: Add the strings**

Add to `en`:

```ts
  // Import
  importProducts: "Import products",
  downloadTemplate: "Download template",
  exportProducts: "Export products",
  uploadCsv: "Upload CSV",
  importSummary: "Imported: {inserted} new, {updated} updated.",
  importNothingWritten: "Nothing was imported. Fix these and upload again:",
  importRow: "Row",
  importColumn: "Column",
  importTooLarge: "That file is too large. The limit is 2 MB and 5,000 rows.",
  importNoFile: "Choose a CSV file first.",
  importWrongFamily: "This file belongs to a different family. Download that family's template.",
```

and to `fa`:

```ts
  importProducts: "بارگذاری گروهی کالا",
  downloadTemplate: "دریافت قالب",
  exportProducts: "خروجی کالاها",
  uploadCsv: "بارگذاری فایل CSV",
  importSummary: "بارگذاری شد: {inserted} کالای جدید، {updated} به‌روزرسانی.",
  importNothingWritten: "هیچ داده‌ای ثبت نشد. موارد زیر را اصلاح و دوباره بارگذاری کنید:",
  importRow: "سطر",
  importColumn: "ستون",
  importTooLarge: "حجم فایل بیش از حد مجاز است. حداکثر ۲ مگابایت و ۵٬۰۰۰ سطر.",
  importNoFile: "ابتدا یک فایل CSV انتخاب کنید.",
  importWrongFamily: "این فایل مربوط به خانواده دیگری است. قالب همان خانواده را دریافت کنید.",
```

`importSummary` uses `{inserted}` and `{updated}` placeholders — substitute
with `.replace()` at the call site; Persian and English put the numbers in
different positions, so a concatenated string would be wrong in one of them.

- [ ] **Step 2: Write the action**

Create `src/app/[locale]/admin/import/actions.ts`:

- `assertAdminWrite()` first.
- `safeLocale(formData)`.
- Read `familyId` and the `file` (a `File` from the multipart form).
- Reject before parsing: no file → `?error=no-file`; `file.size > 2_000_000` → `?error=too-large`.
- `getFamilyForImport(familyId)`; null → `?error=not-found`.
- `await file.text()`, then `parseImport(text, family.defs)`.
- Reject over 5,000 rows → `?error=too-large`.
- If `errors.length > 0`, write **nothing** and render them. Pass them back through the redirect only if they fit; otherwise stash them in the page via a server-side render. Simplest correct approach: make the page a form that renders its own result, so the action can `return` the errors to a `useActionState` client component rather than round-tripping them through a URL. Choose one and say which in your report.
- Otherwise `writeImport`, then `revalidatePath("/", "layout")` — the catalog's product counts and facets have changed and every category page is statically cached.

- [ ] **Step 3: Write the page**

`src/app/[locale]/admin/import/page.tsx`, gated the same way `/admin` is
(signed in, or `DEMO_MODE` for reading), with every write control disabled
under `DEMO_MODE`.

Render families grouped under their category heading. Each family row shows its
name in the current locale, its product count, and:

- **Download template** → `/api/admin/family/{id}/template`
- **Export products** → `/api/admin/family/{id}/export`
- an upload form: `encType="multipart/form-data"`, a hidden `familyId`, a
  hidden `locale`, `<input type="file" name="file" accept=".csv,text/csv">`,
  and a submit button.

On a result, show either `t.importSummary` with the counts, or
`t.importNothingWritten` followed by a table of row, column and reason.

Link the page from `/admin` — a link in the heading area labelled
`t.importProducts`.

- [ ] **Step 4: Verify end to end**

`npx tsc --noEmit` clean, `npm test` passing.

With `DEMO_MODE=1 npm run dev`, confirm the page renders and every upload
control is disabled. Then, to exercise the write path without typing a
password, drive `importCsvAction`'s pieces from the command line against the
**throwaway** database from Task 3, not the real one.

The checks that matter:

1. A file with one bad cell imports nothing, and the error names that row and
   column.
2. A valid file with one new and one existing part number reports 1 new, 1
   updated.
3. After that import, the family's `product_count` and its category's
   `product_count` are both correct.
4. A file whose header belongs to a different family is refused with unknown
   and missing columns named.
5. An export downloaded and immediately re-uploaded is accepted and reports 0
   new and N updated — the round trip is the point of the two links sharing one
   column set.

Then confirm the real catalog is untouched: `SELECT count(*) FROM products;`
still reports 34,210.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/admin" src/lib/i18n.ts
git commit -m "Add the bulk product import page"
```

---

## Phase 5 done

Staff can load a real catalog: download a family's template or its current
products, edit in Excel, upload, and either see exactly what is wrong or have
every dependent index and count move with the products.

Not built here, and deliberately: changing which columns a family has, creating
a family from a file, and inventory or stock levels beyond the existing
`in_stock` boolean.
