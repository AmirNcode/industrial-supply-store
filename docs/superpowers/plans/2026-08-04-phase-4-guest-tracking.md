# Guest Order Tracking — Implementation Plan (Phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Someone who ordered without an account can check where that order has got to, using the reference and the email they placed it with.

**Architecture:** One public page with a two-field form. Both fields must match the same row. The response carries status, timeline, courier and tracking number — and nothing else. No prices, no line items, no invoice.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), postgres-js raw SQL, Tailwind v4, `node:test` via `tsx`.

**Source spec:** `docs/superpowers/specs/2026-07-31-accounts-orders-admin-design.md`, section `/[locale]/track`.

**Depends on:** Phase 1 (orders domain) and Phase 3 (`OrderTimeline`, which this reuses).

## Global Constraints

- **The reference alone is not enough.** A reference is six characters from a 32-symbol alphabet. Pairing it with the email it was placed under is what gates access; the reference alone would expose a company name and an order's contents to anyone who guessed or found one.
- **The payload stays thin.** Status, the timeline dates, courier and tracking number. No prices, no line items, no invoice link, no address. A customer who wants the rest has an account.
- **Failures are uniform.** "No order found with that reference and email address" for every miss — wrong reference, wrong email, right reference with the wrong email. Success and failure take the same path so the form cannot be used to test which addresses have ordered.
- This page is public. It calls no admin helper and needs no session.
- Every user-visible string goes in **both** dictionaries in `src/lib/i18n.ts`.
- Order references stay Latin digits in both locales — `class="tech"`, `dir="ltr"` on the input.
- Locale comes from `safeLocale`/`isLocale`. Never interpolate an unvalidated value into a redirect.
- Postgres runs in Docker as `isupply-db` on host port **5434**. This phase needs no schema change — do not run `npm run db:push`.
- TypeScript strict mode, ES modules, `@/*` aliased to `src/*`.

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/lib/trackRef.ts` | Normalising and shape-checking a typed reference. Pure. |
| `src/lib/trackRef.test.ts` | Tests for it. |
| `src/db/trackQueries.ts` | `findOrderForTracking(ref, email)`: the paired lookup, returning only the thin payload. |
| `src/app/[locale]/track/page.tsx` | The form and the result. |

**Modified**

| File | Change |
| --- | --- |
| `src/lib/i18n.ts` | Tracking strings in both dictionaries. |
| `src/components/Footer.tsx` | A link to the tracking page. |
| `src/app/[locale]/quote/submitted/page.tsx` | Tell the customer where to check on it. |

---

### Task 1: Reference normalisation and the paired lookup

**Files:**
- Create: `src/lib/trackRef.ts`, `src/lib/trackRef.test.ts`, `src/db/trackQueries.ts`

**Interfaces:**
- Consumes: `sql` from `@/db`.
- Produces: `normaliseRef(raw: string): string | null`; `type TrackedOrder`, `findOrderForTracking(ref: string, email: string): Promise<TrackedOrder | null>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/trackRef.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseRef } from "./trackRef";

test("a well-formed reference passes through uppercased", () => {
  assert.equal(normaliseRef("ORD-7Q4M2X"), "ORD-7Q4M2X");
  assert.equal(normaliseRef("ord-7q4m2x"), "ORD-7Q4M2X");
  assert.equal(normaliseRef("  ORD-7Q4M2X  "), "ORD-7Q4M2X");
});

test("the prefix is optional, because people read out the part after it", () => {
  assert.equal(normaliseRef("7Q4M2X"), "ORD-7Q4M2X");
  assert.equal(normaliseRef("7q4m2x"), "ORD-7Q4M2X");
});

test("the old RFQ prefix is accepted and translated", () => {
  // References issued before the rename are printed on confirmations people
  // still have. Rejecting them would be technically correct and useless.
  assert.equal(normaliseRef("RFQ-7Q4M2X"), "ORD-7Q4M2X");
});

test("anything not of that shape is refused", () => {
  assert.equal(normaliseRef(""), null);
  assert.equal(normaliseRef("ORD-"), null);
  assert.equal(normaliseRef("ORD-TOOLONG1"), null);
  assert.equal(normaliseRef("ORD-SHORT"), null);
  assert.equal(normaliseRef("ORD-7Q4M2!"), null);
  assert.equal(normaliseRef("' OR 1=1 --"), null);
});

test("the ambiguous characters the alphabet excludes are refused", () => {
  // The reference alphabet deliberately omits O/0 and I/1 so it can be read
  // aloud. A reference containing one is a mistranscription, not a lookup.
  assert.equal(normaliseRef("ORD-7Q4M2O"), null);
  assert.equal(normaliseRef("ORD-7Q4M2I"), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test` — fails, `Cannot find module './trackRef'`.

- [ ] **Step 3: Implement**

Create `src/lib/trackRef.ts`:

```ts
/**
 * Normalising a reference someone typed off a printed confirmation or read
 * back over the phone.
 *
 * The alphabet omits O/0 and I/1 precisely so it survives being read aloud, so
 * a reference containing one of them is a transcription error rather than a
 * lookup — refusing it here gives a clearer answer than a database miss would.
 *
 * Kept free of imports so it can be tested without a database.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BODY = new RegExp(`^[${ALPHABET}]{6}$`);

export function normaliseRef(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  const body = trimmed.replace(/^(ORD|RFQ)-/, "");
  return BODY.test(body) ? `ORD-${body}` : null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test` — five more tests than before, `fail 0`.

- [ ] **Step 5: Write the lookup**

Create `src/db/trackQueries.ts`:

```ts
import "server-only";
import { sql } from "./index";

/**
 * Deliberately thin.
 *
 * A reference is six characters, so the email is what actually gates this —
 * and an email is guessable in a way a password is not. Everything a guess
 * would reveal is therefore left out: no prices, no line items, no address,
 * no invoice. Status and a tracking number are what someone waiting for a
 * parcel needs, and are the least this can expose while still being useful.
 */
export type TrackedOrder = {
  ref: string;
  status: string;
  courier: string;
  trackingNumber: string;
  createdAt: string;
  invoicedAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
};

export async function findOrderForTracking(
  ref: string,
  email: string,
): Promise<TrackedOrder | null> {
  const rows = await sql<TrackedOrder[]>`
    SELECT ref, status, courier, tracking_number AS "trackingNumber",
           created_at AS "createdAt", invoiced_at AS "invoicedAt",
           paid_at AS "paidAt", shipped_at AS "shippedAt",
           delivered_at AS "deliveredAt"
    FROM orders
    WHERE ref = ${ref} AND lower(email) = lower(${email})
    LIMIT 1
  `;
  return rows[0] ?? null;
}
```

Both predicates are in the query. Fetching by reference and comparing the email
afterwards would be the same logic with a window in which the wrong row exists
in memory, and it is the kind of check a later edit quietly drops.

The `orders_email_ref_idx` index on `(lower(email), ref)` created in Phase 1
serves this exactly.

- [ ] **Step 6: Commit**

Run `npx tsc --noEmit` (no output) and `npm test`.

```bash
git add src/lib/trackRef.ts src/lib/trackRef.test.ts src/db/trackQueries.ts
git commit -m "Add reference normalisation and the paired tracking lookup"
```

---

### Task 2: The tracking page

**Files:**
- Create: `src/app/[locale]/track/page.tsx`
- Modify: `src/lib/i18n.ts`, `src/components/Footer.tsx`, `src/app/[locale]/quote/submitted/page.tsx`

**Interfaces:**
- Consumes: `normaliseRef`, `findOrderForTracking`, `OrderTimeline` (Phase 3), `isLocale`, `getDict`.
- Produces: the route.

- [ ] **Step 1: Add the strings**

Add to `en`:

```ts
  // Guest tracking
  trackOrder: "Track an order",
  trackIntro:
    "Enter your order reference and the email address you used. Both must match.",
  trackRefLabel: "Order reference",
  trackSubmit: "Find order",
  trackNotFound: "No order found with that reference and email address.",
  trackCourier: "Courier",
  trackNoTracking: "No tracking number yet.",
  trackHaveAccount:
    "With an account you can see prices, invoices and every order in one place.",
```

and to `fa`:

```ts
  trackOrder: "پیگیری سفارش",
  trackIntro:
    "شماره سفارش و ایمیلی که با آن ثبت کرده‌اید را وارد کنید. هر دو باید مطابقت داشته باشند.",
  trackRefLabel: "شماره سفارش",
  trackSubmit: "جستجوی سفارش",
  trackNotFound: "سفارشی با این شماره و ایمیل یافت نشد.",
  trackCourier: "شرکت حمل",
  trackNoTracking: "هنوز کد رهگیری ثبت نشده است.",
  trackHaveAccount:
    "با ساخت حساب کاربری می‌توانید قیمت‌ها، صورتحساب‌ها و همه سفارش‌ها را یکجا ببینید.",
```

- [ ] **Step 2: Write the page**

Create `src/app/[locale]/track/page.tsx` as a Server Component reading its
inputs from `searchParams` — a GET form, so a result is linkable and a reload
does not re-post.

```tsx
export default async function TrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ref?: string; email?: string }>;
}) {
```

Behaviour:

1. Validate the locale with `isLocale`, `notFound()` otherwise.
2. Read `ref` and `email` from `searchParams`. If either is absent, render the
   form alone with no message — a first visit is not a failure.
3. With both present: `normaliseRef(ref)`. If it returns null, render
   `t.trackNotFound` — the same message a real miss produces. A distinct
   "malformed reference" message would tell someone probing which of their two
   inputs to vary.
4. Otherwise call `findOrderForTracking`. Null → `t.trackNotFound`.
5. Found → render the reference in `class="tech"`, an `<OrderStatusPill>`,
   `<OrderTimeline>`, and — once shipped — the courier and tracking number
   with `class="tech"`. Before that, `t.trackNoTracking`.
6. Below any result, `t.trackHaveAccount` linking to `/[locale]/account/signup`.

The form: `method="get"`, an `ORD-XXXXXX` reference field with `dir="ltr"`
and `class="tech"`, an `type="email"` field with `dir="ltr"`, both `required`,
and a submit button. No `locale` hidden field is needed — the action is a GET
to the same path.

Do not render prices, line items, the address or an invoice link. If you find
yourself wanting to, that is the account's job.

- [ ] **Step 3: Link to it**

In `src/components/Footer.tsx`, add a link to `/${locale}/track` labelled
`t.trackOrder`, matching the existing footer link styling.

In `src/app/[locale]/quote/submitted/page.tsx`, below the reference, add a
sentence linking to `/${locale}/track` so the person holding a fresh reference
knows where to use it.

- [ ] **Step 4: Verify**

`npx tsc --noEmit` clean, `npm test` passing.

With the dev server running and using the live orders (`ORD-7647RZ` and
`ORD-DH4XH5` — read their emails out of the database first):

```bash
docker exec isupply-db psql -U isupply -d isupply -c "SELECT ref, email, status FROM orders ORDER BY id;"
```

1. `/en/track` with no parameters renders the form and no message.
2. Correct reference plus correct email → the order's status and timeline.
3. Correct reference plus a wrong email → `t.trackNotFound`.
4. A reference that does not exist → the same message, word for word.
5. A malformed reference (`ORD-!!!`) → the same message again.
6. The reference typed without its prefix and in lower case → still found.
7. The delivered order shows its courier and tracking number; the invoiced one
   shows `t.trackNoTracking`.
8. View the page source of a successful result and confirm no price, no line
   item and no address appears anywhere in it.
9. `/fa/track` renders right-to-left with the reference still left-to-right.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/track" src/lib/i18n.ts src/components/Footer.tsx "src/app/[locale]/quote/submitted/page.tsx"
git commit -m "Let a guest track an order with its reference and email"
```

---

## Phase 4 done

Someone who ordered without an account can see where it has got to, without
that lookup exposing anything a guessed reference should not reveal.

Known gap, recorded in the spec: there is no rate limiting on this form. The
uniform failure message limits what an attempt teaches, but not how many
attempts are possible. Meaningful protection needs shared state across
serverless instances and is deferred with the rest of the auth hardening.
