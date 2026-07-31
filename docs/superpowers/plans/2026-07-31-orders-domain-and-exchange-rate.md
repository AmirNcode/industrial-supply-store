# Orders Domain and Exchange Rate — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the RFQ inbox into a staff-operable order pipeline — received →
invoiced → preparing → shipped → delivered — and make the USD→Toman rate
settable from the admin page.

**Architecture:** The existing `quotes` / `quote_items` tables are renamed to
`orders` / `order_items` by an explicit SQL script (never by `drizzle-kit push`,
which can implement a rename as drop-then-create). Status transitions are
guarded by one pure module. The exchange rate stops being a module constant read
from `process.env` and becomes a required argument to the price formatters,
resolved once per request from an `app_settings` table.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions),
postgres-js with raw SQL for queries, Drizzle only for schema definition and
`drizzle-kit push`, Tailwind v4, `node:test` via `tsx`.

**Source spec:** `docs/superpowers/specs/2026-07-31-accounts-orders-admin-design.md`

## Global Constraints

- Statuses are exactly: `received`, `invoiced`, `preparing`, `shipped`, `delivered`, `cancelled`. No others.
- Forward one step only; `cancelled` reachable from any state before `shipped`; `delivered` and `cancelled` are terminal.
- Every user-visible string goes in **both** dictionaries in `src/lib/i18n.ts` (`en` and `fa`). `fa` is typed as `typeof en`, so a missing key is a compile error.
- Every admin write action must call `assertAdminWrite()` — it throws when `DEMO_MODE=1`. Demo mode makes `/admin` publicly readable, so a writable action there would be world-writable.
- Part numbers, tracking numbers and invoice numbers stay Latin digits in both locales, wrapped in `<bdi>` or `className="tech"` as the existing spec table does.
- `formatPrice` / `formatPriceBare` take `rate` as a **required** third argument. Never add a default value — a defaulted call site silently renders the environment rate.
- Invoices freeze `fx_rate_to_toman` at issue. Nothing may recompute an invoiced order's Toman total from the live rate.
- Money is integer USD cents everywhere. Never floats.
- Run destructive scripts through `assertSafeTarget()` from `src/db/script-client.ts`.

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/lib/orders.ts` | Status vocabulary and transition guard. Pure — no imports. |
| `src/lib/orders.test.ts` | Tests for the guard. |
| `src/lib/fxRate.ts` | Pure rate resolution and validation. No imports, so it is testable without a database. |
| `src/lib/fxRate.test.ts` | Tests for resolution and validation. |
| `src/lib/fx.ts` | Server-only DB accessor wrapping `fxRate.ts` in React `cache()`. |
| `src/lib/money.test.ts` | Tests for Toman conversion at a fixed rate. |
| `src/app/[locale]/admin/actions.ts` | All admin Server Actions, each guarded. |
| `src/components/FxRatePanel.tsx` | Client component: mode toggle, rate field, two-step Apply. |
| `src/components/OrderStatusPill.tsx` | Shared status badge, used by admin now and the account area later. |
| `scripts/rename-quotes-to-orders.mts` | One-shot migration: rename, add columns, backfill, create sequence. |

**Modified**

| File | Change |
| --- | --- |
| `package.json` | `test` and `db:rename-orders` scripts. |
| `src/db/schema.ts` | `appSettings` table; `quotes`→`orders`, `quoteItems`→`orderItems` with new columns. |
| `src/lib/money.ts` | `rate` parameter; drop the `USD_TO_TOMAN` export. |
| `src/lib/i18n.ts` | Status labels, admin action labels, FX panel strings. |
| `src/app/actions.ts` | Insert into `orders` / `order_items`; `ORD-` prefix; write `requested_*` columns. |
| `src/app/[locale]/admin/page.tsx` | Read `orders`; status filter; transition forms; FX panel. |
| `src/app/[locale]/cart/page.tsx` | Pass rate to formatters. |
| `src/app/[locale]/quote/page.tsx` | Pass rate to formatters. |
| `src/app/[locale]/search/page.tsx` | Pass rate to formatters. |
| `src/app/[locale]/f/[slug]/page.tsx` | Pass rate to formatters and to `ProductCardList`. |
| `src/app/[locale]/c/[...slug]/page.tsx` | Pass rate to `ProductCardList`. |
| `src/components/ProductCardList.tsx` | Accept `rate` prop. |
| `src/seed/index.ts` | TRUNCATE list names the renamed tables. |

---

### Task 1: Test runner and the order status guard

Pure logic, no database. Establishes the test command every later task uses.

**Files:**
- Create: `src/lib/orders.ts`
- Create: `src/lib/orders.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `ORDER_STATUSES: readonly OrderStatus[]`, `type OrderStatus`,
  `isOrderStatus(v: string): v is OrderStatus`,
  `canTransition(from: OrderStatus, to: OrderStatus): boolean`,
  `assertTransition(from: OrderStatus, to: OrderStatus): void` (throws `Error`),
  `nextStatuses(from: OrderStatus): readonly OrderStatus[]`.

- [ ] **Step 1: Add the test script**

In `package.json`, add to `"scripts"` (keep the existing entries):

```json
"test": "node --import tsx --test src/lib/*.test.ts"
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/orders.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_STATUSES,
  isOrderStatus,
  canTransition,
  assertTransition,
  nextStatuses,
} from "./orders";

test("the vocabulary is exactly the six agreed statuses", () => {
  assert.deepEqual([...ORDER_STATUSES], [
    "received",
    "invoiced",
    "preparing",
    "shipped",
    "delivered",
    "cancelled",
  ]);
});

test("isOrderStatus narrows only known values", () => {
  assert.equal(isOrderStatus("received"), true);
  assert.equal(isOrderStatus("submitted"), false);
  assert.equal(isOrderStatus(""), false);
});

test("the happy path moves forward one step at a time", () => {
  assert.equal(canTransition("received", "invoiced"), true);
  assert.equal(canTransition("invoiced", "preparing"), true);
  assert.equal(canTransition("preparing", "shipped"), true);
  assert.equal(canTransition("shipped", "delivered"), true);
});

test("skipping a step is refused", () => {
  assert.equal(canTransition("received", "shipped"), false);
  assert.equal(canTransition("received", "delivered"), false);
  assert.equal(canTransition("invoiced", "shipped"), false);
});

test("going backwards is refused", () => {
  assert.equal(canTransition("shipped", "preparing"), false);
  assert.equal(canTransition("delivered", "shipped"), false);
});

test("cancelling is allowed before shipping and not after", () => {
  assert.equal(canTransition("received", "cancelled"), true);
  assert.equal(canTransition("invoiced", "cancelled"), true);
  assert.equal(canTransition("preparing", "cancelled"), true);
  assert.equal(canTransition("shipped", "cancelled"), false);
});

test("terminal statuses cannot move", () => {
  assert.deepEqual([...nextStatuses("delivered")], []);
  assert.deepEqual([...nextStatuses("cancelled")], []);
});

test("a status cannot transition to itself", () => {
  for (const s of ORDER_STATUSES) {
    assert.equal(canTransition(s, s), false, `${s} → ${s} should be refused`);
  }
});

test("assertTransition throws with both statuses named", () => {
  assert.throws(
    () => assertTransition("received", "delivered"),
    /received.*delivered/,
  );
  assert.doesNotThrow(() => assertTransition("received", "invoiced"));
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npm test`

Expected: fails, `Cannot find module './orders'`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/orders.ts`:

```ts
/**
 * The order lifecycle, in one place.
 *
 * Every transition in the admin page goes through `assertTransition`. Guarding
 * here rather than at each call site is what stops a stale tab, a double
 * submit, or a hand-written form post from moving an order somewhere the
 * business process cannot reach — an order marked shipped without ever being
 * paid for, say.
 */
export const ORDER_STATUSES = [
  "received",
  "invoiced",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Forward one step only. `cancelled` is reachable until the goods are with a
 * courier, after which stopping the order is a return, not a cancellation, and
 * that is a different process this version does not model.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  received: ["invoiced", "cancelled"],
  invoiced: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function isOrderStatus(v: string): v is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(v);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal order transition: ${from} → ${to}`);
  }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npm test`

Expected: `pass 8`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json src/lib/orders.ts src/lib/orders.test.ts
git commit -m "Add the order status vocabulary and its transition guard"
```

---

### Task 2: Exchange rate resolution and validation

Pure functions only. The database read arrives in Task 3.

**Files:**
- Create: `src/lib/fxRate.ts`
- Create: `src/lib/fxRate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FX_MODES`, `type FxMode = "auto" | "manual"`,
  `type FxSettings = { mode: FxMode; manualRate: number | null }`,
  `DEFAULT_FX_RATE: number`, `envFxRate(): number`,
  `resolveFxRate(settings: FxSettings, envRate: number): number`,
  `isPlausibleRate(rate: number, envRate: number): boolean`,
  `parseRate(raw: string): number | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/fxRate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFxRate,
  isPlausibleRate,
  parseRate,
  DEFAULT_FX_RATE,
} from "./fxRate";

const ENV = 110000;

test("auto mode uses the environment rate and ignores any stored value", () => {
  assert.equal(resolveFxRate({ mode: "auto", manualRate: 999 }, ENV), ENV);
  assert.equal(resolveFxRate({ mode: "auto", manualRate: null }, ENV), ENV);
});

test("manual mode uses the stored rate", () => {
  assert.equal(resolveFxRate({ mode: "manual", manualRate: 118500 }, ENV), 118500);
});

test("manual mode falls back to the environment rate rather than to zero", () => {
  // A missing or corrupt setting must not price the entire catalog at nothing.
  assert.equal(resolveFxRate({ mode: "manual", manualRate: null }, ENV), ENV);
  assert.equal(resolveFxRate({ mode: "manual", manualRate: 0 }, ENV), ENV);
  assert.equal(resolveFxRate({ mode: "manual", manualRate: -5 }, ENV), ENV);
  assert.equal(resolveFxRate({ mode: "manual", manualRate: Number.NaN }, ENV), ENV);
});

test("a non-finite environment rate falls back to the built-in default", () => {
  assert.equal(resolveFxRate({ mode: "auto", manualRate: null }, Number.NaN), DEFAULT_FX_RATE);
});

test("plausible rates are within an order of magnitude of the environment rate", () => {
  assert.equal(isPlausibleRate(118500, ENV), true);
  assert.equal(isPlausibleRate(ENV, ENV), true);
  assert.equal(isPlausibleRate(ENV * 10, ENV), true);
  assert.equal(isPlausibleRate(ENV / 10, ENV), true);
});

test("a fat-fingered rate is rejected", () => {
  // 1185000 is 118500 with one extra zero — the exact slip this guards.
  assert.equal(isPlausibleRate(1185000, ENV), false);
  assert.equal(isPlausibleRate(11, ENV), false);
  assert.equal(isPlausibleRate(0, ENV), false);
  assert.equal(isPlausibleRate(-118500, ENV), false);
});

test("parseRate accepts whole numbers and rejects everything else", () => {
  assert.equal(parseRate("118500"), 118500);
  assert.equal(parseRate(" 118500 "), 118500);
  assert.equal(parseRate("118,500"), 118500);
  assert.equal(parseRate("118500.4"), null);
  assert.equal(parseRate("abc"), null);
  assert.equal(parseRate(""), null);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test`

Expected: fails, `Cannot find module './fxRate'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/fxRate.ts`:

```ts
/**
 * Exchange rate policy, kept free of imports so it can be tested without a
 * database. `lib/fx.ts` supplies the stored settings; this module decides what
 * they mean.
 */

export const FX_MODES = ["auto", "manual"] as const;
export type FxMode = (typeof FX_MODES)[number];

export type FxSettings = {
  mode: FxMode;
  /** Toman per USD. Null when never set. */
  manualRate: number | null;
};

/** Used only when the environment value is missing or unparseable. */
export const DEFAULT_FX_RATE = 110000;

export function isFxMode(v: string): v is FxMode {
  return (FX_MODES as readonly string[]).includes(v);
}

export function envFxRate(): number {
  const n = Number(process.env.USD_TO_TOMAN);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FX_RATE;
}

/**
 * Manual mode falls back to the environment rate when the stored value is
 * unusable. The alternative — returning zero or NaN — would render every
 * Persian price as free, which is worse than a stale rate and harder to spot.
 */
export function resolveFxRate(settings: FxSettings, envRate: number): number {
  const env = Number.isFinite(envRate) && envRate > 0 ? envRate : DEFAULT_FX_RATE;
  if (settings.mode !== "manual") return env;
  const manual = settings.manualRate;
  return typeof manual === "number" && Number.isFinite(manual) && manual > 0
    ? manual
    : env;
}

/**
 * A typo in this field reprices the whole catalog and looks exactly like a
 * deliberate change. One order of magnitude either way is wide enough for any
 * real currency move and narrow enough to catch a stray zero.
 */
export function isPlausibleRate(rate: number, envRate: number): boolean {
  if (!Number.isFinite(rate) || rate <= 0) return false;
  const env = Number.isFinite(envRate) && envRate > 0 ? envRate : DEFAULT_FX_RATE;
  return rate >= env / 10 && rate <= env * 10;
}

/** Accepts what someone actually types, including thousands separators. */
export function parseRate(raw: string): number | null {
  const cleaned = raw.trim().replace(/[,\s٬،]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isInteger(n) && n > 0 ? n : null;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test`

Expected: `pass 15`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fxRate.ts src/lib/fxRate.test.ts
git commit -m "Add exchange rate resolution and range validation"
```

---

### Task 3: The `app_settings` table and the rate accessor

**Files:**
- Modify: `src/db/schema.ts` (append after the existing tables)
- Create: `src/lib/fx.ts`

**Interfaces:**
- Consumes: `FxSettings`, `FxMode`, `isFxMode`, `resolveFxRate`, `envFxRate` from `src/lib/fxRate.ts`.
- Produces: `getFxSettings(): Promise<FxSettings>`, `getFxRate(): Promise<number>`,
  `saveFxSettings(mode: FxMode, manualRate: number | null): Promise<void>`.

- [ ] **Step 1: Add the table to the schema**

Append to `src/db/schema.ts`:

```ts
// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Key/value rather than one row with a column per setting, so the next setting
 * is an insert instead of a migration. Values are text and parsed at the edge;
 * there are two of them and both are small.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

- [ ] **Step 2: Push the schema**

Run: `npm run db:push`

Expected: drizzle-kit reports creating `app_settings` and no other change. If it
proposes dropping or renaming anything, answer no and stop — that is a signal
the local database has drifted.

- [ ] **Step 3: Write the accessor**

Create `src/lib/fx.ts`:

```ts
import "server-only";
import { cache } from "react";
import { sql } from "@/db";
import {
  envFxRate,
  isFxMode,
  resolveFxRate,
  type FxMode,
  type FxSettings,
} from "./fxRate";

const KEY_MODE = "fx_mode";
const KEY_RATE = "fx_manual_rate";

/**
 * Wrapped in React's `cache` so a page that formats two hundred prices still
 * reads the settings once. The cache is per-request, so a rate change is
 * visible on the next render rather than after a restart.
 */
export const getFxSettings = cache(async (): Promise<FxSettings> => {
  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM app_settings WHERE key IN (${KEY_MODE}, ${KEY_RATE})
  `;
  const bag = new Map(rows.map((r) => [r.key, r.value]));

  const rawMode = bag.get(KEY_MODE) ?? "auto";
  const rawRate = bag.get(KEY_RATE);
  const parsedRate = rawRate === undefined ? Number.NaN : Number(rawRate);

  return {
    // An unrecognised stored mode reads as auto: the environment rate is the
    // one value that is always present and always deliberate.
    mode: isFxMode(rawMode) ? rawMode : "auto",
    manualRate: Number.isFinite(parsedRate) ? parsedRate : null,
  };
});

export const getFxRate = cache(async (): Promise<number> => {
  return resolveFxRate(await getFxSettings(), envFxRate());
});

export async function saveFxSettings(
  mode: FxMode,
  manualRate: number | null,
): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${KEY_MODE}, ${mode}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${mode}, updated_at = now()
  `;
  if (manualRate !== null) {
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${KEY_RATE}, ${String(manualRate)}, now())
      ON CONFLICT (key) DO UPDATE SET value = ${String(manualRate)}, updated_at = now()
    `;
  }
}
```

- [ ] **Step 4: Verify against the local database**

Run:

```bash
docker compose up -d db && node --import tsx -e "import('./src/lib/fx.ts').then(async m => console.log(await m.getFxRate()))"
```

Expected: prints `110000` (or your `USD_TO_TOMAN`), with no rows in the table.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/lib/fx.ts
git commit -m "Store the exchange rate mode and manual value in app_settings"
```

---

### Task 4: Make the rate an argument to the price formatters

The compiler drives this task: removing the module constant breaks every call
site, and each break is a place that must now be handed a rate.

**Files:**
- Modify: `src/lib/money.ts`
- Create: `src/lib/money.test.ts`
- Modify: `src/components/ProductCardList.tsx`
- Modify: `src/app/[locale]/f/[slug]/page.tsx`
- Modify: `src/app/[locale]/c/[...slug]/page.tsx`
- Modify: `src/app/[locale]/cart/page.tsx`
- Modify: `src/app/[locale]/quote/page.tsx`
- Modify: `src/app/[locale]/search/page.tsx`
- Modify: `src/app/[locale]/admin/page.tsx`

**Interfaces:**
- Consumes: `getFxRate()` from `src/lib/fx.ts`.
- Produces: `formatPrice(cents: number, locale: Locale, rate: number): string`,
  `formatPriceBare(cents: number, locale: Locale, rate: number): string`.
  `USD_TO_TOMAN` is **removed** — nothing may import it after this task.

- [ ] **Step 1: Write the failing test**

Create `src/lib/money.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPrice, formatPriceBare } from "./money";

const RATE = 110000;

test("English prices are dollars and ignore the rate", () => {
  assert.equal(formatPrice(35, "en", RATE), "$0.35");
  assert.equal(formatPrice(35, "en", 999999), "$0.35");
  assert.equal(formatPriceBare(35, "en", RATE), "0.35");
});

test("Persian prices convert at the rate supplied, not a global one", () => {
  // 35 cents at 110000 = 38500 Toman; at 220000 = 77000.
  assert.match(formatPrice(35, "fa", 110000), /۳۸٬۵۰۰/);
  assert.match(formatPrice(35, "fa", 220000), /۷۷٬۰۰۰/);
});

test("Toman amounts round to the nearest hundred", () => {
  // 37 cents at 110000 = 40700 exactly; 36 cents = 39600.
  assert.match(formatPrice(37, "fa", 110000), /۴۰٬۷۰۰/);
});

test("a zero price formats rather than throwing", () => {
  assert.equal(formatPrice(0, "en", RATE), "$0.00");
  assert.match(formatPrice(0, "fa", RATE), /۰/);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test`

Expected: fails — `formatPrice` currently takes two arguments, so the third is a
type error and the Persian assertions use the old global rate.

- [ ] **Step 3: Rewrite the formatters**

In `src/lib/money.ts`, replace lines 1–44 (the header comment through
`formatPriceBare`) with:

```ts
import type { Locale } from "./i18n";

/**
 * Prices are stored once, in USD cents. Persian display converts to Toman at a
 * rate the caller supplies.
 *
 * The rate is a required argument rather than a module constant read from the
 * environment. Staff can change it from the admin page, and a defaulted
 * parameter would let one forgotten call site keep rendering the old rate —
 * prices that are wrong with no visible symptom. Making it required turns that
 * into a compile error instead.
 */

export function currencyFor(locale: Locale): "USD" | "IRT" {
  return locale === "fa" ? "IRT" : "USD";
}

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// fa-IR gives Persian digits and the ٬ thousands separator natively.
const tomanFmt = new Intl.NumberFormat("fa-IR", {
  maximumFractionDigits: 0,
});

/**
 * Toman amounts run to six or seven digits, so sub-100 precision is noise.
 * Rounding to the nearest 100 keeps the column narrow and reads as a real price.
 */
function toToman(cents: number, rate: number): number {
  const raw = (cents / 100) * rate;
  return Math.round(raw / 100) * 100;
}

export function formatPrice(cents: number, locale: Locale, rate: number): string {
  if (locale === "fa") return `${tomanFmt.format(toToman(cents, rate))} تومان`;
  return usdFmt.format(cents / 100);
}

/** Bare number, no currency word — for dense table columns with a unit header. */
export function formatPriceBare(cents: number, locale: Locale, rate: number): string {
  if (locale === "fa") return tomanFmt.format(toToman(cents, rate));
  return (cents / 100).toFixed(2);
}
```

Leave `currencyLabel`, `formatInt` and `formatSpecNumber` untouched.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test`

Expected: `pass 19`, `fail 0` across all three test files.

- [ ] **Step 5: Find every broken call site**

Run: `npx tsc --noEmit`

Expected: errors in exactly these files — `ProductCardList.tsx`,
`f/[slug]/page.tsx`, `cart/page.tsx`, `quote/page.tsx`, `search/page.tsx`,
`admin/page.tsx`. Work through them in the next step.

- [ ] **Step 6: Thread the rate through each page**

`src/components/ProductCardList.tsx` — add `rate` to the props type and
destructuring, and pass it to the one `formatPrice` call:

```tsx
export function ProductCardList({
  locale,
  products,
  defs,
  defsByFamily,
  familyName,
  familyIcon,
  rate,
}: {
  locale: Locale;
  products: Item[];
  defs?: SpecDefRow[];
  defsByFamily?: Map<number, SpecDefRow[]>;
  familyName?: string;
  familyIcon?: string;
  /** Toman per USD, resolved once by the page. */
  rate: number;
}) {
```

and change the price line to `{formatPrice(base, locale, rate)}`.

`src/app/[locale]/f/[slug]/page.tsx`:
1. Add `import { getFxRate } from "@/lib/fx";`
2. Add `getFxRate()` to the existing `Promise.all`, so the page still makes one
   round of parallel queries:

```tsx
  const [defs, total, products, facets, catRow, rate] = await Promise.all([
    getSpecDefs(family.id),
    countProducts(family.id, filters),
    getProducts(family.id, filters, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    getFacets(family.id, filters),
    sql<{ path: string }[]>`SELECT path FROM categories WHERE id = ${family.categoryId}`,
    getFxRate(),
  ]);
```

3. Pass `rate={rate}` to `<SpecTable …>` and `<ProductCardList …>`.
4. Add `rate: number` to `SpecTable`'s props and use it in both
   `formatPriceBare(base, locale, rate)` and
   `formatPriceBare(bulk, locale, rate)`.

`src/app/[locale]/c/[...slug]/page.tsx`: add the import, add `getFxRate()` to
the existing `Promise.all` destructuring as `rate`, and pass `rate={rate}` to
`<ProductCardList …>`.

`src/app/[locale]/cart/page.tsx`, `quote/page.tsx`, `search/page.tsx`,
`admin/page.tsx`: add `import { getFxRate } from "@/lib/fx";`, add
`const rate = await getFxRate();` beside the other awaits near the top of the
component, and add `, rate` to every `formatPrice(...)` call in the file.

- [ ] **Step 7: Verify the whole project compiles**

Run: `npx tsc --noEmit`

Expected: no output.

- [ ] **Step 8: Verify in the browser**

Run the dev server, open `http://localhost:3000/fa/f/oil-resistant-buna-n-o-rings`,
and confirm Toman prices still render. Then open `/en/...` and confirm dollars.

- [ ] **Step 9: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts src/components/ProductCardList.tsx \
  "src/app/[locale]/f/[slug]/page.tsx" "src/app/[locale]/c/[...slug]/page.tsx" \
  "src/app/[locale]/cart/page.tsx" "src/app/[locale]/quote/page.tsx" \
  "src/app/[locale]/search/page.tsx" "src/app/[locale]/admin/page.tsx"
git commit -m "Pass the exchange rate explicitly instead of reading it at import"
```

---

### Task 5: Admin guard and the exchange rate panel

**Files:**
- Create: `src/app/[locale]/admin/actions.ts`
- Create: `src/components/FxRatePanel.tsx`
- Modify: `src/lib/admin.ts`
- Modify: `src/lib/i18n.ts`
- Modify: `src/app/[locale]/admin/page.tsx`

**Interfaces:**
- Consumes: `saveFxSettings`, `getFxSettings` from `src/lib/fx.ts`; `parseRate`, `isPlausibleRate`, `envFxRate`, `isFxMode` from `src/lib/fxRate.ts`.
- Produces: `assertAdminWrite(): Promise<void>` in `src/lib/admin.ts`;
  `saveFxAction(formData: FormData): Promise<void>` in `admin/actions.ts`.

- [ ] **Step 1: Add the write guard**

Add the import to the top of `src/lib/admin.ts`, beside the existing ones:

```ts
import { DEMO_MODE } from "./demo";
```

Then append the function to the end of the file:

```ts
/**
 * Every admin Server Action calls this first.
 *
 * `DEMO_MODE` deliberately makes /admin readable with no password so the RFQ
 * inbox can be shown without handing out a credential. That is only defensible
 * while the page is read-only: the same flag on a page that can change order
 * statuses or overwrite the catalog would make those actions world-writable.
 */
export async function assertAdminWrite(): Promise<void> {
  if (DEMO_MODE) throw new Error("Admin is read-only in demo mode");
  if (!(await isAdmin())) throw new Error("Not signed in as admin");
}
```

- [ ] **Step 2: Add the i18n strings**

In `src/lib/i18n.ts`, add to the `en` object (before the closing brace):

```ts
  // Exchange rate
  exchangeRate: "Exchange rate",
  fxAutomatic: "Automatic",
  fxManual: "Manual",
  fxPerUsd: "Toman / USD",
  fxFromEnv: "from USD_TO_TOMAN",
  fxApply: "Apply",
  fxConfirm: "Confirm",
  fxCancel: "Cancel",
  fxConfirmPrompt: "Apply this rate?",
  fxAppliesTo:
    "Applies to displayed prices. Invoices keep the rate frozen when they are issued.",
  fxOutOfRange:
    "That rate is more than ten times away from the automatic rate. Check for a stray digit.",
  fxInvalid: "Enter a whole number of Toman.",
```

and the matching Persian to `fa`:

```ts
  exchangeRate: "نرخ ارز",
  fxAutomatic: "خودکار",
  fxManual: "دستی",
  fxPerUsd: "تومان به ازای هر دلار",
  fxFromEnv: "از USD_TO_TOMAN",
  fxApply: "اعمال",
  fxConfirm: "تأیید",
  fxCancel: "انصراف",
  fxConfirmPrompt: "این نرخ اعمال شود؟",
  fxAppliesTo:
    "روی قیمت‌های نمایش‌داده‌شده اعمال می‌شود. نرخ صورتحساب‌ها هنگام صدور ثابت می‌ماند.",
  fxOutOfRange:
    "این نرخ بیش از ده برابر با نرخ خودکار فاصله دارد. رقم اضافه را بررسی کنید.",
  fxInvalid: "یک عدد صحیح به تومان وارد کنید.",
```

- [ ] **Step 3: Write the Server Action**

Create `src/app/[locale]/admin/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdminWrite } from "@/lib/admin";
import { saveFxSettings } from "@/lib/fx";
import { envFxRate, isFxMode, isPlausibleRate, parseRate } from "@/lib/fxRate";

export async function saveFxAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = String(formData.get("locale") || "en");
  const rawMode = String(formData.get("mode") ?? "auto");
  const mode = isFxMode(rawMode) ? rawMode : "auto";

  let manualRate: number | null = null;
  if (mode === "manual") {
    const parsed = parseRate(String(formData.get("rate") ?? ""));
    if (parsed === null) redirect(`/${locale}/admin?fx=invalid`);
    if (!isPlausibleRate(parsed, envFxRate())) {
      redirect(`/${locale}/admin?fx=range`);
    }
    manualRate = parsed;
  }

  await saveFxSettings(mode, manualRate);
  // The catalog is statically rendered with revalidate = 3600, so without this
  // a rate change would take up to an hour to reach the pages that show it.
  revalidatePath("/", "layout");
  redirect(`/${locale}/admin?fx=saved`);
}
```

- [ ] **Step 4: Write the panel**

Create `src/components/FxRatePanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import type { FxMode } from "@/lib/fxRate";

/**
 * Two-step Apply.
 *
 * Typing a rate and moving the toggle change nothing on their own. One
 * keystroke slip here reprices every Toman figure on the site, and nothing
 * about the result looks wrong until a customer says so — cheap to guard,
 * expensive to notice afterwards.
 */
export function FxRatePanel({
  locale,
  mode,
  manualRate,
  envRate,
  effectiveRate,
  disabled,
}: {
  locale: Locale;
  mode: FxMode;
  manualRate: number | null;
  envRate: number;
  effectiveRate: number;
  /** True in demo mode, where the page is public and must stay read-only. */
  disabled?: boolean;
}) {
  const t = getDict(locale);
  const [draftMode, setDraftMode] = useState<FxMode>(mode);
  const [draftRate, setDraftRate] = useState(String(manualRate ?? envRate));
  const [confirming, setConfirming] = useState(false);

  const nextRate = draftMode === "manual" ? Number(draftRate.replace(/[,\s]/g, "")) : envRate;
  const changed = draftMode !== mode || (draftMode === "manual" && nextRate !== manualRate);

  return (
    <section className="mb-4 border border-[var(--color-rule)] p-3">
      <h2 className="mb-2 text-[13px] font-bold">{t.exchangeRate}</h2>

      {/* Not a <form>. The real submission is the page's #fx-save form; these
          controls only build a draft, and the two hidden inputs below mirror it
          across using the HTML `form` attribute. A wrapping form here would
          give the browser something to submit on Enter. */}
      <div>
        <input type="hidden" form="fx-save" name="mode" value={draftMode} />
        <input type="hidden" form="fx-save" name="rate" value={draftRate} />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="mode"
              value="auto"
              checked={draftMode === "auto"}
              onChange={() => {
                setDraftMode("auto");
                setConfirming(false);
              }}
              disabled={disabled}
            />
            {t.fxAutomatic} —{" "}
            <span className="tech">{formatInt(envRate, locale)}</span> {t.fxPerUsd}{" "}
            <span className="text-[var(--color-ink-faint)]">({t.fxFromEnv})</span>
          </label>

          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="mode"
              value="manual"
              checked={draftMode === "manual"}
              onChange={() => {
                setDraftMode("manual");
                setConfirming(false);
              }}
              disabled={disabled}
            />
            {t.fxManual}
            <input
              type="text"
              inputMode="numeric"
              name="rate"
              dir="ltr"
              value={draftRate}
              onChange={(e) => {
                setDraftRate(e.target.value);
                setConfirming(false);
              }}
              disabled={disabled || draftMode !== "manual"}
              className="w-24 text-center"
              aria-label={t.fxPerUsd}
            />
            {t.fxPerUsd}
          </label>
        </div>

        <p className="mt-2 text-[11px] text-[var(--color-ink-muted)]">{t.fxAppliesTo}</p>

        {!disabled && changed && (
          <div className="mt-2 flex items-center gap-2 text-[12px]">
            {confirming ? (
              <>
                <span>
                  {t.fxConfirmPrompt}{" "}
                  <span className="tech">{formatInt(effectiveRate, locale)}</span> →{" "}
                  <strong className="tech">{formatInt(nextRate, locale)}</strong>
                </span>
                <button type="submit" form="fx-save" className="btn-small">
                  {t.fxConfirm}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-[11px] underline"
                >
                  {t.fxCancel}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="btn-small"
              >
                {t.fxApply}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
```

Confirm submits `form="fx-save"` — the real form, rendered by the page in the
next step. Inputs carrying a `form` attribute are included in that form's
FormData even though they sit outside it, which is what lets the draft state
live in a client component while the submission stays a Server Action.

- [ ] **Step 5: Mount it on the admin page**

In `src/app/[locale]/admin/page.tsx`, add imports:

```tsx
import { FxRatePanel } from "@/components/FxRatePanel";
import { saveFxAction } from "./actions";
import { getFxSettings, getFxRate } from "@/lib/fx";
import { envFxRate } from "@/lib/fxRate";
```

Inside the authorised branch, before the quotes query:

```tsx
  const [fxSettings, rate] = await Promise.all([getFxSettings(), getFxRate()]);
```

Then render, directly after the heading block, the hidden real form plus the
panel:

```tsx
      <form action={saveFxAction} id="fx-save" className="hidden">
        <input type="hidden" name="locale" value={l} />
      </form>

      <FxRatePanel
        locale={l}
        mode={fxSettings.mode}
        manualRate={fxSettings.manualRate}
        envRate={envFxRate()}
        effectiveRate={rate}
        disabled={DEMO_MODE}
      />
```

The two hidden inputs that carry `mode` and `rate` into this form are already in
`FxRatePanel` from Step 4 — nothing further to add here.

- [ ] **Step 6: Show the result banner**

Still in `admin/page.tsx`, widen the `searchParams` type to
`{ error?: string; fx?: string }`, and render above the panel:

```tsx
      {fx === "saved" && (
        <p className="mb-2 border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-[12px] text-[var(--color-ok)]">
          {t.exchangeRate}: {formatInt(rate, l)} {t.fxPerUsd}
        </p>
      )}
      {fx === "range" && (
        <p className="mb-2 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
          {t.fxOutOfRange}
        </p>
      )}
      {fx === "invalid" && (
        <p className="mb-2 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
          {t.fxInvalid}
        </p>
      )}
```

- [ ] **Step 7: Verify by hand**

1. `npx tsc --noEmit` — no output.
2. Sign in at `/en/admin` with `ADMIN_PASSWORD`.
3. Switch to Manual, type `118500`, press Apply — the row must change to
   "Apply this rate? 110,000 → 118,500" with Confirm and Cancel. Press Cancel;
   nothing changes.
4. Press Apply then Confirm. The page reloads with the saved banner.
5. Open `/fa/f/oil-resistant-buna-n-o-rings` — Toman prices are ~7.7% higher
   than before.
6. Type `1185000` and Confirm — rejected with the out-of-range message.
7. Switch back to Automatic and Confirm; prices return to the previous values.
8. Set `DEMO_MODE=1`, restart, reload `/en/admin` — the panel renders with every
   control disabled and no Apply button.

- [ ] **Step 8: Commit**

```bash
git add src/lib/admin.ts src/lib/i18n.ts src/components/FxRatePanel.tsx "src/app/[locale]/admin"
git commit -m "Let staff override the exchange rate, behind a confirmation step"
```

---

### Task 6: Rename quotes to orders

One script does the rename, the new columns and the backfill together. Doing the
columns here rather than leaving them to `drizzle-kit push` keeps the whole
migration in one reviewable, ordered transaction.

**Files:**
- Create: `scripts/rename-quotes-to-orders.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `sql`, `assertSafeTarget`, `targetHost` from `src/db/script-client.ts`.
- Produces: the `orders` and `order_items` tables and the `invoice_seq` sequence.

- [ ] **Step 1: Write the script**

Create `scripts/rename-quotes-to-orders.mts`:

```ts
import "dotenv/config";
import { sql, assertSafeTarget, targetHost } from "@/db/script-client";

/**
 * One-shot migration from the RFQ model to the order model.
 *
 * This is deliberately not left to `drizzle-kit push`. Push reconciles by
 * diffing, and a rename looks identical to "drop this table, create that one" —
 * which would silently destroy every submitted request. Renaming explicitly,
 * before push ever sees the schema, is the only safe order.
 *
 * Safe to run twice: every statement checks whether it has already happened.
 */
async function main() {
  assertSafeTarget("rename quotes to orders", "ALLOW_REMOTE_MIGRATION");
  console.log(`→ target: ${targetHost()}`);

  const [{ exists: hasQuotes }] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'quotes'
    ) AS exists
  `;

  await sql.begin(async (tx) => {
    if (hasQuotes) {
      console.log("→ renaming tables, columns, indexes and sequences");
      await tx.unsafe(`
        ALTER TABLE quotes RENAME TO orders;
        ALTER TABLE quote_items RENAME TO order_items;
        ALTER TABLE order_items RENAME COLUMN quote_id TO order_id;
        ALTER INDEX IF EXISTS quotes_ref_key RENAME TO orders_ref_key;
        ALTER INDEX IF EXISTS quotes_created_idx RENAME TO orders_created_idx;
        ALTER INDEX IF EXISTS quote_items_quote_idx RENAME TO order_items_order_idx;
        ALTER SEQUENCE IF EXISTS quotes_id_seq RENAME TO orders_id_seq;
        ALTER SEQUENCE IF EXISTS quote_items_id_seq RENAME TO order_items_id_seq;
      `);
    } else {
      console.log("→ tables already renamed, skipping");
    }

    console.log("→ adding order columns");
    await tx.unsafe(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS user_id uuid,
        ADD COLUMN IF NOT EXISTS requested_total_cents integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS payment_url text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS courier text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS tracking_number text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS invoice_number text,
        ADD COLUMN IF NOT EXISTS fx_rate_to_toman integer,
        ADD COLUMN IF NOT EXISTS invoiced_at timestamptz,
        ADD COLUMN IF NOT EXISTS paid_at timestamptz,
        ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
        ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

      ALTER TABLE order_items
        ADD COLUMN IF NOT EXISTS requested_unit_price_cents integer NOT NULL DEFAULT 0;
    `);

    console.log("→ backfilling");
    await tx.unsafe(`
      UPDATE orders SET requested_total_cents = total_cents
        WHERE requested_total_cents = 0;
      UPDATE order_items SET requested_unit_price_cents = unit_price_cents
        WHERE requested_unit_price_cents = 0;
      UPDATE orders SET status = 'received' WHERE status = 'submitted';
      UPDATE orders SET ref = 'ORD-' || substring(ref from 5) WHERE ref LIKE 'RFQ-%';
    `);

    console.log("→ constraints, indexes and the invoice sequence");
    await tx.unsafe(`
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
      ALTER TABLE orders ADD CONSTRAINT orders_status_check
        CHECK (status IN ('received','invoiced','preparing','shipped',
                          'delivered','cancelled'));

      CREATE UNIQUE INDEX IF NOT EXISTS orders_invoice_number_key
        ON orders (invoice_number) WHERE invoice_number IS NOT NULL;
      CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS orders_email_ref_idx ON orders (lower(email), ref);

      CREATE SEQUENCE IF NOT EXISTS invoice_seq;
    `);
  });

  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders`;
  console.log(`✓ done — ${n} orders`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"`:

```json
"db:rename-orders": "tsx scripts/rename-quotes-to-orders.mts"
```

- [ ] **Step 3: Create a row to migrate**

The migration is worthless if it is only ever tested against an empty table.
Start the database and submit one request through the UI first:

```bash
docker compose up -d db
```

Then in the browser: add a product to the cart, go to `/en/quote`, fill every
required field including phone, and submit. Note the `RFQ-…` reference shown.

- [ ] **Step 4: Run the migration**

Run: `npm run db:rename-orders`

Expected output ends with `✓ done — 1 orders`.

- [ ] **Step 5: Verify the data survived**

Run:

```bash
docker exec isupply-db psql -U isupply -d isupply -c "SELECT ref, status, total_cents, requested_total_cents FROM orders;" -c "SELECT part_number, unit_price_cents, requested_unit_price_cents FROM order_items;"
```

Expected: the reference now starts `ORD-` and keeps its six characters; `status`
is `received`; `requested_total_cents` equals `total_cents`; the item's two
price columns match.

- [ ] **Step 6: Verify it is safe to run twice**

Run: `npm run db:rename-orders`

Expected: prints `→ tables already renamed, skipping`, then `✓ done — 1 orders`,
with no error and no change to the reference.

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/rename-quotes-to-orders.mts
git commit -m "Migrate the quotes tables to the order model"
```

---

### Task 7: Point the application at the renamed tables

The database moved in Task 6; this task moves the code. Between the two the app
is broken, which is why they are adjacent.

**Files:**
- Modify: `src/db/schema.ts:214-263`
- Modify: `src/app/actions.ts:92-153`
- Modify: `src/app/[locale]/admin/page.tsx`
- Modify: `src/seed/index.ts:53`

**Interfaces:**
- Consumes: `OrderStatus` from `src/lib/orders.ts`.
- Produces: `orders` and `orderItems` Drizzle tables; `submitQuoteAction` writing `ORD-` references.

- [ ] **Step 1: Rewrite the schema block**

In `src/db/schema.ts`, replace the whole `quotes` / `quoteItems` block
(lines 210–263, from the `Quotes (RFQ)` banner comment to the end of the file's
`quoteItems` definition) with:

```ts
// ---------------------------------------------------------------------------
// Orders — one row per customer request, from arrival through to delivery
// ---------------------------------------------------------------------------

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    /** Human-facing reference, e.g. ORD-7Q4M2X. Read aloud on the phone. */
    ref: text("ref").notNull(),
    /** Null for a guest checkout, which stays supported. */
    userId: uuid("user_id"),
    /** See lib/orders.ts. A CHECK constraint mirrors this in the database. */
    status: text("status").notNull().default("received"),
    company: text("company").notNull(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    poNumber: text("po_number").notNull().default(""),
    address: text("address").notNull().default(""),
    city: text("city").notNull().default(""),
    country: text("country").notNull().default(""),
    notes: text("notes").notNull().default(""),
    locale: text("locale").notNull().default("en"),
    currency: text("currency").notNull().default("USD"),
    /** Total at the catalog prices the customer saw when they submitted. */
    requestedTotalCents: integer("requested_total_cents").notNull().default(0),
    /** Total at the prices staff finally set. Equal until the order is priced. */
    totalCents: integer("total_cents").notNull().default(0),
    paymentUrl: text("payment_url").notNull().default(""),
    courier: text("courier").notNull().default(""),
    trackingNumber: text("tracking_number").notNull().default(""),
    invoiceNumber: text("invoice_number"),
    /**
     * Toman per USD, frozen when the invoice is issued. Without this, editing
     * the rate would restate the amount owed on invoices already emailed.
     */
    fxRateToToman: integer("fx_rate_to_toman"),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_ref_key").on(t.ref),
    index("orders_created_idx").on(t.createdAt),
    index("orders_status_idx").on(t.status, t.createdAt),
    index("orders_user_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * Line items snapshot part number, name and specs at submission time so a later
 * catalog edit cannot silently rewrite an order that was already invoiced.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    partNumber: text("part_number").notNull(),
    familyName: text("family_name").notNull().default(""),
    specsSnapshot: jsonb("specs_snapshot").$type<SpecBag>().notNull().default({}),
    qty: integer("qty").notNull(),
    /** What the catalog charged at submission. Never edited. */
    requestedUnitPriceCents: integer("requested_unit_price_cents").notNull().default(0),
    /** What staff finally quoted. */
    unitPriceCents: integer("unit_price_cents").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);
```

- [ ] **Step 2: Update the seeder's TRUNCATE list**

In `src/seed/index.ts` line 53, replace `quote_items, quotes` with
`order_items, orders`.

- [ ] **Step 3: Update the submit action**

In `src/app/actions.ts`, change `quoteRef()` to produce the new prefix:

```ts
  return `ORD-${out}`;
```

and rewrite the two inserts inside `submitQuoteAction`'s transaction:

```ts
    const [order] = await tx<{ id: number }[]>`
      INSERT INTO orders (ref, company, contact_name, email, phone, po_number,
                          address, city, country, notes, locale, currency,
                          total_cents, requested_total_cents, status)
      VALUES (
        ${ref},
        ${String(formData.get("company") ?? "")},
        ${String(formData.get("contactName") ?? "")},
        ${String(formData.get("email") ?? "")},
        ${String(formData.get("phone") ?? "")},
        ${String(formData.get("poNumber") ?? "")},
        ${String(formData.get("address") ?? "")},
        ${String(formData.get("city") ?? "")},
        ${String(formData.get("country") ?? "")},
        ${String(formData.get("notes") ?? "")},
        ${locale},
        ${locale === "fa" ? "IRT" : "USD"},
        ${totalCents},
        ${totalCents},
        'received'
      )
      RETURNING id
    `;

    for (const l of lines) {
      await tx`
        INSERT INTO order_items (order_id, product_id, part_number, family_name,
                                 specs_snapshot, qty, unit_price_cents,
                                 requested_unit_price_cents)
        VALUES (${order.id}, ${l.productId}, ${l.partNumber},
                ${locale === "fa" ? l.familyFa : l.familyEn},
                -- Serialise explicitly and cast: passing the object straight
                -- through leaves postgres-js guessing at the parameter type.
                ${JSON.stringify(l.specs)}::jsonb,
                ${l.qty}, ${unitPriceAt(l, l.qty)}, ${unitPriceAt(l, l.qty)})
      `;
    }
```

- [ ] **Step 4: Update the admin read query**

In `src/app/[locale]/admin/page.tsx`, rename the `QuoteRow` type to `OrderRow`
and `QuoteItemRow` to `OrderItemRow`. Type the status field as `OrderStatus`,
not `string` — the CHECK constraint added in Task 6 makes that true at the
database level, and later tasks pass this value straight to `nextStatuses()`
and `<OrderStatusPill>`, both of which require the narrow type:

```tsx
import type { OrderStatus } from "@/lib/orders";

type OrderRow = {
  id: number;
  ref: string;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  poNumber: string;
  city: string;
  country: string;
  notes: string;
  status: OrderStatus;
  locale: string;
  currency: string;
  totalCents: number;
  createdAt: string;
  itemCount: number;
};

type OrderItemRow = {
  id: number;
  orderId: number;
  partNumber: string;
  familyName: string;
  qty: number;
  unitPriceCents: number;
  requestedUnitPriceCents: number;
  specsSnapshot: SpecBag;
};
```

Then replace the two queries:

```tsx
  const orders = await sql<OrderRow[]>`
    SELECT q.id, q.ref, q.company, q.contact_name AS "contactName", q.email,
           q.phone, q.po_number AS "poNumber", q.city, q.country, q.notes,
           q.status, q.locale, q.currency, q.total_cents AS "totalCents",
           q.created_at AS "createdAt",
           (SELECT count(*)::int FROM order_items i WHERE i.order_id = q.id) AS "itemCount"
    FROM orders q ORDER BY q.created_at DESC LIMIT 200
  `;

  const items = orders.length
    ? await sql<OrderItemRow[]>`
        SELECT id, order_id AS "orderId", part_number AS "partNumber",
               family_name AS "familyName", qty,
               unit_price_cents AS "unitPriceCents",
               requested_unit_price_cents AS "requestedUnitPriceCents",
               specs_snapshot AS "specsSnapshot"
        FROM order_items WHERE order_id = ANY(${orders.map((q) => q.id)})
        ORDER BY id
      `
    : [];
```

Rename the local `quotes` variable to `orders` throughout the component, and
`byQuote` to `byOrder` with `i.orderId` as its key.

- [ ] **Step 5: Verify the schema and the code agree**

Run: `npm run db:push`

Expected: drizzle-kit reports **no changes**. Any proposed change means the
script in Task 6 and the schema file have diverged — reconcile before going on,
and never accept a proposed drop.

- [ ] **Step 6: Verify end to end**

1. `npx tsc --noEmit` — no output.
2. `npm test` — all pass.
3. Submit a fresh request through `/en/quote`. The confirmation shows an `ORD-`
   reference.
4. `/en/admin` lists it with its line items and total.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/app/actions.ts "src/app/[locale]/admin/page.tsx" src/seed/index.ts
git commit -m "Point the application at the renamed order tables"
```

---

### Task 8: Status pill, filter, and the shipping transitions

Everything except invoicing, which needs prices and lands in Task 9.

**Files:**
- Create: `src/components/OrderStatusPill.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `src/app/[locale]/admin/actions.ts`
- Modify: `src/app/[locale]/admin/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `assertTransition`, `isOrderStatus`, `type OrderStatus` from `src/lib/orders.ts`; `assertAdminWrite` from `src/lib/admin.ts`.
- Produces: `setOrderStatusAction(formData: FormData): Promise<void>`;
  `<OrderStatusPill locale status />`.

- [ ] **Step 1: Add the i18n strings**

Add to `en`:

```ts
  // Order statuses
  statusReceived: "Received",
  statusInvoiced: "Awaiting payment",
  statusPreparing: "Preparing for shipment",
  statusShipped: "Shipped",
  statusDelivered: "Delivered",
  statusCancelled: "Cancelled",
  // Admin order actions
  markPaid: "Mark payment received",
  markShipped: "Mark shipped",
  markDelivered: "Mark delivered",
  cancelOrder: "Cancel order",
  courier: "Courier",
  trackingNumber: "Tracking number",
  allOrders: "All",
  needsAction: "Needs action",
  trackingRequired: "Enter both a courier and a tracking number.",
```

and to `fa`:

```ts
  statusReceived: "دریافت شد",
  statusInvoiced: "در انتظار پرداخت",
  statusPreparing: "در حال آماده‌سازی",
  statusShipped: "ارسال شد",
  statusDelivered: "تحویل داده شد",
  statusCancelled: "لغو شد",
  markPaid: "ثبت دریافت وجه",
  markShipped: "ثبت ارسال",
  markDelivered: "ثبت تحویل",
  cancelOrder: "لغو سفارش",
  courier: "شرکت حمل",
  trackingNumber: "کد رهگیری",
  allOrders: "همه",
  needsAction: "نیازمند اقدام",
  trackingRequired: "نام شرکت حمل و کد رهگیری هر دو الزامی است.",
```

- [ ] **Step 2: Write the pill**

Create `src/components/OrderStatusPill.tsx`:

```tsx
import { getDict, type Locale } from "@/lib/i18n";
import type { OrderStatus } from "@/lib/orders";

/** Exported so the admin filter links use the same words as the pills. */
export const STATUS_LABEL_KEY = {
  received: "statusReceived",
  invoiced: "statusInvoiced",
  preparing: "statusPreparing",
  shipped: "statusShipped",
  delivered: "statusDelivered",
  cancelled: "statusCancelled",
} as const;

/** Colour carries the same information as the word, for scanning a long queue. */
const TONE: Record<OrderStatus, string> = {
  received: "pill",
  invoiced: "pill pill-warn",
  preparing: "pill pill-warn",
  shipped: "pill",
  delivered: "pill pill-ok",
  cancelled: "pill pill-muted",
};

export function OrderStatusPill({
  locale,
  status,
}: {
  locale: Locale;
  status: OrderStatus;
}) {
  const t = getDict(locale);
  return <span className={TONE[status]}>{t[STATUS_LABEL_KEY[status]]}</span>;
}
```

- [ ] **Step 3: Add the muted pill style**

In `src/app/globals.css`, immediately after the `.pill-warn` rule:

```css
.pill-muted {
  background: var(--color-panel);
  color: var(--color-ink-faint);
}
```

- [ ] **Step 4: Write the transition action**

Add these imports to the top of `src/app/[locale]/admin/actions.ts`, with the
ones already there:

```ts
import { sql } from "@/db";
import { assertTransition, isOrderStatus } from "@/lib/orders";
```

Then append the action to the end of the file:

```ts
export async function setOrderStatusAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = String(formData.get("locale") || "en");
  const id = Number(formData.get("orderId"));
  const to = String(formData.get("status") ?? "");
  if (!Number.isInteger(id) || id <= 0 || !isOrderStatus(to)) {
    redirect(`/${locale}/admin?error=bad-request`);
  }

  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM orders WHERE id = ${id}
  `;
  if (!row || !isOrderStatus(row.status)) redirect(`/${locale}/admin?error=not-found`);

  // Throws rather than redirecting: reaching here with an illegal pair means a
  // hand-crafted post or a bug, not a mistake a form can make.
  assertTransition(row.status, to);

  // One explicit statement per destination. A single query with an
  // interpolated column name would be shorter and much harder to read at the
  // one place in this codebase that decides whether goods have shipped.
  if (to === "shipped") {
    const courier = String(formData.get("courier") ?? "").trim();
    const tracking = String(formData.get("trackingNumber") ?? "").trim();
    // The whole point of this state is showing the customer a tracking number.
    if (!courier || !tracking) redirect(`/${locale}/admin?error=tracking`);
    await sql`
      UPDATE orders
      SET status = 'shipped', courier = ${courier},
          tracking_number = ${tracking}, shipped_at = now()
      WHERE id = ${id}
    `;
  } else if (to === "preparing") {
    await sql`UPDATE orders SET status = 'preparing', paid_at = now() WHERE id = ${id}`;
  } else if (to === "delivered") {
    await sql`UPDATE orders SET status = 'delivered', delivered_at = now() WHERE id = ${id}`;
  } else if (to === "cancelled") {
    await sql`UPDATE orders SET status = 'cancelled' WHERE id = ${id}`;
  } else {
    // 'received' and 'invoiced' are not reachable here: nothing transitions to
    // 'received', and 'invoiced' belongs to issueInvoiceAction, which has the
    // prices and the payment link this action does not.
    redirect(`/${locale}/admin?error=bad-request`);
  }

  revalidatePath("/", "layout");
  redirect(`/${locale}/admin?ok=status`);
}
```

- [ ] **Step 5: Render the filter and the actions**

In `src/app/[locale]/admin/page.tsx`:

1. Widen `searchParams` to `{ error?: string; fx?: string; ok?: string; status?: string }`.
2. Filter the query — replace the `FROM orders q ORDER BY` clause with:

```tsx
    FROM orders q
    ${statusFilter ? sql`WHERE q.status = ${statusFilter}` : sql`WHERE q.status <> 'delivered' AND q.status <> 'cancelled'`}
    ORDER BY q.created_at DESC LIMIT 200
```

with, above the query:

```tsx
  const statusFilter = typeof sp.status === "string" && isOrderStatus(sp.status)
    ? sp.status
    : null;
```

3. Render the filter links above the list:

```tsx
      <nav className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Link
          href={`/${l}/admin`}
          className={statusFilter === null ? "font-bold !text-[var(--color-ink)]" : undefined}
        >
          {t.needsAction}
        </Link>
        {ORDER_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${l}/admin?status=${s}`}
            className={statusFilter === s ? "font-bold !text-[var(--color-ink)]" : undefined}
          >
            {t[STATUS_LABEL_KEY[s]]}
          </Link>
        ))}
      </nav>
```

This needs `import Link from "next/link";` and
`import { ORDER_STATUSES, isOrderStatus, nextStatuses } from "@/lib/orders";`
at the top of the file, plus the label map — export it from
`OrderStatusPill.tsx` so the pill and the filter cannot drift apart. In
`src/components/OrderStatusPill.tsx`, change `const LABEL_KEY` to
`export const STATUS_LABEL_KEY`, update its own use, and import it here.
4. In each `<summary>`, add `<OrderStatusPill locale={l} status={q.status} />`
   after the reference.
5. In each expanded body, render one form per legal next status from
   `nextStatuses(q.status)`:

```tsx
              {nextStatuses(q.status).map((next) => (
                <form key={next} action={setOrderStatusAction} className="inline-flex items-center gap-1.5">
                  <input type="hidden" name="locale" value={l} />
                  <input type="hidden" name="orderId" value={q.id} />
                  <input type="hidden" name="status" value={next} />
                  {next === "shipped" && (
                    <>
                      <input name="courier" placeholder={t.courier} className="w-28 text-[11px]" required />
                      <input name="trackingNumber" dir="ltr" placeholder={t.trackingNumber} className="tech w-36 text-[11px]" required />
                    </>
                  )}
                  <button type="submit" className="btn-small" disabled={DEMO_MODE}>
                    {next === "preparing" ? t.markPaid
                      : next === "shipped" ? t.markShipped
                      : next === "delivered" ? t.markDelivered
                      : next === "cancelled" ? t.cancelOrder
                      : next}
                  </button>
                </form>
              ))}
```

`invoiced` is deliberately absent from this list — Task 9 renders it, because
issuing an invoice needs prices and a payment link.

6. Show courier and tracking in the detail list when present:

```tsx
              {q.courier && <Row label={t.courier} value={q.courier} />}
              {q.trackingNumber && <Row label={t.trackingNumber} value={q.trackingNumber} tech />}
```

and add `courier`, `trackingNumber`, `invoiceNumber` to the `OrderRow` type and
the SELECT list.

- [ ] **Step 6: Verify by hand**

1. `npx tsc --noEmit` — no output; `npm test` — all pass.
2. On `/en/admin`, the migrated order shows a "Received" pill.
3. Its only buttons are "Cancel order" — no ship button, because `received`
   cannot reach `shipped`.
4. Filter links switch the list; `Needs action` hides delivered and cancelled.
5. Cancel the order. It disappears from `Needs action` and appears under
   `Cancelled` with no buttons at all.
6. Submit a fresh request, and confirm the same.

- [ ] **Step 7: Commit**

```bash
git add src/components/OrderStatusPill.tsx src/lib/i18n.ts src/app/globals.css "src/app/[locale]/admin"
git commit -m "Add the order status pill, queue filter and shipping transitions"
```

---

### Task 9: Pricing and issuing an invoice

The one transition that changes money. Assigns the invoice number and freezes
the exchange rate.

**Files:**
- Modify: `src/app/[locale]/admin/actions.ts`
- Modify: `src/app/[locale]/admin/page.tsx`
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Consumes: `getFxRate` from `src/lib/fx.ts`; `assertTransition` from `src/lib/orders.ts`.
- Produces: `issueInvoiceAction(formData: FormData): Promise<void>`.

- [ ] **Step 1: Add the i18n strings**

Add to `en`:

```ts
  issueInvoice: "Issue invoice",
  paymentLink: "Payment link",
  invoiceNumber: "Invoice no.",
  finalUnitPrice: "Final price",
  paymentLinkRequired: "A payment link is required to issue an invoice.",
  pricesRequired: "Every line needs a price of at least zero.",
```

and to `fa`:

```ts
  issueInvoice: "صدور صورتحساب",
  paymentLink: "لینک پرداخت",
  invoiceNumber: "شماره صورتحساب",
  finalUnitPrice: "قیمت نهایی",
  paymentLinkRequired: "برای صدور صورتحساب، لینک پرداخت الزامی است.",
  pricesRequired: "برای همه ردیف‌ها باید قیمت وارد شود.",
```

- [ ] **Step 2: Write the action**

Add the import to the top of `src/app/[locale]/admin/actions.ts`:

```ts
import { getFxRate } from "@/lib/fx";
```

Then append the action to the end of the file:

```ts
/**
 * Prices the order, assigns an invoice number, and freezes the exchange rate.
 *
 * All three happen in one transaction. An order carrying an invoice number but
 * no frozen rate would render a Persian invoice at whatever the rate happened
 * to be when someone opened it — a different amount owed on every viewing.
 */
export async function issueInvoiceAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = String(formData.get("locale") || "en");
  const id = Number(formData.get("orderId"));
  if (!Number.isInteger(id) || id <= 0) redirect(`/${locale}/admin?error=bad-request`);

  const paymentUrl = String(formData.get("paymentUrl") ?? "").trim();
  if (!paymentUrl) redirect(`/${locale}/admin?error=payment-link`);

  const [order] = await sql<{ status: string }[]>`
    SELECT status FROM orders WHERE id = ${id}
  `;
  if (!order || !isOrderStatus(order.status)) redirect(`/${locale}/admin?error=not-found`);
  assertTransition(order.status, "invoiced");

  const itemRows = await sql<{ id: number }[]>`
    SELECT id FROM order_items WHERE order_id = ${id} ORDER BY id
  `;

  // Parse every price before writing anything, so a bad value on the last line
  // cannot leave the order half-priced.
  const priced: { id: number; cents: number }[] = [];
  for (const row of itemRows) {
    const raw = String(formData.get(`price_${row.id}`) ?? "").trim();
    const dollars = Number(raw);
    if (raw === "" || !Number.isFinite(dollars) || dollars < 0) {
      redirect(`/${locale}/admin?error=prices`);
    }
    priced.push({ id: row.id, cents: Math.round(dollars * 100) });
  }

  const rate = await getFxRate();

  await sql.begin(async (tx) => {
    for (const p of priced) {
      await tx`UPDATE order_items SET unit_price_cents = ${p.cents} WHERE id = ${p.id}`;
    }
    await tx`
      UPDATE orders o
      SET status = 'invoiced',
          invoiced_at = now(),
          payment_url = ${paymentUrl},
          fx_rate_to_toman = ${rate},
          invoice_number = 'INV-' || to_char(now(), 'YYYY') || '-' ||
                           lpad(nextval('invoice_seq')::text, 4, '0'),
          total_cents = (
            SELECT COALESCE(SUM(i.unit_price_cents * i.qty), 0)
            FROM order_items i WHERE i.order_id = o.id
          )
      WHERE o.id = ${id}
    `;
  });

  revalidatePath("/", "layout");
  redirect(`/${locale}/admin?ok=invoiced`);
}
```

- [ ] **Step 3: Render the pricing form**

In `src/app/[locale]/admin/page.tsx`, add `issueInvoiceAction` to the imports
and `requestedUnitPriceCents` to `OrderItemRow` and its SELECT list. Then, when
`q.status === "received"`, wrap the item table in a form and add an editable
price column:

```tsx
            {q.status === "received" ? (
              <form action={issueInvoiceAction}>
                <input type="hidden" name="locale" value={l} />
                <input type="hidden" name="orderId" value={q.id} />
                <table className="spec-table">
                  <thead>
                    <tr>
                      <th>{t.partNumber}</th>
                      <th>{t.products}</th>
                      <th className="num">{t.qty}</th>
                      <th className="num">{t.unitPrice}</th>
                      <th className="num">{t.finalUnitPrice}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(byOrder.get(q.id) ?? []).map((i) => (
                      <tr key={i.id}>
                        <td className="tech font-bold">{i.partNumber}</td>
                        <td className="whitespace-normal">{i.familyName}</td>
                        <td className="num tech tech-num">{i.qty}</td>
                        <td className="num tech tech-num text-[var(--color-ink-muted)]">
                          {(i.requestedUnitPriceCents / 100).toFixed(2)}
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            dir="ltr"
                            name={`price_${i.id}`}
                            defaultValue={(i.unitPriceCents / 100).toFixed(2)}
                            className="tech w-20 text-end"
                            required
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="url"
                    name="paymentUrl"
                    dir="ltr"
                    placeholder={t.paymentLink}
                    className="w-72 text-[11px]"
                    required
                  />
                  <button type="submit" className="btn-primary" disabled={DEMO_MODE}>
                    {t.issueInvoice}
                  </button>
                </div>
              </form>
            ) : (
              <table className="spec-table">
                <thead>
                  <tr>
                    <th>{t.partNumber}</th>
                    <th>{t.products}</th>
                    <th className="num">{t.qty}</th>
                    <th className="num">{t.unitPrice}</th>
                    <th className="num">{t.lineTotal}</th>
                  </tr>
                </thead>
                <tbody>
                  {(byOrder.get(q.id) ?? []).map((i) => (
                    <tr key={i.id}>
                      <td className="tech font-bold">{i.partNumber}</td>
                      <td className="whitespace-normal">{i.familyName}</td>
                      <td className="num tech tech-num">{i.qty}</td>
                      <td className="num tech tech-num">
                        {formatPrice(i.unitPriceCents, q.locale === "fa" ? "fa" : "en", rate)}
                      </td>
                      <td className="num tech tech-num">
                        {formatPrice(i.unitPriceCents * i.qty, q.locale === "fa" ? "fa" : "en", rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
```

The read-only branch is the table that was already there, with `key={i.id}`
instead of the old `key={`${i.partNumber}-${idx}`}` — `order_items.id` is now
selected, and a stable database key beats an index.

- [ ] **Step 4: Show the invoice details once issued**

In the detail list, add:

```tsx
              {q.invoiceNumber && <Row label={t.invoiceNumber} value={q.invoiceNumber} tech />}
              {q.paymentUrl && <Row label={t.paymentLink} value={q.paymentUrl} tech />}
```

with `paymentUrl` added to `OrderRow` and its SELECT list.

- [ ] **Step 5: Add the error banners**

Add a local component at the bottom of `admin/page.tsx`, beside the existing
`Row` helper, rather than pasting the same classes five times:

```tsx
function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
      {children}
    </p>
  );
}
```

Then render, above the order list:

```tsx
      {error === "payment-link" && <ErrorBanner>{t.paymentLinkRequired}</ErrorBanner>}
      {error === "prices" && <ErrorBanner>{t.pricesRequired}</ErrorBanner>}
      {error === "tracking" && <ErrorBanner>{t.trackingRequired}</ErrorBanner>}
      {error === "not-found" && <ErrorBanner>{t.noResults}</ErrorBanner>}
```

and replace the two red banners added in Task 5 (`fx === "range"` and
`fx === "invalid"`) with `<ErrorBanner>` so there is one definition of that
style in the file.

- [ ] **Step 6: Verify the whole pipeline by hand**

1. `npx tsc --noEmit` — no output; `npm test` — all pass.
2. Submit a request through `/en/quote`.
3. On `/en/admin`, open it. Change one line's final price. Submit without a
   payment link — rejected with the payment link message.
4. Add `https://example.com/pay/1` and issue the invoice. The status becomes
   "Awaiting payment" and an `INV-2026-0001` number appears.
5. Check the frozen rate:

```bash
docker exec isupply-db psql -U isupply -d isupply -c "SELECT ref, status, invoice_number, fx_rate_to_toman, total_cents FROM orders ORDER BY id DESC LIMIT 1;"
```

Expected: `fx_rate_to_toman` matches the current effective rate, and
`total_cents` equals the sum of your edited prices times quantities.

6. Change the exchange rate in the FX panel, reload, and confirm
   `fx_rate_to_toman` on that order is **unchanged**.
7. Mark payment received → "Preparing for shipment".
8. Mark shipped with a blank tracking number — rejected. With both fields —
   status "Shipped", both values shown.
9. Mark delivered. No buttons remain.

- [ ] **Step 7: Commit**

```bash
git add "src/app/[locale]/admin" src/lib/i18n.ts
git commit -m "Price an order and issue its invoice, freezing the exchange rate"
```

---

## Phase 1 done

At this point staff can run the whole pipeline: receive a request, price it,
issue an invoice with a payment link, record payment, ship with tracking, and
mark delivery. The exchange rate is settable with a confirmation step, and every
invoice keeps the rate it was issued at.

Not built here, each with its own plan: the invoice page and print stylesheet
(Phase 2), customer accounts and `/account` (Phase 3), guest tracking (Phase 4),
and bulk product import (Phase 5).
