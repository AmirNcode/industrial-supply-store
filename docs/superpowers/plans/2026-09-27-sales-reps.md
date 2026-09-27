# Sales Reps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, natively in one session — the owner's standing rule is no subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-created sales rep accounts that manage their own customers, place orders for them, share a private pay link, and see sales and commission — with commission locked at order placement and earned on delivery, reported in rial on the Persian calendar.

**Architecture:** Reps are a third, independent identity (own table, own signed cookie with a derived key, own route tree under `/[locale]/rep`), mirroring how staff and customers share nothing today. Every rule about money lives in one place per layer: SQL money in `src/db/repMoney.ts`, Persian-calendar bucketing and summaries in pure `src/lib` modules. Orders are stamped with rep and rate inside the existing submission transaction, so a customer's own order and a rep-built one take one code path.

**Tech Stack:** Next.js 16 App Router (Server Components, Server Actions, one Route Handler), postgres-js raw SQL, Drizzle schema definition only, Tailwind v4, `node:test` via `tsx`, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-sales-reps-design.md` (approved 2026-09-27). Read it first; this plan argues from it.

**Execution notes**

- Branch `feat/sales-reps`. Commit after every task. Never push. Never run a `*:remote` script. The only database touched is the local Docker one.
- Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (repository rule). The ones this plan leans on: `01-app/03-api-reference/03-file-conventions/route.md`, `…/04-functions/cookies.md`, `…/04-functions/headers.md`, `…/03-file-conventions/route-groups.md`.
- Pure modules, queries, actions, SQL and tests are given in full. Page steps give the exact data, actions, fields and states, and name the existing page whose markup to follow; this plan is executed by the session that wrote it, so full JSX is written once, in the code, not twice.
- `src/lib/i18n.ts` types `fa` as `typeof en`: every key listed in Appendix A for a task is added to **both** dictionaries in that task, or `tsc` fails.
- Local verification recipe (servers, admin test password, build without touching the live database) is Appendix B. Use it verbatim.
- "Wrap in `ConfirmSubmit`" always means the order queue's usage: inside the form, `<ConfirmSubmit label={…} title={…} continueLabel={t.confirmContinue} discardLabel={t.confirmDiscard} disabled={DEMO_MODE /* false on rep pages */} details={[{ label, value, tech? }]} />`, where `details` names what is being confirmed (the rep's username, the customer's ID, the payout amount).
- When a later task adds imports to a file an earlier task created, merge them into the existing import statements rather than adding a second one from the same module.

## Global Constraints

- Rep password: at least `MIN_PASSWORD_LENGTH` (8) characters after Persian/Arabic digits become ASCII; must contain `[A-Z]`, `[0-9]` and `[^\p{L}\p{N}\s]`. Hash and verify the digit-normalized string.
- Customer password rules unchanged (8 characters minimum).
- Customer ID: `^[0-9]{7}$`; last 7 digits of the phone, else random `1000000–9999999`; never changes.
- Rep username: `^[a-z0-9._-]{3,32}$`, stored lower-case.
- Commission: integer basis points `0–10000`; typed as a percent with at most two decimals.
- Referral code: 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; cookie `isupply_ref`, 30 days, latest link wins.
- Rep session cookie `isupply_rep`: `v1.<repId>.<sessionVersion>.<expiryMs>.<signature>`, HMAC-SHA256 keyed by `HMAC(AUTH_SECRET, "rep-session")`, 14 days.
- Pay token: `^[0-9a-f]{64}$`, column default `replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')`.
- `sales_rial = ROUND(total_cents::numeric * fx_rate_to_rial / 100)`; `commission_rial = ROUND(total_cents::numeric * fx_rate_to_rial * commission_rate_bp / 1000000)` — defined only in `src/db/repMoney.ts`.
- A sale is an order with `status = 'delivered'`; its month is the Persian month of `delivered_at` in `Asia/Tehran`.
- Rep-facing money is always IRR. Catalog pages are unchanged and show reps what customers see.
- Rate limits: `repSignIn` 10 / 15 min; `repWrite` 60 / 10 min; `repOrderSubmit` 30 / 10 min.
- A temporary password is shown once, from the `isupply_shown_once` cookie (30 seconds), never in a URL.
- Follow-up choices: 1, 3, 7, 14, 30 days from today in Tehran.
- No new action calls `revalidatePath`. Every admin action calls `await assertAdminWrite()` first. A rep's id comes only from the session. Another rep's resource is a 404, never a 403.
- Persian UI says گذرواژه for password (the existing dictionary's term), never رمز عبور.
- Admin forms are `disabled={DEMO_MODE}`, like the existing settings page.

## Review Focus

1. **Persian digits and separators in typed numbers** — a customer ID typed as `۳۴۵۶۷۸۹`, a phone as `۰۹۱۲…`, a commission as `۲٫۵` or `۵٪`, a rial amount as `۱۲٬۵۰۰٬۰۰۰`, a rep password containing `۱۴۰۵`. Each must mean exactly what the ASCII version means. Tests: Task 1 (`parseLogin`, `codeFromPhone`, `parseCommissionPercent`), Task 2 (`repPasswordProblems`), Task 23 (`parseRialAmount`).
2. **A hand-crafted post naming another rep's customer or order** — edit, reset, note, follow-up, New order, checkout, reorder. Nothing may change and the response is not-found. Tests: Task 9 integration (scoping), Task 13 (`placedByRepId` mismatch → `customer-moved`), Task 17 (`getOrderForRep`/`getReorderLines` for rep B → null).
3. **A delivery at Tehran midnight** — 00:01 on 1 Mehr 1405 is still 22 September in UTC and must count in Mehr; 23:59 on 31 Shahrivar must count in Shahrivar. Test: Task 8.
4. **A rep deactivated in the gap** — between a customer's cart and their submit, or behind a referral link opened earlier. Nobody is credited; the sign-up lands unassigned. Tests: Task 4 (`getActiveRepByReferralCode` null once inactive), Task 13 (inactive rep not stamped).
5. **Malformed or foreign pay tokens** — uppercase, too short, or a well-formed token used as another order's invoice key. 404 with nothing leaked, and no query for junk. Tests: Task 15 (`isPayToken`, `payTokensEqual`, `getOrderByPayToken` on an unknown token).

---

## File map

**New pure modules (`src/lib`, unit-tested, no database):** `digits.ts`, `ids.ts`, `customerCode.ts`, `repAccount.ts`, `repPassword.ts`, `tempPassword.ts`, `repSessionToken.ts`, `persianCalendar.ts`, `bankDetails.ts`, `payToken.ts`, `repStats.ts`. Additions to `password.ts`, `money.ts`, `rateLimit.ts`.

**New server-only modules (`src/lib`):** `repSession.ts` (cookie + current rep), `shownOnce.ts` (one-time credential), `siteOrigin.ts` (absolute links), `referral.ts` (referral cookie), `repOrderContext.ts` ("ordering for" cookie), `bankSettings.ts` (bank fields in `app_settings`), `repDashboard.ts` (loads a rep's summary).

**New queries (`src/db`):** `repQueries.ts`, `customerQueries.ts`, `noteQueries.ts`, `repOrderQueries.ts`, `repMoney.ts`. Changes to `schema.ts`, `userQueries.ts`, `orderSubmissionQueries.ts`, `accountQueries.ts`, `invoiceQueries.ts`. New test `salesReps.integration.test.ts`.

**New components:** `PanelTabs.tsx` (moved from the admin folder), `Banners.tsx`, `ShareButton.tsx`, `ShownOnceCredential.tsx`, `CustomerNotes.tsx`, `FollowUpControl.tsx`, `OrderView.tsx`, `BankDetailsPanel.tsx`, `BankDetailsForm.tsx`, `RepDashboard.tsx`, `CommissionReport.tsx`.

**New routes:** `rep/signin`, `rep/actions.ts`, `rep/(session)/password`, `rep/(portal)/{page, customers, customers/new, customers/[id], orders, orders/[ref], commission}`, `r/[code]/route.ts`, `pay/[token]`, `account/password`, `admin/(panel)/reps{,/[id]}`, `admin/(panel)/customers{,/[id]}`.

**Other:** `supabase/migrations/20260927120000_add_sales_reps.sql`, `scripts/verify-remote.mts`, `scripts/seed-reps.mts`, `e2e/sales-rep-flow.spec.ts`, `package.json`, three docs.

---

# Phase 1 — Accounts

### Task 1: Identifier helpers

**Files:**
- Create: `src/lib/digits.ts`, `src/lib/digits.test.ts`
- Create: `src/lib/ids.ts`, `src/lib/ids.test.ts`
- Create: `src/lib/customerCode.ts`, `src/lib/customerCode.test.ts`
- Create: `src/lib/repAccount.ts`, `src/lib/repAccount.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `latinDigits(value: string): string`; `isUuid(value: string): boolean`; `isCustomerCode(v)`, `codeFromPhone(phone): string | null`, `randomCustomerCode(): string`, `type LoginIdentifier = { kind: "code"; code: string } | { kind: "email"; email: string }`, `parseLogin(raw): LoginIdentifier | null`; `FOLLOW_UP_DAYS`, `normalizeUsername`, `isValidUsername`, `parseCommissionPercent(raw): number | null`, `formatCommissionPercent(bp): string`, `commissionPercentLabel(bp, locale): string`, `randomReferralCode(): string`, `isReferralCode(v): boolean`.

- [ ] **Step 1: Write the failing tests**

`src/lib/digits.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { latinDigits } from "./digits";

test("Persian and Arabic-Indic digits become ASCII; nothing else changes", () => {
  assert.equal(latinDigits("۰۱۲۳۴۵۶۷۸۹"), "0123456789");
  assert.equal(latinDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
  assert.equal(latinDigits("Tehran ۱۴۰۵!"), "Tehran 1405!");
  assert.equal(latinDigits("abc-123"), "abc-123");
});
```

`src/lib/ids.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isUuid } from "./ids";

test("only canonical UUIDs pass, so a posted id can never reach a uuid column malformed", () => {
  assert.equal(isUuid("0f8fad5b-d9cb-469f-a165-70867728950e"), true);
  assert.equal(isUuid("0F8FAD5B-D9CB-469F-A165-70867728950E"), true);
  assert.equal(isUuid("0f8fad5b"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid("'; DROP TABLE users; --"), false);
});
```

`src/lib/customerCode.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { codeFromPhone, isCustomerCode, parseLogin, randomCustomerCode } from "./customerCode";

test("the last seven digits of the phone, whatever the formatting or keyboard", () => {
  assert.equal(codeFromPhone("0912 345 6789"), "3456789");
  assert.equal(codeFromPhone("+98 912 345 6789"), "3456789");
  assert.equal(codeFromPhone("۰۹۱۲۳۴۵۶۷۸۹"), "3456789");
  assert.equal(codeFromPhone("021-8888-0012"), "8880012");
  assert.equal(codeFromPhone("09120000123"), "0000123");
});

test("a phone with fewer than seven digits has no code", () => {
  assert.equal(codeFromPhone("12345"), null);
  assert.equal(codeFromPhone(""), null);
});

test("random codes are seven digits with no leading zero", () => {
  for (let i = 0; i < 200; i++) assert.match(randomCustomerCode(), /^[1-9][0-9]{6}$/);
});

test("isCustomerCode accepts exactly seven ASCII digits", () => {
  assert.equal(isCustomerCode("3456789"), true);
  assert.equal(isCustomerCode("345678"), false);
  assert.equal(isCustomerCode("34567890"), false);
  assert.equal(isCustomerCode("۳۴۵۶۷۸۹"), false);
});

test("one sign-in field: seven digits is an ID, anything else is an email", () => {
  assert.deepEqual(parseLogin("3456789"), { kind: "code", code: "3456789" });
  assert.deepEqual(parseLogin(" ۳۴۵۶۷۸۹ "), { kind: "code", code: "3456789" });
  assert.deepEqual(parseLogin(" Sara@Example.COM "), { kind: "email", email: "sara@example.com" });
  assert.deepEqual(parseLogin("123456"), { kind: "email", email: "123456" });
  assert.equal(parseLogin("   "), null);
});
```

`src/lib/repAccount.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commissionPercentLabel,
  formatCommissionPercent,
  isReferralCode,
  isValidUsername,
  normalizeUsername,
  parseCommissionPercent,
  randomReferralCode,
} from "./repAccount";

test("usernames are stored lower-case and must fit the database rule", () => {
  assert.equal(normalizeUsername("  Sara.Ahmadi "), "sara.ahmadi");
  assert.equal(isValidUsername("sara.ahmadi"), true);
  assert.equal(isValidUsername("rep_01-x"), true);
  assert.equal(isValidUsername("sa"), false);
  assert.equal(isValidUsername("sara ahmadi"), false);
  assert.equal(isValidUsername("سارا"), false);
  assert.equal(isValidUsername("a".repeat(33)), false);
});

test("a typed percent becomes basis points: two decimals, 0–100, any keyboard", () => {
  assert.equal(parseCommissionPercent("2.5"), 250);
  assert.equal(parseCommissionPercent("2.55"), 255);
  assert.equal(parseCommissionPercent("0"), 0);
  assert.equal(parseCommissionPercent("100"), 10_000);
  assert.equal(parseCommissionPercent("۲٫۵"), 250);
  assert.equal(parseCommissionPercent("۱۰"), 1000);
  assert.equal(parseCommissionPercent("5%"), 500);
  assert.equal(parseCommissionPercent("۵٪"), 500);
  assert.equal(parseCommissionPercent("2.555"), null);
  assert.equal(parseCommissionPercent("100.01"), null);
  assert.equal(parseCommissionPercent("-1"), null);
  assert.equal(parseCommissionPercent(""), null);
  assert.equal(parseCommissionPercent("abc"), null);
});

test("basis points back to the percent a form shows", () => {
  assert.equal(formatCommissionPercent(250), "2.5");
  assert.equal(formatCommissionPercent(255), "2.55");
  assert.equal(formatCommissionPercent(1000), "10");
  assert.equal(formatCommissionPercent(5), "0.05");
  assert.equal(formatCommissionPercent(0), "0");
  assert.equal(formatCommissionPercent(10_000), "100");
});

test("a commission label in each language", () => {
  assert.equal(commissionPercentLabel(250, "en"), "2.5%");
  assert.equal(commissionPercentLabel(250, "fa"), "۲٫۵٪");
});

test("referral codes use the read-aloud alphabet", () => {
  for (let i = 0; i < 200; i++) {
    const code = randomReferralCode();
    assert.equal(isReferralCode(code), true);
    assert.doesNotMatch(code, /[IO01]/);
  }
  assert.equal(isReferralCode("ABC123"), false);
  assert.equal(isReferralCode("abcdef"), false);
  assert.equal(isReferralCode("ABCDE"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './digits'` (and the other three modules).

- [ ] **Step 3: Write the implementations**

`src/lib/digits.ts`:

```ts
/**
 * Persian (U+06F0–U+06F9) and Arabic-Indic (U+0660–U+0669) digits to ASCII.
 *
 * A Persian phone keyboard types ۰–۹ and an Arabic one ٠–٩. Every identifier
 * and amount someone types here — a customer ID, a phone, a password, a rial
 * amount — has to mean the same thing whichever keyboard produced it.
 */
export function latinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}
```

`src/lib/ids.ts`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checked before any id from a form or URL reaches a query. Postgres rejects
 * a malformed uuid with an error, which would surface as a 500 rather than
 * the not-found the page means.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
```

`src/lib/customerCode.ts`:

```ts
import { randomInt } from "node:crypto";
import { latinDigits } from "./digits";

/** Mirrors `users_customer_code_check`. Stored codes are ASCII only. */
export function isCustomerCode(value: string): boolean {
  return /^[0-9]{7}$/.test(value);
}

/** The last seven digits of a phone; spaces, dashes and `+` ignored. */
export function codeFromPhone(phone: string): string | null {
  const digits = latinDigits(phone).replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-7) : null;
}

/** Seven digits without padding, so a random ID never looks like a truncated one. */
export function randomCustomerCode(): string {
  return String(randomInt(1_000_000, 10_000_000));
}

export type LoginIdentifier = { kind: "code"; code: string } | { kind: "email"; email: string };

/**
 * One sign-in field takes either. Seven digits is an ID — no email address is
 * seven bare digits — and anything else is looked up as an email.
 */
export function parseLogin(raw: string): LoginIdentifier | null {
  const value = latinDigits(raw.trim());
  if (value === "") return null;
  if (isCustomerCode(value)) return { kind: "code", code: value };
  return { kind: "email", email: value.toLowerCase() };
}
```

`src/lib/repAccount.ts`:

```ts
import { randomInt } from "node:crypto";
import { latinDigits } from "./digits";
import type { Locale } from "./i18n";

/** The order-reference alphabet: no O/0 or I/1, because these are read aloud. */
const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Quick follow-up choices, in days from today in Tehran. */
export const FOLLOW_UP_DAYS = [1, 3, 7, 14, 30] as const;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Mirrors `sales_reps_username_check`. */
export function isValidUsername(value: string): boolean {
  return /^[a-z0-9._-]{3,32}$/.test(value);
}

/**
 * "2.5" → 250 basis points. At most two decimals and 0–100; Persian digits,
 * the Persian decimal separator ٫ and a trailing % or ٪ are accepted. A third
 * decimal is refused rather than rounded: a rate someone typed and a rate the
 * system stored must be the same number.
 */
export function parseCommissionPercent(raw: string): number | null {
  const value = latinDigits(raw.trim()).replace("٫", ".").replace(/[%٪]$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const bp = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bp <= 10_000 ? bp : null;
}

/** 250 → "2.5". What a form is prefilled with, so saving it unchanged is a no-op. */
export function formatCommissionPercent(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = String(bp % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

const percentFormat = {
  en: new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }),
  fa: new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }),
} as const;

export function commissionPercentLabel(bp: number, locale: Locale): string {
  const n = percentFormat[locale].format(bp / 100);
  return locale === "fa" ? `${n}٪` : `${n}%`;
}

export function randomReferralCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  return out;
}

/** Mirrors `sales_reps_referral_code_check`. */
export function isReferralCode(value: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(value);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/digits.ts src/lib/digits.test.ts src/lib/ids.ts src/lib/ids.test.ts src/lib/customerCode.ts src/lib/customerCode.test.ts src/lib/repAccount.ts src/lib/repAccount.test.ts
git commit -m "feat: add customer ID, username, commission and referral helpers"
```

---

### Task 2: Password and session-token helpers

**Files:**
- Modify: `src/lib/password.ts` (add `DUMMY_PASSWORD_HASH`)
- Create: `src/lib/repPassword.ts`, `src/lib/repPassword.test.ts`
- Create: `src/lib/tempPassword.ts`, `src/lib/tempPassword.test.ts`
- Create: `src/lib/repSessionToken.ts`, `src/lib/repSessionToken.test.ts`

**Interfaces:**
- Consumes: `latinDigits` (Task 1), `MIN_PASSWORD_LENGTH` (`password.ts`), `signSessionToken`/`verifySessionToken` (`sessionToken.ts`, tests only).
- Produces: `DUMMY_PASSWORD_HASH: string`; `normalizeRepPassword(plain): string`, `type RepPasswordProblem = "short" | "uppercase" | "digit" | "special"`, `repPasswordProblems(plain): RepPasswordProblem[]`; `generateTempPassword(): string`; `REP_SESSION_TTL_MS`, `signRepSessionToken(repId, version, expiresAtMs, secret): string`, `type RepSessionClaim = { repId: string; version: number }`, `verifyRepSessionToken(token, secret, nowMs?): RepSessionClaim | null`.

- [ ] **Step 1: Write the failing tests**

`src/lib/repPassword.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRepPassword, repPasswordProblems } from "./repPassword";

test("a password meeting every rule has no problems", () => {
  assert.deepEqual(repPasswordProblems("Abcdef1!"), []);
});

test("each missing rule is reported, all at once", () => {
  assert.deepEqual(repPasswordProblems("abcdef1!"), ["uppercase"]);
  assert.deepEqual(repPasswordProblems("Abcdefg!"), ["digit"]);
  assert.deepEqual(repPasswordProblems("Abcdefg1"), ["special"]);
  assert.deepEqual(repPasswordProblems("Ab1!"), ["short"]);
  assert.deepEqual(repPasswordProblems("abc"), ["short", "uppercase", "digit", "special"]);
});

test("Persian digits count as numbers, and are the same password as ASCII ones", () => {
  assert.deepEqual(repPasswordProblems("Tehran۱۴۰۵!"), []);
  assert.equal(normalizeRepPassword("Tehran۱۴۰۵!"), "Tehran1405!");
});

test("a Persian letter or a space is not a special character", () => {
  assert.deepEqual(repPasswordProblems("Aسلام1234"), ["special"]);
  assert.deepEqual(repPasswordProblems("Abc def12"), ["special"]);
});
```

`src/lib/tempPassword.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTempPassword } from "./tempPassword";
import { repPasswordProblems } from "./repPassword";

test("every temporary password already passes the rep rule and avoids misreadable characters", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const p = generateTempPassword();
    assert.equal(p.length, 12);
    assert.deepEqual(repPasswordProblems(p), []);
    assert.doesNotMatch(p, /[0O1lI]/);
    seen.add(p);
  }
  assert.equal(seen.size, 300);
});
```

`src/lib/repSessionToken.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { REP_SESSION_TTL_MS, signRepSessionToken, verifyRepSessionToken } from "./repSessionToken";
import { signSessionToken, verifySessionToken } from "./sessionToken";

const SECRET = "test-secret-not-a-real-one";
const REP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = 1_760_000_000_000;

test("a rep token verifies and yields the rep id and session version", () => {
  const token = signRepSessionToken(REP, 3, NOW + REP_SESSION_TTL_MS, SECRET);
  assert.deepEqual(verifyRepSessionToken(token, SECRET, NOW), { repId: REP, version: 3 });
});

test("a token another secret signed does not verify", () => {
  const token = signRepSessionToken(REP, 1, NOW + 1000, "another secret");
  assert.equal(verifyRepSessionToken(token, SECRET, NOW), null);
});

test("raising the version by hand invalidates the signature", () => {
  const parts = signRepSessionToken(REP, 1, NOW + 1000, SECRET).split(".");
  parts[2] = "2";
  assert.equal(verifyRepSessionToken(parts.join("."), SECRET, NOW), null);
});

test("an expired token does not verify", () => {
  assert.equal(verifyRepSessionToken(signRepSessionToken(REP, 1, NOW - 1, SECRET), SECRET, NOW), null);
});

test("a customer session token never verifies as a rep token", () => {
  const customer = signSessionToken(REP, NOW + 1000, SECRET);
  assert.equal(verifyRepSessionToken(customer, SECRET, NOW), null);
});

test("a rep token never verifies as a customer session", () => {
  const rep = signRepSessionToken(REP, 1, NOW + 1000, SECRET);
  assert.equal(verifySessionToken(rep, SECRET, NOW), null);
});

test("garbage does not verify and does not throw", () => {
  for (const junk of ["", "v1", "v1.a.b.c.d", `v2.${REP}.1.${NOW + 1000}.x`, `v1.${REP}.0.${NOW + 1000}.x`, `v1.${REP}.1.5.${NOW + 1000}.x`]) {
    assert.equal(verifyRepSessionToken(junk, SECRET, NOW), null);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './repPassword'` and the other two.

- [ ] **Step 3: Write the implementations**

Append to `src/lib/password.ts`:

```ts
/**
 * A well-formed hash no password matches, for sign-in forms to verify against
 * when the account does not exist. Without it, an unknown login returns
 * noticeably faster than a known one, and the form becomes an oracle for
 * which accounts exist.
 */
export const DUMMY_PASSWORD_HASH = `scrypt$16384$8$1$${"A".repeat(22)}==$${"A".repeat(88)}`;
```

`src/lib/repPassword.ts`:

```ts
import { latinDigits } from "./digits";
import { MIN_PASSWORD_LENGTH } from "./password";

export type RepPasswordProblem = "short" | "uppercase" | "digit" | "special";

/**
 * The same password whichever keyboard typed its digits.
 *
 * A rep who sets "Tehran۱۴۰۵!" on a phone and later types "Tehran1405!" on a
 * laptop typed the same thing as far as they can tell. Hashing and verifying
 * both go through this, so the two match.
 */
export function normalizeRepPassword(plain: string): string {
  return latinDigits(plain);
}

/** Every rule missed, in a fixed order, so the form can explain all of them at once. */
export function repPasswordProblems(plain: string): RepPasswordProblem[] {
  const value = normalizeRepPassword(plain);
  const problems: RepPasswordProblem[] = [];
  if ([...value].length < MIN_PASSWORD_LENGTH) problems.push("short");
  if (!/[A-Z]/.test(value)) problems.push("uppercase");
  if (!/[0-9]/.test(value)) problems.push("digit");
  if (!/[^\p{L}\p{N}\s]/u.test(value)) problems.push("special");
  return problems;
}
```

`src/lib/tempPassword.ts`:

```ts
import { randomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGIT = "23456789";
const SPECIAL = "!@#$%*+=?";
const ALL = UPPER + LOWER + DIGIT + SPECIAL;

function pick(set: string): string {
  return set[randomInt(set.length)];
}

/**
 * Twelve characters with at least one of each class, so it already passes the
 * rep password rule — a temporary password can never be refused by the form
 * it is typed into. No 0/O or 1/l/I, because these get read out over the phone.
 */
export function generateTempPassword(): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
  while (chars.length < 12) chars.push(pick(ALL));
  // Fisher–Yates, so the four guaranteed classes are not always the first four.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
```

`src/lib/repSessionToken.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The rep cookie, kept free of `next/headers` so it can be tested without a
 * request — the same split as `sessionToken.ts`.
 *
 * Unlike the customer cookie it carries a session version. The rep row holds
 * the current version, and deactivation, a password reset or a password change
 * increments it, so a cookie minted before any of those stops working at once.
 */
export const REP_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A key derived for this purpose alone. A customer cookie is signed with
 * AUTH_SECRET itself, so it can never verify here, and nothing signed here can
 * verify as a customer session.
 */
function repKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("rep-session").digest();
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", repKey(secret)).update(payload).digest("base64url");
}

export function signRepSessionToken(
  repId: string,
  version: number,
  expiresAtMs: number,
  secret: string,
): string {
  const payload = `v1.${repId}.${version}.${expiresAtMs}`;
  return `${payload}.${signature(payload, secret)}`;
}

export type RepSessionClaim = { repId: string; version: number };

export function verifyRepSessionToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): RepSessionClaim | null {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const [, repId, versionRaw, expRaw, provided] = parts;
  if (!UUID.test(repId) || !/^[1-9][0-9]{0,8}$/.test(versionRaw)) return null;
  const expiresAt = Number(expRaw);
  if (!Number.isFinite(expiresAt)) return null;

  const expected = signature(`v1.${repId}.${versionRaw}.${expRaw}`, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // After the signature, as in sessionToken.ts: timing says nothing about
  // whether a forged token happened to be in date.
  if (expiresAt <= nowMs) return null;
  return { repId, version: Number(versionRaw) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/password.ts src/lib/repPassword.ts src/lib/repPassword.test.ts src/lib/tempPassword.ts src/lib/tempPassword.test.ts src/lib/repSessionToken.ts src/lib/repSessionToken.test.ts
git commit -m "feat: add rep password rule, temporary passwords and rep session tokens"
```

---

### Task 3: Schema, migration and verifier

**Files:**
- Create: `supabase/migrations/20260927120000_add_sales_reps.sql`
- Modify: `src/db/schema.ts` (imports; `users`, `orders`; new `salesReps`, `customerNotes`, `repPayouts`, `repTargets`)
- Modify: `scripts/verify-remote.mts` (`TABLES`, `COLUMNS`, `REQUIRED_CONSTRAINTS`, `REQUIRED_MIGRATIONS`, new `REQUIRED_INDEXES` check)
- Create: `src/db/salesReps.integration.test.ts`
- Modify: `package.json` (`test:db:reps`, added to `test:db`)

**Interfaces:**
- Consumes: `randomReferralCode`, `randomCustomerCode` (Task 1) in tests.
- Produces: the tables and columns every later task queries; test helpers `assertLocalDatabase`, `rolledBack`, `insertRep`, `insertCustomer`, `insertOrder` inside the integration test file, reused by later tasks' tests.

- [ ] **Step 1: Write the failing integration test**

`src/db/salesReps.integration.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { sql } from "./index";
import { randomReferralCode } from "@/lib/repAccount";
import { randomCustomerCode } from "@/lib/customerCode";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

class Rollback extends Error {}

function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for the database integration test");
  const { hostname } = new URL(raw);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`Refusing to run sales rep integration tests against non-local host: ${hostname}`);
  }
}

/** Runs `body` in a transaction that is always rolled back, whatever it does. */
async function rolledBack(body: (tx: Tx) => Promise<void>): Promise<void> {
  await assert.rejects(
    sql.begin(async (tx) => {
      await body(tx);
      throw new Rollback();
    }),
    Rollback,
  );
}

async function insertRep(
  tx: Tx,
  options: { rateBp?: number; active?: boolean } = {},
): Promise<string> {
  const [rep] = await tx<{ id: string }[]>`
    INSERT INTO sales_reps (username, password_hash, name, commission_rate_bp, referral_code, active)
    VALUES (${`rep-${randomUUID().slice(0, 8)}`}, 'x', 'Integration Rep',
            ${options.rateBp ?? 250}, ${randomReferralCode()}, ${options.active ?? true})
    RETURNING id
  `;
  return rep.id;
}

async function insertCustomer(
  tx: Tx,
  options: { repId?: string | null; earns?: boolean } = {},
): Promise<string> {
  const repId = options.repId ?? null;
  const [user] = await tx<{ id: string }[]>`
    INSERT INTO users (email, password_hash, customer_code, rep_id, rep_earns_commission,
                       origin, origin_rep_id, phone)
    VALUES (${`${randomUUID()}@example.invalid`}, 'x', ${randomCustomerCode()}, ${repId},
            ${options.earns ?? false}, ${repId ? "rep" : "self"}, ${repId}, '0912 000 0000')
    RETURNING id
  `;
  return user.id;
}

async function insertOrder(
  tx: Tx,
  fields: { userId?: string | null; repId?: string | null; rateBp?: number | null } = {},
): Promise<{ id: number; payToken: string }> {
  const [order] = await tx<{ id: number; payToken: string }[]>`
    INSERT INTO orders (ref, company, contact_name, email, locale, currency, total_cents,
                        requested_total_cents, status, user_id, rep_id, commission_rate_bp)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Integration Co', 'Tester',
            't@example.invalid', 'en', 'USD', 100, 100, 'received',
            ${fields.userId ?? null}, ${fields.repId ?? null}, ${fields.rateBp ?? null})
    RETURNING id, pay_token AS "payToken"
  `;
  return order;
}

test("constraints refuse rows the application must never write", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const repId = await insertRep(tx);
    const refused = (code: string, query: (sp: Tx) => Promise<unknown>) =>
      assert.rejects(tx.savepoint((sp) => query(sp)), { code });

    await refused("23514", (sp) => sp`
      INSERT INTO sales_reps (username, password_hash, name, referral_code)
      VALUES ('Sara', 'x', 'S', ${randomReferralCode()})`);
    await refused("23514", (sp) => sp`UPDATE sales_reps SET commission_rate_bp = 10001 WHERE id = ${repId}`);
    await refused("23514", (sp) => sp`UPDATE sales_reps SET referral_code = 'ABCDEO' WHERE id = ${repId}`);
    await refused("23514", (sp) => sp`
      INSERT INTO users (email, password_hash, customer_code) VALUES ('a@example.invalid', 'x', '12345')`);
    await refused("23514", (sp) => sp`
      INSERT INTO users (email, password_hash, customer_code, origin)
      VALUES ('b@example.invalid', 'x', ${randomCustomerCode()}, 'rep')`);
    await refused("23514", (sp) => sp`
      INSERT INTO orders (ref, company, contact_name, email, rep_id, commission_rate_bp)
      VALUES ('ORD-ZZZZZ1', 'C', 'N', 'e@example.invalid', ${repId}, NULL)`);
    await refused("23514", (sp) => sp`
      INSERT INTO orders (ref, company, contact_name, email, placed_by_rep)
      VALUES ('ORD-ZZZZZ2', 'C', 'N', 'e@example.invalid', true)`);
    await refused("23514", (sp) => sp`
      INSERT INTO rep_payouts (rep_id, amount_rial) VALUES (${repId}, 0)`);
    await refused("23514", (sp) => sp`
      INSERT INTO rep_targets (rep_id, persian_year, persian_month, amount_rial)
      VALUES (${repId}, 1405, 13, 1)`);

    const customer = await insertCustomer(tx, { repId });
    const [{ code }] = await tx<{ code: string }[]>`SELECT customer_code AS code FROM users WHERE id = ${customer}`;
    await refused("23505", (sp) => sp`
      INSERT INTO users (email, password_hash, customer_code) VALUES ('c@example.invalid', 'x', ${code})`);
    // Reps are never deleted; RESTRICT makes that a database fact.
    await refused("23503", (sp) => sp`DELETE FROM sales_reps WHERE id = ${repId}`);
  });
});

test("every order gets its own pay token without the insert naming one", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const a = await insertOrder(tx);
    const b = await insertOrder(tx);
    assert.match(a.payToken, /^[0-9a-f]{64}$/);
    assert.match(b.payToken, /^[0-9a-f]{64}$/);
    assert.notEqual(a.payToken, b.payToken);
  });
});
```

Add to `package.json` `scripts`:

```json
"test:db:reps": "dotenv -e .env -- node --import tsx --conditions=react-server --test src/db/salesReps.integration.test.ts",
```

and append ` && npm run test:db:reps` to the end of the existing `test:db` script.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db:reps`
Expected: FAIL — `relation "sales_reps" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260927120000_add_sales_reps.sql`:

```sql
-- Sales reps: admin-created accounts with their own sign-in; customer IDs;
-- rep credit and commission locked onto each order when it is placed; a
-- private pay link per order; customer notes, payouts and monthly targets.
-- Forward-only and idempotent. Constraint names match what drizzle-kit
-- generates from src/db/schema.ts, so a pushed local database and a migrated
-- hosted one verify identically.

CREATE TABLE IF NOT EXISTS sales_reps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  commission_rate_bp integer NOT NULL DEFAULT 0,
  referral_code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  session_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_reps_username_key ON sales_reps (username);
CREATE UNIQUE INDEX IF NOT EXISTS sales_reps_referral_code_key ON sales_reps (referral_code);
ALTER TABLE sales_reps DROP CONSTRAINT IF EXISTS sales_reps_username_check;
ALTER TABLE sales_reps ADD CONSTRAINT sales_reps_username_check
  CHECK (username ~ '^[a-z0-9._-]{3,32}$');
ALTER TABLE sales_reps DROP CONSTRAINT IF EXISTS sales_reps_name_check;
ALTER TABLE sales_reps ADD CONSTRAINT sales_reps_name_check CHECK (btrim(name) <> '');
ALTER TABLE sales_reps DROP CONSTRAINT IF EXISTS sales_reps_commission_rate_check;
ALTER TABLE sales_reps ADD CONSTRAINT sales_reps_commission_rate_check
  CHECK (commission_rate_bp BETWEEN 0 AND 10000);
ALTER TABLE sales_reps DROP CONSTRAINT IF EXISTS sales_reps_referral_code_check;
ALTER TABLE sales_reps ADD CONSTRAINT sales_reps_referral_code_check
  CHECK (referral_code ~ '^[A-HJ-NP-Z2-9]{6}$');
ALTER TABLE sales_reps DROP CONSTRAINT IF EXISTS sales_reps_session_version_check;
ALTER TABLE sales_reps ADD CONSTRAINT sales_reps_session_version_check CHECK (session_version > 0);
-- Written only by the application's owner role, which bypasses RLS. Enabling
-- it keeps password hashes out of Supabase's REST API.
ALTER TABLE sales_reps ENABLE ROW LEVEL SECURITY;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS rep_id uuid
    CONSTRAINT users_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS rep_earns_commission boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS origin_rep_id uuid
    CONSTRAINT users_origin_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS next_follow_up_on date;

-- A rep-created customer may have no email; sign-in then uses the customer ID.
-- The lower(email) unique index in extensions.sql still applies: NULLs never
-- collide.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Existing customers: the phone's last seven digits when free, otherwise a
-- random seven-digit number. Oldest accounts choose first.
DO $$
DECLARE
  u record;
  candidate text;
BEGIN
  FOR u IN SELECT id, phone FROM users WHERE customer_code IS NULL ORDER BY created_at, id LOOP
    candidate := right(
      regexp_replace(translate(u.phone, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
                     '[^0-9]', '', 'g'),
      7);
    IF length(candidate) <> 7
       OR EXISTS (SELECT 1 FROM users WHERE customer_code = candidate) THEN
      LOOP
        candidate := (1000000 + floor(random() * 9000000))::int::text;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE customer_code = candidate);
      END LOOP;
    END IF;
    UPDATE users SET customer_code = candidate WHERE id = u.id;
  END LOOP;
END $$;

ALTER TABLE users ALTER COLUMN customer_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_customer_code_key ON users (customer_code);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_code_check;
ALTER TABLE users ADD CONSTRAINT users_customer_code_check CHECK (customer_code ~ '^[0-9]{7}$');
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_origin_check;
ALTER TABLE users ADD CONSTRAINT users_origin_check
  CHECK (origin IN ('self', 'rep', 'referral') AND (origin = 'self' OR origin_rep_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS users_rep_idx ON users (rep_id, created_at);
CREATE INDEX IF NOT EXISTS users_rep_follow_up_idx ON users (rep_id, next_follow_up_on)
  WHERE next_follow_up_on IS NOT NULL;

-- A volatile default is evaluated per row, so every existing order receives
-- its own token here, and no INSERT anywhere has to name the column.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rep_id uuid
    CONSTRAINT orders_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS commission_rate_bp integer,
  ADD COLUMN IF NOT EXISTS placed_by_rep boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pay_token text NOT NULL
    DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
CREATE UNIQUE INDEX IF NOT EXISTS orders_pay_token_key ON orders (pay_token);
CREATE INDEX IF NOT EXISTS orders_rep_delivered_idx ON orders (rep_id, delivered_at)
  WHERE rep_id IS NOT NULL;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_commission_check;
ALTER TABLE orders ADD CONSTRAINT orders_commission_check CHECK (
  (rep_id IS NULL AND commission_rate_bp IS NULL)
  OR (rep_id IS NOT NULL AND commission_rate_bp BETWEEN 0 AND 10000)
);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_placed_by_rep_check;
ALTER TABLE orders ADD CONSTRAINT orders_placed_by_rep_check
  CHECK (NOT placed_by_rep OR rep_id IS NOT NULL);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pay_token_check;
ALTER TABLE orders ADD CONSTRAINT orders_pay_token_check CHECK (pay_token ~ '^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS customer_notes (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL
    CONSTRAINT customer_notes_user_id_users_id_fk REFERENCES users (id) ON DELETE CASCADE,
  author_rep_id uuid
    CONSTRAINT customer_notes_author_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_notes_body_check CHECK (btrim(body) <> '' AND char_length(body) <= 2000)
);
CREATE INDEX IF NOT EXISTS customer_notes_user_idx ON customer_notes (user_id, created_at);
ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS rep_payouts (
  id serial PRIMARY KEY,
  rep_id uuid NOT NULL
    CONSTRAINT rep_payouts_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE RESTRICT,
  amount_rial bigint NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rep_payouts_amount_check CHECK (amount_rial > 0),
  CONSTRAINT rep_payouts_note_check CHECK (char_length(note) <= 500)
);
CREATE INDEX IF NOT EXISTS rep_payouts_rep_idx ON rep_payouts (rep_id, created_at);
ALTER TABLE rep_payouts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS rep_targets (
  rep_id uuid NOT NULL
    CONSTRAINT rep_targets_rep_id_sales_reps_id_fk REFERENCES sales_reps (id) ON DELETE CASCADE,
  persian_year integer NOT NULL,
  persian_month integer NOT NULL,
  amount_rial bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rep_targets_rep_id_persian_year_persian_month_pk
    PRIMARY KEY (rep_id, persian_year, persian_month),
  CONSTRAINT rep_targets_month_check
    CHECK (persian_year BETWEEN 1300 AND 1600 AND persian_month BETWEEN 1 AND 12),
  CONSTRAINT rep_targets_amount_check CHECK (amount_rial >= 0)
);
ALTER TABLE rep_targets ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 4: Mirror it in `src/db/schema.ts`**

Add `bigint` and `date` to the `drizzle-orm/pg-core` import list.

In `orders` columns, after `deliveredAt`, add:

```ts
    /** The customer's rep when the order was placed. Never moves afterwards. */
    repId: uuid("rep_id").references((): AnyPgColumn => salesReps.id, { onDelete: "restrict" }),
    /**
     * Locked at placement: the rep's rate, or 0 when the customer is not
     * commission-eligible. Null exactly when repId is null.
     */
    commissionRateBp: integer("commission_rate_bp"),
    placedByRep: boolean("placed_by_rep").notNull().default(false),
    /** The private pay link: 64 hex characters from two random UUIDs. */
    payToken: text("pay_token")
      .notNull()
      .default(sql`replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')`),
```

and in its constraint list:

```ts
    uniqueIndex("orders_pay_token_key").on(t.payToken),
    index("orders_rep_delivered_idx").on(t.repId, t.deliveredAt).where(sql`${t.repId} IS NOT NULL`),
    check(
      "orders_commission_check",
      sql`(${t.repId} IS NULL AND ${t.commissionRateBp} IS NULL)
        OR (${t.repId} IS NOT NULL AND ${t.commissionRateBp} BETWEEN 0 AND 10000)`,
    ),
    check("orders_placed_by_rep_check", sql`NOT ${t.placedByRep} OR ${t.repId} IS NOT NULL`),
    check("orders_pay_token_check", sql`${t.payToken} ~ '^[0-9a-f]{64}$'`),
```

In `users`, change `email` to `email: text("email"),` (extend the doc comment: "Null for an account a rep created without one; sign-in then uses the customer ID.") and add after `lastLoginAt`:

```ts
    /** The seven-digit sign-in ID. See lib/customerCode.ts. Never changes. */
    customerCode: text("customer_code").notNull(),
    repId: uuid("rep_id").references((): AnyPgColumn => salesReps.id, { onDelete: "restrict" }),
    repEarnsCommission: boolean("rep_earns_commission").notNull().default(false),
    /** How the account began: 'self', 'rep' (created by one) or 'referral'. */
    origin: text("origin").notNull().default("self"),
    originRepId: uuid("origin_rep_id").references((): AnyPgColumn => salesReps.id, {
      onDelete: "restrict",
    }),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    address: text("address").notNull().default(""),
    city: text("city").notNull().default(""),
    nextFollowUpOn: date("next_follow_up_on", { mode: "string" }),
```

with constraints:

```ts
  (t) => [
    index("users_created_idx").on(t.createdAt),
    uniqueIndex("users_customer_code_key").on(t.customerCode),
    index("users_rep_idx").on(t.repId, t.createdAt),
    index("users_rep_follow_up_idx")
      .on(t.repId, t.nextFollowUpOn)
      .where(sql`${t.nextFollowUpOn} IS NOT NULL`),
    check("users_customer_code_check", sql`${t.customerCode} ~ '^[0-9]{7}$'`),
    check(
      "users_origin_check",
      sql`${t.origin} IN ('self','rep','referral') AND (${t.origin} = 'self' OR ${t.originRepId} IS NOT NULL)`,
    ),
  ],
```

Append a new section after "Customer accounts":

```ts
// ---------------------------------------------------------------------------
// Sales reps — a third identity, sharing no table or cookie with the other two
// ---------------------------------------------------------------------------

/**
 * Never deleted: every foreign key pointing here is RESTRICT, because orders
 * credited to a rep, notes they wrote and payouts made to them are history.
 * Deactivation (`active = false`) is the way out, and it moves their customers
 * in the same transaction. `session_version` is embedded in the rep cookie;
 * incrementing it ends every open session for that rep.
 */
export const salesReps = pgTable(
  "sales_reps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    /** Basis points: 250 = 2.5%. */
    commissionRateBp: integer("commission_rate_bp").notNull().default(0),
    referralCode: text("referral_code").notNull(),
    active: boolean("active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    sessionVersion: integer("session_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sales_reps_username_key").on(t.username),
    uniqueIndex("sales_reps_referral_code_key").on(t.referralCode),
    check("sales_reps_username_check", sql`${t.username} ~ '^[a-z0-9._-]{3,32}$'`),
    check("sales_reps_name_check", sql`btrim(${t.name}) <> ''`),
    check("sales_reps_commission_rate_check", sql`${t.commissionRateBp} BETWEEN 0 AND 10000`),
    check("sales_reps_referral_code_check", sql`${t.referralCode} ~ '^[A-HJ-NP-Z2-9]{6}$'`),
    check("sales_reps_session_version_check", sql`${t.sessionVersion} > 0`),
  ],
);

/**
 * Append-only, like `order_comments`: the point of a note is what was known
 * when, and an editable field loses that the first time someone tidies it.
 * Readable by the admin and by whichever rep has the customer now — never by
 * the customer.
 */
export const customerNotes = pgTable(
  "customer_notes",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null when the admin wrote it. */
    authorRepId: uuid("author_rep_id").references(() => salesReps.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customer_notes_user_idx").on(t.userId, t.createdAt),
    check("customer_notes_body_check", sql`btrim(${t.body}) <> '' AND char_length(${t.body}) <= 2000`),
  ],
);

/** What the business actually paid a rep, in rial, as recorded by the admin. */
export const repPayouts = pgTable(
  "rep_payouts",
  {
    id: serial("id").primaryKey(),
    repId: uuid("rep_id")
      .notNull()
      .references(() => salesReps.id, { onDelete: "restrict" }),
    amountRial: bigint("amount_rial", { mode: "number" }).notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rep_payouts_rep_idx").on(t.repId, t.createdAt),
    check("rep_payouts_amount_check", sql`${t.amountRial} > 0`),
    check("rep_payouts_note_check", sql`char_length(${t.note}) <= 500`),
  ],
);

/**
 * A target stands from the Persian month it was set in until a later row
 * replaces it, so a month's target is the latest row at or before that month.
 */
export const repTargets = pgTable(
  "rep_targets",
  {
    repId: uuid("rep_id")
      .notNull()
      .references(() => salesReps.id, { onDelete: "cascade" }),
    persianYear: integer("persian_year").notNull(),
    persianMonth: integer("persian_month").notNull(),
    amountRial: bigint("amount_rial", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.repId, t.persianYear, t.persianMonth] }),
    check(
      "rep_targets_month_check",
      sql`${t.persianYear} BETWEEN 1300 AND 1600 AND ${t.persianMonth} BETWEEN 1 AND 12`,
    ),
    check("rep_targets_amount_check", sql`${t.amountRial} >= 0`),
  ],
);
```

- [ ] **Step 5: Extend the verifier**

In `scripts/verify-remote.mts`: add `"sales_reps", "customer_notes", "rep_payouts", "rep_targets"` to `TABLES`; add to `COLUMNS`:

```ts
  ["users", "customer_code"], ["users", "rep_id"], ["users", "rep_earns_commission"],
  ["users", "origin"], ["users", "origin_rep_id"], ["users", "must_change_password"],
  ["users", "address"], ["users", "city"], ["users", "next_follow_up_on"],
  ["orders", "rep_id"], ["orders", "commission_rate_bp"], ["orders", "placed_by_rep"],
  ["orders", "pay_token"],
```

add to `REQUIRED_CONSTRAINTS`:

```ts
  "sales_reps_username_check", "sales_reps_name_check", "sales_reps_commission_rate_check",
  "sales_reps_referral_code_check", "sales_reps_session_version_check",
  "users_customer_code_check", "users_origin_check", "users_rep_id_sales_reps_id_fk",
  "orders_rep_id_sales_reps_id_fk", "orders_commission_check", "orders_placed_by_rep_check",
  "orders_pay_token_check", "customer_notes_body_check", "rep_payouts_amount_check",
  "rep_payouts_note_check", "rep_targets_month_check", "rep_targets_amount_check",
```

add `"20260927120000"` to `REQUIRED_MIGRATIONS`; and after the `submission key` line add a uniqueness check, because a missing unique index here fails silently (duplicate customer IDs; two orders sharing a pay link):

```ts
const REQUIRED_INDEXES = [
  "users_customer_code_key", "orders_pay_token_key",
  "sales_reps_username_key", "sales_reps_referral_code_key",
] as const;
const missingIndexes = REQUIRED_INDEXES.filter((name) => !haveObjs.has(name));
console.log(
  `sales rep unique indexes ${REQUIRED_INDEXES.length - missingIndexes.length}/${REQUIRED_INDEXES.length} ${
    missingIndexes.length === 0 ? "✓" : `✗ MISSING ${missingIndexes.join(", ")}`
  }`,
);
```

and add `missingIndexes.length === 0 &&` to the `const ok =` conjunction at the bottom of the file, so a missing index fails the run like every other check.

- [ ] **Step 6: Apply locally, then run the tests**

Run: `npm run db:migrate`
Expected: the Supabase CLI prints `Applying migration 20260927120000_add_sales_reps.sql...` and `Finished`. If it stops to ask whether to push, answer `y` (non-interactively: `yes | npm run db:migrate`). This is the local database — `scripts/migrate.mts` refuses remote hosts without a dated backup acknowledgement.

Run: `npm run db:verify`
Expected: every line ✓, including `sales rep unique indexes 4/4 ✓` and `migrations … ✓`.

Run: `npm run test:db:reps && npx tsc --noEmit`
Expected: both tests PASS; typecheck clean (`UserRow` itself does not change until Task 6).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260927120000_add_sales_reps.sql src/db/schema.ts scripts/verify-remote.mts src/db/salesReps.integration.test.ts package.json
git commit -m "feat: add sales rep, customer ID, pay token, note, payout and target schema"
```

---

### Task 4: Rep sign-in, sessions and forced password change

**Files:**
- Modify: `src/lib/rateLimit.ts` (three policies)
- Create: `src/db/repQueries.ts`
- Create: `src/lib/repSession.ts`
- Create: `src/components/PanelTabs.tsx`; delete `src/app/[locale]/admin/(panel)/AdminTabs.tsx`; modify `src/app/[locale]/admin/(panel)/layout.tsx` import
- Create: `src/components/Banners.tsx`
- Create: `src/app/[locale]/rep/actions.ts`
- Create: `src/app/[locale]/rep/signin/page.tsx`
- Create: `src/app/[locale]/rep/(session)/layout.tsx`, `src/app/[locale]/rep/(session)/password/page.tsx`
- Create: `src/app/[locale]/rep/(portal)/layout.tsx`, `src/app/[locale]/rep/(portal)/page.tsx`
- Modify: `src/lib/i18n.ts` (Appendix A, Task 4)
- Test: `src/db/salesReps.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 (`normalizeUsername`, `isValidUsername`, `randomReferralCode`, `isUuid`), Task 2 (`DUMMY_PASSWORD_HASH`, `normalizeRepPassword`, `repPasswordProblems`, session token).
- Produces:
  - `type RepRow = { id; username; name; phone; email; commissionRateBp: number; referralCode; active: boolean; mustChangePassword: boolean; sessionVersion: number; createdAt: string; lastLoginAt: string | null }`
  - `type RepInput = { username; name; phone; email; commissionRateBp: number }`
  - `getRepById(id)`, `findRepForSignIn(username)`, `getRepPasswordHash(id)`, `touchRepLogin(id)`, `setRepPassword(id, hash, mustChange): Promise<number | null>`, `createRep(input & { passwordHash }): Promise<RepRow | "username-taken">`, `updateRep(id, input): Promise<"ok" | "not-found" | "username-taken">`, `listReps(): Promise<(RepRow & { customerCount: number })[]>`, `listActiveReps(): Promise<{ id: string; name: string }[]>`, `deactivateRep(id, destination: string | null): Promise<"ok" | "not-found" | "bad-destination">`, `reactivateRep(id)`, `getActiveRepByReferralCode(code): Promise<{ id: string } | null>`
  - `setRepSessionCookie(rep)`, `clearRepSessionCookie()`, `currentRep(): Promise<RepRow | null>`, `requireRep(locale): Promise<RepRow>`, `requireRepSession(locale): Promise<RepRow>`
  - `PanelTabs({ sections: { href; label; exact?: boolean }[] })`, `ErrorBanner`, `SuccessBanner`

- [ ] **Step 1: Write the failing integration tests** (append to `salesReps.integration.test.ts`)

```ts
import {
  createRep,
  deactivateRep,
  findRepForSignIn,
  getActiveRepByReferralCode,
  getRepById,
  setRepPassword,
} from "./repQueries";

async function cleanupReps(repIds: string[], userIds: string[] = []): Promise<void> {
  if (userIds.length) await sql`DELETE FROM users WHERE id = ANY(${userIds})`;
  if (repIds.length) await sql`DELETE FROM sales_reps WHERE id = ANY(${repIds})`;
}

test("rep accounts: unique usernames, a password change ends sessions, deactivation moves customers", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  try {
    const a = await createRep({ username: `a-${suffix}`, name: "A", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    const b = await createRep({ username: `b-${suffix}`, name: "B", phone: "", email: "", commissionRateBp: 300, passwordHash: "x" });
    assert.notEqual(a, "username-taken");
    assert.notEqual(b, "username-taken");
    if (a === "username-taken" || b === "username-taken") return;
    repIds.push(a.id, b.id);

    assert.equal(
      await createRep({ username: `a-${suffix}`, name: "Dup", phone: "", email: "", commissionRateBp: 0, passwordHash: "x" }),
      "username-taken",
    );
    assert.equal((await findRepForSignIn(`a-${suffix}`))?.passwordHash, "x");
    assert.equal(a.mustChangePassword, true);

    const version = await setRepPassword(a.id, "y", false);
    assert.equal(version, a.sessionVersion + 1);
    assert.equal((await getRepById(a.id))?.mustChangePassword, false);

    const [c] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, customer_code, rep_id, origin, origin_rep_id)
      VALUES (${`${suffix}@example.invalid`}, 'x', ${randomCustomerCode()}, ${a.id}, 'rep', ${a.id})
      RETURNING id`;
    userIds.push(c.id);

    assert.equal(await deactivateRep(a.id, a.id), "bad-destination");
    assert.equal(await deactivateRep(a.id, b.id), "ok");
    const [moved] = await sql<{ repId: string }[]>`SELECT rep_id AS "repId" FROM users WHERE id = ${c.id}`;
    assert.equal(moved.repId, b.id);
    const after = await getRepById(a.id);
    assert.equal(after?.active, false);
    assert.equal(after?.sessionVersion, (version ?? 0) + 1);
    assert.equal(await deactivateRep(b.id, a.id), "bad-destination");

    // A referral link opened before deactivation must not credit a locked-out rep.
    assert.equal(await getActiveRepByReferralCode(a.referralCode), null);
    assert.deepEqual(await getActiveRepByReferralCode(b.referralCode), { id: b.id });
  } finally {
    await cleanupReps(repIds, userIds);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:db:reps`
Expected: FAIL — `Cannot find module './repQueries'`.

- [ ] **Step 3: Rate-limit policies**

In `src/lib/rateLimit.ts`, add to `RATE_LIMITS`:

```ts
  repSignIn: { limit: 10, windowSeconds: 15 * 60 },
  repWrite: { limit: 60, windowSeconds: 10 * 60 },
  repOrderSubmit: { limit: 30, windowSeconds: 10 * 60 },
```

- [ ] **Step 4: `src/db/repQueries.ts`**

```ts
import "server-only";
import { sql } from "./index";
import { randomReferralCode } from "@/lib/repAccount";

export type RepRow = {
  id: string;
  username: string;
  name: string;
  phone: string;
  email: string;
  commissionRateBp: number;
  referralCode: string;
  active: boolean;
  mustChangePassword: boolean;
  sessionVersion: number;
  createdAt: string;
  lastLoginAt: string | null;
};

export type RepInput = {
  username: string;
  name: string;
  phone: string;
  email: string;
  commissionRateBp: number;
};

const COLS = sql`id, username, name, phone, email,
  commission_rate_bp AS "commissionRateBp", referral_code AS "referralCode", active,
  must_change_password AS "mustChangePassword", session_version AS "sessionVersion",
  created_at AS "createdAt", last_login_at AS "lastLoginAt"`;

/** The constraint a unique violation hit, or null for any other error. */
function uniqueViolation(err: unknown): string | null {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === "23505" ? (e.constraint_name ?? "") : null;
}

export async function getRepById(id: string): Promise<RepRow | null> {
  const [row] = await sql<RepRow[]>`SELECT ${COLS} FROM sales_reps WHERE id = ${id}`;
  return row ?? null;
}

/** The hash stays out of `RepRow`, which is passed into Server Components. */
export async function findRepForSignIn(
  username: string,
): Promise<(RepRow & { passwordHash: string }) | null> {
  const [row] = await sql<(RepRow & { passwordHash: string })[]>`
    SELECT ${COLS}, password_hash AS "passwordHash" FROM sales_reps WHERE username = ${username}
  `;
  return row ?? null;
}

export async function getRepPasswordHash(id: string): Promise<string | null> {
  const [row] = await sql<{ passwordHash: string }[]>`
    SELECT password_hash AS "passwordHash" FROM sales_reps WHERE id = ${id}
  `;
  return row?.passwordHash ?? null;
}

export async function touchRepLogin(id: string): Promise<void> {
  await sql`UPDATE sales_reps SET last_login_at = now() WHERE id = ${id}`;
}

/**
 * Stores a new hash and ends every open session for this rep, by moving the
 * session version on. Returns the new version so the caller can re-issue its
 * own cookie, or null when there is no such rep.
 */
export async function setRepPassword(
  id: string,
  passwordHash: string,
  mustChange: boolean,
): Promise<number | null> {
  const [row] = await sql<{ sessionVersion: number }[]>`
    UPDATE sales_reps
    SET password_hash = ${passwordHash}, must_change_password = ${mustChange},
        session_version = session_version + 1
    WHERE id = ${id}
    RETURNING session_version AS "sessionVersion"
  `;
  return row?.sessionVersion ?? null;
}

/**
 * The unique indexes decide, not a lookup first — two admins creating "sara"
 * at once would both pass a check. A clash on the random referral code is not
 * the admin's problem, so it is retried rather than reported.
 */
export async function createRep(
  input: RepInput & { passwordHash: string },
): Promise<RepRow | "username-taken"> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const [row] = await sql<RepRow[]>`
        INSERT INTO sales_reps (username, password_hash, name, phone, email,
                                commission_rate_bp, referral_code)
        VALUES (${input.username}, ${input.passwordHash}, ${input.name}, ${input.phone},
                ${input.email}, ${input.commissionRateBp}, ${randomReferralCode()})
        RETURNING ${COLS}
      `;
      return row;
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint === "sales_reps_username_key") return "username-taken";
      if (constraint === "sales_reps_referral_code_key") continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique referral code");
}

export async function updateRep(
  id: string,
  input: RepInput,
): Promise<"ok" | "not-found" | "username-taken"> {
  try {
    const result = await sql`
      UPDATE sales_reps
      SET username = ${input.username}, name = ${input.name}, phone = ${input.phone},
          email = ${input.email}, commission_rate_bp = ${input.commissionRateBp}
      WHERE id = ${id}
    `;
    return result.count === 0 ? "not-found" : "ok";
  } catch (err) {
    if (uniqueViolation(err) === "sales_reps_username_key") return "username-taken";
    throw err;
  }
}

export async function listReps(): Promise<(RepRow & { customerCount: number })[]> {
  return sql<(RepRow & { customerCount: number })[]>`
    SELECT ${COLS},
           (SELECT count(*)::int FROM users u WHERE u.rep_id = sales_reps.id) AS "customerCount"
    FROM sales_reps
    ORDER BY active DESC, name
  `;
}

export async function listActiveReps(): Promise<{ id: string; name: string }[]> {
  return sql<{ id: string; name: string }[]>`
    SELECT id, name FROM sales_reps WHERE active ORDER BY name
  `;
}

/**
 * Locking the rep out and moving their customers are one transaction: a rep
 * who is locked out but still owns customers would go on being credited with
 * their orders. Moving the session version on is what ends a session that is
 * open right now.
 */
export async function deactivateRep(
  id: string,
  destination: string | null,
): Promise<"ok" | "not-found" | "bad-destination"> {
  return sql.begin(async (tx) => {
    if (destination !== null) {
      if (destination === id) return "bad-destination" as const;
      const [dest] = await tx`SELECT 1 FROM sales_reps WHERE id = ${destination} AND active`;
      if (!dest) return "bad-destination" as const;
    }
    const result = await tx`
      UPDATE sales_reps SET active = false, session_version = session_version + 1
      WHERE id = ${id} AND active
    `;
    if (result.count === 0) return "not-found" as const;
    await tx`UPDATE users SET rep_id = ${destination} WHERE rep_id = ${id}`;
    return "ok" as const;
  });
}

export async function reactivateRep(id: string): Promise<void> {
  await sql`UPDATE sales_reps SET active = true WHERE id = ${id}`;
}

export async function getActiveRepByReferralCode(code: string): Promise<{ id: string } | null> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM sales_reps WHERE referral_code = ${code} AND active
  `;
  return row ?? null;
}
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `npm run test:db:reps`
Expected: PASS (3 tests).

- [ ] **Step 6: `src/lib/repSession.ts`**

```ts
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_SECRET } from "./authSecret";
import { REP_SESSION_TTL_MS, signRepSessionToken, verifyRepSessionToken } from "./repSessionToken";
import { getRepById, type RepRow } from "@/db/repQueries";
import type { Locale } from "./i18n";

const COOKIE = "isupply_rep";

export async function setRepSessionCookie(rep: { id: string; sessionVersion: number }): Promise<void> {
  const jar = await cookies();
  jar.set(
    COOKIE,
    signRepSessionToken(rep.id, rep.sessionVersion, Date.now() + REP_SESSION_TTL_MS, AUTH_SECRET),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(REP_SESSION_TTL_MS / 1000),
    },
  );
}

export async function clearRepSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/**
 * The signed-in rep, re-read from the database on every request.
 *
 * The cookie proves who signed in; only the row can say whether they still
 * may. A deactivated rep, or a cookie minted before the last password change,
 * reads as signed out — the gap customers' cookies still have does not exist
 * here. `cache` lets a layout and its page share the one read.
 */
export const currentRep = cache(async (): Promise<RepRow | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const claim = verifyRepSessionToken(token, AUTH_SECRET);
  if (!claim) return null;
  const rep = await getRepById(claim.repId);
  if (!rep || !rep.active || rep.sessionVersion !== claim.version) return null;
  return rep;
});

/** Portal pages and rep actions: signed in, and past any forced password change. */
export async function requireRep(locale: Locale): Promise<RepRow> {
  const rep = await currentRep();
  if (!rep) redirect(`/${locale}/rep/signin`);
  if (rep.mustChangePassword) redirect(`/${locale}/rep/password`);
  return rep;
}

/** The password page, which a temporary password must still be able to reach. */
export async function requireRepSession(locale: Locale): Promise<RepRow> {
  const rep = await currentRep();
  if (!rep) redirect(`/${locale}/rep/signin`);
  return rep;
}
```

- [ ] **Step 7: Shared components**

Move `src/app/[locale]/admin/(panel)/AdminTabs.tsx` to `src/components/PanelTabs.tsx` (`git mv`), rename the export to `PanelTabs`, keep its comments, and add an `exact` flag, because a portal home at `/rep` would otherwise light up on every page beneath it:

```tsx
export function PanelTabs({
  sections,
}: {
  sections: { href: string; label: string; exact?: boolean }[];
}) {
  const pathname = usePathname();
  // …existing list markup, with:
  const current = pathname === s.href || (!s.exact && pathname.startsWith(`${s.href}/`));
```

Update the admin layout: `import { PanelTabs } from "@/components/PanelTabs";` and `<PanelTabs sections={sections} />`.

`src/components/Banners.tsx` — the two banners the settings page defines inline, shared by every new page:

```tsx
export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 border border-[var(--color-danger)] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
      {children}
    </p>
  );
}

export function SuccessBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-[12px] text-[var(--color-ok)]">
      {children}
    </p>
  );
}
```

- [ ] **Step 8: `src/app/[locale]/rep/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { safeLocale } from "@/lib/i18n";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "@/lib/password";
import { normalizeRepPassword, repPasswordProblems } from "@/lib/repPassword";
import { isValidUsername, normalizeUsername } from "@/lib/repAccount";
import {
  findRepForSignIn,
  getRepPasswordHash,
  setRepPassword,
  touchRepLogin,
} from "@/db/repQueries";
import { clearRepSessionCookie, requireRepSession, setRepSessionCookie } from "@/lib/repSession";

/*
 * No action in this file revalidates. Nothing cached renders a rep, a customer
 * record, a note or an order, and a whole-site purge is how production hung on
 * 2026-08-15 (docs/ARCHITECTURE.md). Every write takes the rep from the
 * session, never from the form.
 */

/**
 * One failure message for an unknown username, a wrong password and a
 * deactivated rep, verified against a dummy hash when there is no account —
 * the same reasoning as the customer sign-in: otherwise the form tells an
 * attacker which usernames exist.
 */
export async function repSignInAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const username = normalizeUsername(boundedString(formData.get("username"), 64) ?? "");
  const password = boundedString(formData.get("password"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });
  const limit = await consumeRateLimit("rep:sign-in", RATE_LIMITS.repSignIn, {
    accountId: username || null,
  });
  if (!limit.allowed) redirect(`/${locale}/rep/signin?error=rate-limit`);

  const rep = isValidUsername(username) ? await findRepForSignIn(username) : null;
  const ok = await verifyPassword(
    normalizeRepPassword(password ?? ""),
    rep ? rep.passwordHash : DUMMY_PASSWORD_HASH,
  );
  if (!rep || !ok || !rep.active) redirect(`/${locale}/rep/signin?error=failed`);

  await setRepSessionCookie(rep);
  await touchRepLogin(rep.id);
  redirect(rep.mustChangePassword ? `/${locale}/rep/password` : `/${locale}/rep`);
}

export async function repSignOutAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  await clearRepSessionCookie();
  redirect(`/${locale}/rep/signin`);
}

/**
 * Both the forced change after a temporary password and a voluntary one.
 *
 * A forced change asks only for the new password: the session was opened with
 * the temporary one moments ago. A voluntary change asks for the current one
 * too, because an unattended signed-in phone is exactly when someone would
 * change it to lock the owner out.
 */
export async function repChangePasswordAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const rep = await requireRepSession(locale);
  const back = `/${locale}/rep/password`;
  const limit = await consumeRateLimit("rep:write", RATE_LIMITS.repWrite, { accountId: rep.id });
  if (!limit.allowed) redirect(`${back}?error=rate-limit`);

  const next = boundedString(formData.get("newPassword"), REQUEST_LIMITS.passwordChars, { trim: false });
  const confirm = boundedString(formData.get("passwordAgain"), REQUEST_LIMITS.passwordChars, { trim: false });
  if (!next || !confirm) redirect(`${back}?error=invalid`);

  if (!rep.mustChangePassword) {
    const current = boundedString(formData.get("currentPassword"), REQUEST_LIMITS.passwordChars, {
      trim: false,
    });
    const hash = await getRepPasswordHash(rep.id);
    if (!current || !hash || !(await verifyPassword(normalizeRepPassword(current), hash))) {
      redirect(`${back}?error=current-password`);
    }
  }
  if (repPasswordProblems(next).length > 0) redirect(`${back}?error=policy`);
  if (normalizeRepPassword(next) !== normalizeRepPassword(confirm)) redirect(`${back}?error=mismatch`);

  const version = await setRepPassword(rep.id, await hashPassword(normalizeRepPassword(next)), false);
  if (version === null) redirect(`/${locale}/rep/signin`);
  // Every other session just ended with the version bump; this one is re-issued.
  await setRepSessionCookie({ id: rep.id, sessionVersion: version });
  redirect(`/${locale}/rep?ok=password`);
}
```

- [ ] **Step 9: Pages**

`src/app/[locale]/rep/signin/page.tsx` — follow `account/signin/page.tsx` exactly (same `<main className="mx-auto max-w-[380px] px-3 pt-8">`, heading, error box, form grid). Differences:
- `if (await currentRep()) redirect(`/${l}/rep`);`
- Title `t.repSignInTitle`, prompt `t.repSignInPrompt`.
- Error box: `error === "rate-limit" ? t.rateLimited : t.repSignInFailed` for `failed`/`rate-limit`.
- Fields: `username` (`type="text"`, `dir="ltr"`, `autoComplete="username"`, `autoCapitalize="none"`, `maxLength={64}`, `required`, `autoFocus`) labelled `t.username`; `password` (`type="password"`, `dir="ltr"`, `autoComplete="current-password"`) labelled `t.password`.
- `action={repSignInAction}`; submit `t.signInTitle`. No sign-up link.

`src/app/[locale]/rep/(session)/layout.tsx`:

```tsx
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n";
import { requireRepSession } from "@/lib/repSession";

/**
 * The gate for the one rep page a temporary password may reach. The portal's
 * own gate sends a rep with `must_change_password` here, so this one must not.
 * A layout is not told the path, which is why the split is two route groups
 * rather than one layout with an exception.
 */
export default async function RepSessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireRepSession(locale as Locale);
  return children;
}
```

`src/app/[locale]/rep/(session)/password/page.tsx` — same shell as the sign-in page. Data: `const rep = await requireRepSession(l)`; `searchParams.error`. Shows:
- Heading `rep.mustChangePassword ? t.choosePasswordTitle : t.changePassword`; when forced, the notice `t.tempPasswordForced`.
- Error box for `policy` → `t.repPasswordPolicy`, `mismatch` → `t.passwordMismatch`, `current-password` → `t.currentPasswordWrong`, `invalid` → `t.invalidInput`, `rate-limit` → `t.rateLimited`.
- The rules paragraph `t.repPasswordRules`, always visible above the fields.
- Fields (all `type="password"`, `dir="ltr"`, `maxLength={REQUEST_LIMITS.passwordChars}`): `currentPassword` (`t.currentPassword`, only when **not** forced, `autoComplete="current-password"`), `newPassword` (`t.newPassword`, `autoComplete="new-password"`), `passwordAgain` (`t.passwordAgain`).
- `action={repChangePasswordAction}`, hidden `locale`, submit `t.savePassword`. When not forced, a link back to `/${l}/rep`.

`src/app/[locale]/rep/(portal)/layout.tsx` — mirror the admin panel layout's shell (`max-w-[1240px]`, `admin-tabs` nav, `admin-tabs-brand`), gated by `const rep = await requireRep(l)`. Sections for now: `[{ href: `/${l}/rep`, label: t.repHome, exact: true }]` (later tasks append Customers, Orders, Commission). At the inline end of the nav: `rep.name` (muted), a `Link` to `/${l}/rep/password` labelled `t.changePassword`, and a sign-out form posting `repSignOutAction` with hidden `locale`, styled like the admin's.

`src/app/[locale]/rep/(portal)/page.tsx` (grows in later tasks): `const rep = await requireRep(l)` (cached — same read as the layout); `<h1>` `t.welcomeRep.replace("{name}", rep.name)` styled like the admin headings; `ok === "password"` → `<SuccessBanner>{t.passwordChanged}</SuccessBanner>`.

- [ ] **Step 10: Dictionary**

Add the Task 4 keys from Appendix A to both `en` and `fa`.

- [ ] **Step 11: The local test server entry**

Add the `industrial-supply-rep-test` configuration from Appendix B to `.claude/launch.json` and commit it on its own:

```bash
git add .claude/launch.json
git commit -m "chore: add a local dev server entry with the CI test admin password"
```

- [ ] **Step 12: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all clean.

Start the test dev server (Appendix B, "Dev server with a test admin password"). There is no rep yet, so in the browser only check: `/fa/rep/signin` renders in RTL with both fields; a wrong username shows `t.repSignInFailed`; `/fa/rep` redirects to `/fa/rep/signin`; `/fa/rep/password` redirects to `/fa/rep/signin`; `/fa/admin/orders` tabs still work.

- [ ] **Step 13: Commit**

```bash
git add -A src/lib/rateLimit.ts src/db/repQueries.ts src/lib/repSession.ts src/components/PanelTabs.tsx src/components/Banners.tsx "src/app/[locale]/admin/(panel)" "src/app/[locale]/rep" src/lib/i18n.ts src/db/salesReps.integration.test.ts
git commit -m "feat: add rep sign-in with revocable sessions and a forced password change"
```

---

### Task 5: Admin — Sales reps

**Files:**
- Create: `src/lib/shownOnce.ts`, `src/lib/siteOrigin.ts`
- Create: `src/components/ShareButton.tsx`, `src/components/ShownOnceCredential.tsx`
- Create: `src/app/[locale]/admin/(panel)/reps/actions.ts`, `…/reps/page.tsx`, `…/reps/[id]/page.tsx`
- Modify: `src/app/[locale]/admin/(panel)/layout.tsx` (Sales reps tab)
- Modify: `src/lib/i18n.ts` (Appendix A, Task 5)

**Interfaces:**
- Consumes: Task 1, Task 2 (`generateTempPassword`, `normalizeRepPassword`), Task 4 (`repQueries`, `Banners`).
- Produces: `type ShownOnce = { kind: "rep" | "customer"; subjectId: string; login: string; password: string }`, `setShownOnce(value)`, `readShownOnce(kind, subjectId): Promise<ShownOnce | null>`; `siteOrigin(): Promise<string>`; `ShareButton({ text, label, copiedLabel, title?, copyOnly?, className? })`; `ShownOnceCredential({ heading, loginLabel, login, password, message, labels })`.

- [ ] **Step 1: `src/lib/shownOnce.ts`**

```ts
import "server-only";
import { cookies } from "next/headers";

const COOKIE = "isupply_shown_once";

export type ShownOnce = {
  kind: "rep" | "customer";
  subjectId: string;
  login: string;
  password: string;
};

/**
 * A new credential handed back exactly once, in a 30-second cookie rather than
 * the URL: query strings land in address bars, history and every proxy's
 * access log, which outlive "shown once" by their retention. The same reasoning
 * as the admin's existing customer reset. Base64 so the JSON's quotes and
 * commas never meet cookie syntax.
 */
export async function setShownOnce(value: ShownOnce): Promise<void> {
  (await cookies()).set(COOKIE, Buffer.from(JSON.stringify(value)).toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30,
  });
}

/** Only the credential minted for this subject; anything else reads as absent. */
export async function readShownOnce(
  kind: ShownOnce["kind"],
  subjectId: string,
): Promise<ShownOnce | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ShownOnce;
    return value.kind === kind &&
      value.subjectId === subjectId &&
      typeof value.login === "string" &&
      typeof value.password === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: `src/lib/siteOrigin.ts`**

```ts
import "server-only";
import { headers } from "next/headers";

/**
 * The origin this request arrived on, for links people copy out of the site:
 * pay links, referral links, sign-in addresses. Taken per request rather than
 * from configuration, so a local test hands out localhost links and a
 * deployment hands out its own domain. A forged Host header only changes the
 * link shown back to whoever forged it.
 */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}
```

- [ ] **Step 3: `src/components/ShareButton.tsx`**

```tsx
"use client";

import { useState } from "react";

/**
 * Share on a phone, copy everywhere else.
 *
 * A rep's customers are reached through messaging apps, and the phone's own
 * share sheet already lists whichever of those they use — no app-specific
 * links to guess at or keep working. Where there is no share sheet (most
 * desktops) the text is copied instead; `copyOnly` skips the sheet for values
 * that are pasted rather than sent, such as a card number.
 */
export function ShareButton({
  text,
  label,
  copiedLabel,
  title,
  copyOnly = false,
  className = "btn-small",
}: {
  text: string;
  label: string;
  copiedLabel: string;
  title?: string;
  copyOnly?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    if (!copyOnly && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text });
        return;
      } catch (error) {
        // Closing the sheet is a choice, not a failure: do nothing.
        if ((error as DOMException).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(label, text);
    }
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {copied ? copiedLabel : label}
    </button>
  );
}
```

- [ ] **Step 4: `src/components/ShownOnceCredential.tsx`**

```tsx
import { ShareButton } from "./ShareButton";

export function ShownOnceCredential({
  heading,
  loginLabel,
  login,
  password,
  message,
  labels,
}: {
  heading: string;
  loginLabel: string;
  login: string;
  password: string;
  /** The ready-to-send text, with the sign-in address, login and password in it. */
  message: string;
  labels: { tempPassword: string; share: string; copied: string };
}) {
  return (
    <div
      role="status"
      className="mb-3 border-2 border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-3 text-[12px]"
    >
      <p className="mb-2 font-bold">{heading}</p>
      <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="font-bold">{loginLabel}</dt>
        <dd className="tech" dir="ltr" data-testid="shown-once-login">{login}</dd>
        <dt className="font-bold">{labels.tempPassword}</dt>
        <dd className="tech" dir="ltr" data-testid="shown-once-password">{password}</dd>
      </dl>
      <ShareButton text={message} label={labels.share} copiedLabel={labels.copied} />
    </div>
  );
}
```

- [ ] **Step 5: `src/app/[locale]/admin/(panel)/reps/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { assertAdminWrite } from "@/lib/admin";
import { safeLocale } from "@/lib/i18n";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";
import { hashPassword } from "@/lib/password";
import { normalizeRepPassword } from "@/lib/repPassword";
import { generateTempPassword } from "@/lib/tempPassword";
import { isValidUsername, normalizeUsername, parseCommissionPercent } from "@/lib/repAccount";
import { isUuid } from "@/lib/ids";
import { setShownOnce } from "@/lib/shownOnce";
import {
  createRep,
  deactivateRep,
  getRepById,
  reactivateRep,
  setRepPassword,
  updateRep,
  type RepInput,
} from "@/db/repQueries";

/*
 * No revalidation anywhere here: nothing cached renders a rep. Every action
 * starts with assertAdminWrite(), which also refuses under DEMO_MODE.
 */

type RepFormError = "incomplete" | "username" | "commission" | "invalid";

function parseRepForm(formData: FormData): { input: RepInput } | { error: RepFormError } {
  const name = boundedString(formData.get("name"), REQUEST_LIMITS.contactNameChars);
  const username = normalizeUsername(boundedString(formData.get("username"), 64) ?? "");
  const phone = boundedString(formData.get("phone"), REQUEST_LIMITS.phoneChars, { allowEmpty: true });
  const email = boundedString(formData.get("email"), REQUEST_LIMITS.emailChars, { allowEmpty: true });
  const commissionRateBp = parseCommissionPercent(String(formData.get("commission") ?? ""));
  if (!name) return { error: "incomplete" };
  if (!isValidUsername(username)) return { error: "username" };
  if (commissionRateBp === null) return { error: "commission" };
  if (phone === null || email === null) return { error: "invalid" };
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "invalid" };
  return { input: { name, username, phone, email: email.toLowerCase(), commissionRateBp } };
}

export async function createRepAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const parsed = parseRepForm(formData);
  if ("error" in parsed) redirect(`/${locale}/admin/reps?error=${parsed.error}`);

  const password = generateTempPassword();
  const created = await createRep({
    ...parsed.input,
    passwordHash: await hashPassword(normalizeRepPassword(password)),
  });
  if (created === "username-taken") redirect(`/${locale}/admin/reps?error=username-taken`);

  await setShownOnce({ kind: "rep", subjectId: created.id, login: created.username, password });
  redirect(`/${locale}/admin/reps/${created.id}?ok=created`);
}

export async function updateRepAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/admin/reps`);
  const back = `/${locale}/admin/reps/${id}`;
  const parsed = parseRepForm(formData);
  if ("error" in parsed) redirect(`${back}?error=${parsed.error}`);
  const result = await updateRep(id, parsed.input);
  if (result === "not-found") redirect(`/${locale}/admin/reps`);
  redirect(result === "username-taken" ? `${back}?error=username-taken` : `${back}?ok=saved`);
}

export async function resetRepPasswordAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  const rep = isUuid(id) ? await getRepById(id) : null;
  if (!rep) redirect(`/${locale}/admin/reps`);

  const password = generateTempPassword();
  await setRepPassword(rep.id, await hashPassword(normalizeRepPassword(password)), true);
  await setShownOnce({ kind: "rep", subjectId: rep.id, login: rep.username, password });
  redirect(`/${locale}/admin/reps/${rep.id}?ok=password`);
}

export async function deactivateRepAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/admin/reps`);
  const raw = String(formData.get("destination") ?? "");
  const destination = raw === "" ? null : raw;
  if (destination !== null && !isUuid(destination)) {
    redirect(`/${locale}/admin/reps/${id}?error=destination`);
  }
  const result = await deactivateRep(id, destination);
  if (result === "bad-destination") redirect(`/${locale}/admin/reps/${id}?error=destination`);
  redirect(`/${locale}/admin/reps/${id}?ok=deactivated`);
}

export async function reactivateRepAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/admin/reps`);
  await reactivateRep(id);
  redirect(`/${locale}/admin/reps/${id}?ok=reactivated`);
}
```

- [ ] **Step 6: Pages**

Add `{ href: `/${l}/admin/reps`, label: t.salesReps }` to the admin layout's `sections`, after Orders.

`reps/page.tsx` — heading `t.salesReps`; data `await listReps()`; error banners for `error` ∈ `incomplete` (`t.required`), `username` (`t.repUsernameInvalid`), `username-taken` (`t.repUsernameTaken`), `commission` (`t.commissionInvalid`), `invalid` (`t.invalidInput`). A `spec-table` of reps: name (link to `/${l}/admin/reps/${id}`), username (`tech`, `dir="ltr"`), phone (`tech`), `commissionPercentLabel(bp, l)`, `formatInt(customerCount, l)`, status (`t.repStatusActive` / `t.repStatusInactive`). Below it a bordered section "`t.newRep`" with a form (`action={createRepAction}`, hidden `locale`, `grid max-w-[680px] gap-3 sm:grid-cols-2`, every input `disabled={DEMO_MODE}`) — `name` (`t.repName`, required), `username` (`t.username`, `dir="ltr"`, `autoCapitalize="none"`, help `t.repUsernameHint`), `phone` (`t.phone`, `type="tel"`, `dir="ltr"`), `email` (`t.email`, optional), `commission` (`t.commissionPercent`, `inputMode="decimal"`, placeholder `2.5`, required); submit `t.createRep`.

`reps/[id]/page.tsx` — `id` must pass `isUuid`, then `getRepById` → `notFound()` when null. Data: `readShownOnce("rep", id)` when `ok` is `created` or `password`; `listActiveReps()`; `siteOrigin()`. Renders, in order:
1. Heading: rep name, username in `tech`, status pill.
2. `ShownOnceCredential` when present: heading `t.tempPasswordOnce`, `loginLabel={t.username}`, message `t.repCredentialsMessage` with `{url}` → `${origin}/${l}/rep/signin`, `{login}`, `{password}` replaced.
3. Banners: `ok=saved` → `t.repSaved`, `ok=deactivated` → `t.repDeactivated`, `ok=reactivated` → `t.repReactivated`, and the error keys of the list page plus `destination` → `t.repBadDestination`.
4. Section `t.details`: the same fields as the new-rep form, prefilled (commission via `formatCommissionPercent`), hidden `repId`, `action={updateRepAction}`, submit `t.save`.
5. Section `t.password`: a form posting `resetRepPasswordAction` (hidden `locale`, `repId`) whose submit is `t.issueTempPassword`, wrapped in `ConfirmSubmit` as the order queue wraps Cancel, with title `t.confirmIssueTempPassword`.
6. Section status: when active, `t.repDeactivateHint`, a `<select name="destination">` of `listActiveReps()` minus this rep plus `<option value="">{t.noRep}</option>`, labelled `t.repMoveCustomersTo`, and a `ConfirmSubmit` titled `t.confirmDeactivateRep` posting `deactivateRepAction`; when inactive, a button `t.repReactivate` posting `reactivateRepAction`.

The two `ConfirmSubmit`s follow the execution note: the reset's `details` is `[{ label: t.username, value: rep.username, tech: true }]`; the deactivation's is `[{ label: t.repName, value: rep.name }]`.

- [ ] **Step 7: Dictionary** — Task 5 keys from Appendix A, both languages.

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

In the browser (Appendix B dev server, admin password `ci-admin-password`): create a rep `test.rep` at 2.5%; the temporary password shows once; reload after 30 s and it is gone. Sign in at `/fa/rep/signin` in a private window with it; land on `/fa/rep/password` with the forced notice; `password1` → policy error listing the rules; `Str0ng!Pass` → home with `t.passwordChanged`. Back in admin: reset the password → the rep's open session is signed out on its next click. Deactivate (destination: no rep) → the rep's session ends; the rep cannot sign in; reactivate → sign-in works again.

- [ ] **Step 9: Commit**

```bash
git add src/lib/shownOnce.ts src/lib/siteOrigin.ts src/components/ShareButton.tsx src/components/ShownOnceCredential.tsx "src/app/[locale]/admin/(panel)" src/lib/i18n.ts
git commit -m "feat: let the admin create, edit, reset and deactivate sales reps"
```

---

### Task 6: Customer IDs and sign-in by ID

**Files:**
- Modify: `src/db/userQueries.ts`
- Modify: `src/app/[locale]/account/actions.ts` (`signInAction`, `signUpAction`)
- Modify: `src/app/[locale]/account/signin/page.tsx`
- Modify: `src/app/[locale]/account/page.tsx` (header shows the ID; email may be null)
- Modify: `src/app/[locale]/quote/page.tsx` (`defaultValue={user?.email ?? undefined}`)
- Modify: `src/lib/i18n.ts` (Appendix A, Task 6)
- Test: `src/db/salesReps.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 (`codeFromPhone`, `randomCustomerCode`, `parseLogin`, `LoginIdentifier`).
- Produces: `UserRow` gains `email: string | null; customerCode: string; address: string; city: string; repId: string | null; mustChangePassword: boolean`; `findUserForSignIn(login: LoginIdentifier)`; `createUser(input: NewUser)` where `NewUser` gains `origin: "self" | "referral"` and `repId: string | null`.

- [ ] **Step 1: Write the failing integration test** (append)

```ts
import { createUser, findUserForSignIn } from "./userQueries";

test("self sign-up gets the phone's digits as its ID, or a random one when taken", async () => {
  assertLocalDatabase();
  const digits = String(randomUUID().replace(/\D/g, "").slice(0, 7)).padEnd(7, "3");
  const phone = `0912${digits}`;
  const ids: string[] = [];
  try {
    const base = { passwordHash: "x", company: "C", contactName: "N", phone, locale: "fa", origin: "self" as const, repId: null };
    const first = await createUser({ ...base, email: `${randomUUID()}@example.invalid` });
    const second = await createUser({ ...base, email: `${randomUUID()}@example.invalid` });
    assert.notEqual(first, "email-taken");
    assert.notEqual(second, "email-taken");
    if (first === "email-taken" || second === "email-taken") return;
    ids.push(first.id, second.id);

    assert.match(first.customerCode, /^[0-9]{7}$/);
    assert.match(second.customerCode, /^[0-9]{7}$/);
    assert.notEqual(first.customerCode, second.customerCode);

    const byCode = await findUserForSignIn({ kind: "code", code: second.customerCode });
    assert.equal(byCode?.id, second.id);
    // Upper-case on purpose: the lookup compares lower(email) on both sides.
    const byEmail = await findUserForSignIn({ kind: "email", email: first.email!.toUpperCase() });
    assert.equal(byEmail?.id, first.id);
    assert.equal(
      await createUser({ ...base, email: first.email! }),
      "email-taken",
    );
  } finally {
    if (ids.length) await sql`DELETE FROM users WHERE id = ANY(${ids})`;
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db:reps`
Expected: FAIL — `findUserForSignIn` is not exported.

- [ ] **Step 3: Implement in `src/db/userQueries.ts`**

Replace `UserRow`, `COLS`, `findUserByEmail`, `NewUser` and `createUser`:

```ts
import { codeFromPhone, randomCustomerCode, type LoginIdentifier } from "@/lib/customerCode";

export type UserRow = {
  id: string;
  /** Null for an account a rep created without one. */
  email: string | null;
  customerCode: string;
  company: string;
  contactName: string;
  phone: string;
  defaultPoNumber: string;
  locale: string;
  address: string;
  city: string;
  repId: string | null;
  mustChangePassword: boolean;
};

const COLS = sql`id, email, customer_code AS "customerCode", company,
                 contact_name AS "contactName", phone,
                 default_po_number AS "defaultPoNumber", locale, address, city,
                 rep_id AS "repId", must_change_password AS "mustChangePassword"`;

/** One sign-in field: a seven-digit ID or an email, never both kinds of lookup. */
export async function findUserForSignIn(
  login: LoginIdentifier,
): Promise<(UserRow & { passwordHash: string }) | null> {
  const where =
    login.kind === "code"
      ? sql`customer_code = ${login.code}`
      : sql`lower(email) = lower(${login.email})`;
  const rows = await sql<(UserRow & { passwordHash: string })[]>`
    SELECT ${COLS}, password_hash AS "passwordHash" FROM users WHERE ${where} LIMIT 1
  `;
  return rows[0] ?? null;
}

export type NewUser = {
  email: string;
  passwordHash: string;
  company: string;
  contactName: string;
  phone: string;
  locale: string;
  /** 'referral' only with the rep whose link brought them; that rep earns commission. */
  origin: "self" | "referral";
  repId: string | null;
};

/**
 * Returns "email-taken" rather than throwing, because a duplicate address is
 * an ordinary thing for a person to do, not an exceptional condition.
 *
 * The unique indexes decide, not a check first — sign-up is exactly where two
 * simultaneous attempts collide. Which index was hit matters now: a clash on
 * the email is the person's, reported; a clash on the customer ID is not
 * theirs, and a self sign-up is never shown an error for something it did not
 * choose, so it quietly takes a random ID instead.
 */
export async function createUser(input: NewUser): Promise<UserRow | "email-taken"> {
  let code = codeFromPhone(input.phone) ?? randomCustomerCode();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const rows = await sql<UserRow[]>`
        INSERT INTO users (email, password_hash, company, contact_name, phone, locale,
                           customer_code, origin, rep_id, origin_rep_id, rep_earns_commission)
        VALUES (${input.email}, ${input.passwordHash}, ${input.company},
                ${input.contactName}, ${input.phone}, ${input.locale}, ${code},
                ${input.origin}, ${input.repId}, ${input.repId}, ${input.repId !== null})
        RETURNING ${COLS}
      `;
      return rows[0];
    } catch (err) {
      const e = err as { code?: string; constraint_name?: string };
      if (e?.code !== "23505") throw err;
      if (e.constraint_name === "users_customer_code_key") {
        code = randomCustomerCode();
        continue;
      }
      return "email-taken";
    }
  }
  throw new Error("Could not allocate a unique customer ID");
}
```

Delete `findUserByEmail` once `signInAction` no longer uses it (grep first: `grep -rn findUserByEmail src`).

- [ ] **Step 4: Callers**

`account/actions.ts`:
- `signUpAction`: pass `origin: "self", repId: null` to `createUser` (Task 12 replaces this with the referral lookup).
- `signInAction`:

```ts
  const raw = boundedString(formData.get("login"), REQUEST_LIMITS.emailChars);
  const login = raw ? parseLogin(raw) : null;
  const user = login ? await findUserForSignIn(login) : null;
  const ok = await verifyPassword(password ?? "", user ? user.passwordHash : DUMMY_HASH);
```

(the rest unchanged; update the doc comment's "no such account" wording to cover IDs).

`account/signin/page.tsx`: the first field becomes `name="login"`, `type="text"`, `autoComplete="username"`, `autoCapitalize="none"`, `inputMode` omitted, label `t.loginEmailOrId`.

`account/page.tsx`: the header's `signedInAs` line shows `user.email ?? user.customerCode`, and a second muted line `t.customerId`: `<span className="tech" dir="ltr">{user.customerCode}</span>`.

`quote/page.tsx`: `defaultValue={user?.email ?? undefined}` on the email field.

- [ ] **Step 5: Dictionary** — Task 6 keys (Appendix A), including the changed `signInFailed` text in both languages.

- [ ] **Step 6: Run everything**

Run: `npm run test:db:reps && npx tsc --noEmit && npm run lint && npm test`
Expected: PASS / clean. `tsc` must show no remaining `UserRow.email` null errors.

Browser: sign up a customer with phone `0912 555 0101` → account page shows ID `5550101`; sign out; sign in with `۵۵۵۰۱۰۱` → succeeds; sign in with the email → succeeds; wrong password → `t.signInFailed`.

- [ ] **Step 7: Commit**

```bash
git add src/db/userQueries.ts "src/app/[locale]/account" "src/app/[locale]/quote/page.tsx" src/lib/i18n.ts src/db/salesReps.integration.test.ts
git commit -m "feat: give every customer a seven-digit ID they can sign in with"
```

---

### Task 7: Customer forced password change

**Files:**
- Modify: `src/db/userQueries.ts` (`setPassword(userId, hash, mustChange)`)
- Modify: `src/app/[locale]/account/actions.ts` (`setInitialPasswordAction`; `changePasswordAction` passes `false`; `signInAction` redirect)
- Modify: `src/app/[locale]/admin/actions.ts` (`resetCustomerPasswordAction` passes `true`)
- Create: `src/app/[locale]/account/password/page.tsx`
- Modify: `src/app/[locale]/account/page.tsx`, `src/app/[locale]/account/orders/[ref]/page.tsx` (gate)
- Modify: `src/lib/i18n.ts` (Appendix A, Task 7)
- Test: `src/db/salesReps.integration.test.ts`

**Interfaces:**
- Consumes: Task 6 `UserRow.mustChangePassword`.
- Produces: `setPassword(userId: string, passwordHash: string, mustChange: boolean): Promise<void>`; `setInitialPasswordAction(formData)`.

- [ ] **Step 1: Failing test** (append)

```ts
import { setPassword, getUserById } from "./userQueries";

test("a reset password must be replaced; the replacement clears the flag", async () => {
  assertLocalDatabase();
  const created = await createUser({
    email: `${randomUUID()}@example.invalid`, passwordHash: "x", company: "C", contactName: "N",
    phone: "12", locale: "en", origin: "self", repId: null,
  });
  if (created === "email-taken") throw new Error("unexpected");
  try {
    await setPassword(created.id, "reset-hash", true);
    assert.equal((await getUserById(created.id))?.mustChangePassword, true);
    await setPassword(created.id, "own-hash", false);
    assert.equal((await getUserById(created.id))?.mustChangePassword, false);
  } finally {
    await sql`DELETE FROM users WHERE id = ${created.id}`;
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db:reps`
Expected: FAIL — type error or `mustChangePassword` stays false (setPassword ignores a third argument).

- [ ] **Step 3: Implement**

`userQueries.ts`:

```ts
/**
 * `mustChange` is true for a password someone else chose — a rep or admin
 * reset — so the customer replaces it at their next sign-in, and false for one
 * the customer chose themselves.
 */
export async function setPassword(
  userId: string,
  passwordHash: string,
  mustChange: boolean,
): Promise<void> {
  await sql`
    UPDATE users SET password_hash = ${passwordHash}, must_change_password = ${mustChange}
    WHERE id = ${userId}
  `;
}
```

`admin/actions.ts` `resetCustomerPasswordAction`: `await setPassword(userId, await hashPassword(generated), true);`.

`account/actions.ts`: `changePasswordAction` → `setPassword(user.id, …, false)`; `signInAction` ends with `redirect(user.mustChangePassword ? `/${…}/account/password` : …existing target…)`; add:

```ts
/**
 * The first password a customer chooses after a rep or admin set one for them.
 * No current password asked: the session was opened with the temporary one
 * moments ago. Refused for anyone not flagged, so it cannot become a way
 * around the current-password check on the ordinary change form.
 */
export async function setInitialPasswordAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const user = await currentUser();
  if (!user) redirect(`/${locale}/account/signin`);
  if (!user.mustChangePassword) redirect(`/${locale}/account`);
  const back = `/${locale}/account/password`;
  const limit = await consumeRateLimit("account:write", RATE_LIMITS.accountWrite, {
    accountId: user.id,
  });
  if (!limit.allowed) redirect(`${back}?error=rate-limit`);

  const next = boundedString(formData.get("newPassword"), REQUEST_LIMITS.passwordChars, { trim: false });
  const confirm = boundedString(formData.get("passwordAgain"), REQUEST_LIMITS.passwordChars, { trim: false });
  if (!next || !confirm) redirect(`${back}?error=invalid`);
  if (next.length < MIN_PASSWORD_LENGTH) redirect(`${back}?error=short`);
  if (next !== confirm) redirect(`${back}?error=mismatch`);

  await setPassword(user.id, await hashPassword(next), false);
  redirect(`/${locale}/account?ok=password`);
}
```

`account/password/page.tsx`: shell of the sign-in page. `const user = await currentUser()`; none → `redirect(/account/signin)`; not flagged → `redirect(/account)`. Heading `t.choosePasswordTitle`, notice `t.tempPasswordForced`, errors `short`/`mismatch`/`invalid`/`rate-limit` mapped to the existing keys, fields `newPassword` and `passwordAgain`, submit `t.savePassword`, `action={setInitialPasswordAction}`.

Gates: in `account/page.tsx`, right after the signed-out prompt: `if (user.mustChangePassword) redirect(`/${l}/account/password`);`. In `account/orders/[ref]/page.tsx`, replace `currentUserId()` with `currentUser()`, redirect to sign-in when null, and to `/account/password` when flagged; pass `user.id` on.

- [ ] **Step 4: Run**

Run: `npm run test:db:reps && npx tsc --noEmit && npm run lint && npm test`
Expected: PASS / clean.

The browser check of this flow waits for Task 11, whose admin customer page can reset any customer's password; the integration test above covers the flag itself.

- [ ] **Step 5: Commit**

```bash
git add src/db/userQueries.ts "src/app/[locale]/account" "src/app/[locale]/admin/actions.ts" src/lib/i18n.ts src/db/salesReps.integration.test.ts
git commit -m "feat: make customers replace any password someone else set for them"
```

- [ ] **Step 6: Phase 1 gate**

Run the full local gate from Appendix B ("Full gate"), including the e2e suite (existing tests must still pass). Fix anything red before starting Phase 2.

---

# Phase 2 — Customers and CRM

### Task 8: Persian calendar helpers

**Files:**
- Create: `src/lib/persianCalendar.ts`, `src/lib/persianCalendar.test.ts`

**Interfaces:**
- Consumes: `Locale`.
- Produces: `type PersianYearMonth = { year: number; month: number }`, `persianYearMonth(date: Date)`, `persianMonthName(month, locale)`, `persianMonthLabel(ym, locale)`, `formatPersianDate(value: Date | string, locale)`, `formatPersianDay(isoDate: string, locale)`, `tehranToday(now?): string` (`YYYY-MM-DD`), `tehranDatePlusDays(days, now?): string`.

- [ ] **Step 1: Write the failing test** — `src/lib/persianCalendar.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPersianDate,
  formatPersianDay,
  persianMonthLabel,
  persianYearMonth,
  tehranDatePlusDays,
  tehranToday,
} from "./persianCalendar";

test("Nowruz 1405 falls on 21 March 2026 in Tehran", () => {
  assert.deepEqual(persianYearMonth(new Date("2026-03-21T08:30:00Z")), { year: 1405, month: 1 });
  assert.deepEqual(persianYearMonth(new Date("2026-03-20T12:00:00Z")), { year: 1404, month: 12 });
});

test("a month turns at Tehran midnight, not at UTC midnight", () => {
  // 23:59 in Tehran on 31 Shahrivar 1405.
  assert.deepEqual(persianYearMonth(new Date("2026-09-22T20:29:00Z")), { year: 1405, month: 6 });
  // 00:01 in Tehran on 1 Mehr 1405 — still 22 September in UTC.
  assert.deepEqual(persianYearMonth(new Date("2026-09-22T20:31:00Z")), { year: 1405, month: 7 });
});

test("dates and months read naturally in each language", () => {
  assert.equal(formatPersianDate("2026-09-26T12:00:00Z", "fa"), "۴ مهر ۱۴۰۵");
  assert.equal(formatPersianDate("2026-09-26T12:00:00Z", "en"), "4 Mehr 1405");
  assert.equal(formatPersianDay("2026-09-23", "en"), "1 Mehr 1405");
  assert.equal(persianMonthLabel({ year: 1405, month: 12 }, "en"), "Esfand 1405");
  assert.equal(persianMonthLabel({ year: 1405, month: 7 }, "fa"), "مهر ۱۴۰۵");
});

test("today and follow-up dates are Tehran calendar days", () => {
  // 00:30 in Tehran on 27 September is still 21:00 UTC on the 26th.
  const justAfterMidnight = new Date("2026-09-26T21:00:00Z");
  assert.equal(tehranToday(justAfterMidnight), "2026-09-27");
  assert.equal(tehranDatePlusDays(1, justAfterMidnight), "2026-09-28");
  assert.equal(tehranDatePlusDays(7, justAfterMidnight), "2026-10-04");
  assert.equal(tehranDatePlusDays(30, justAfterMidnight), "2026-10-27");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './persianCalendar'`.

- [ ] **Step 3: Implement** — `src/lib/persianCalendar.ts`

```ts
import type { Locale } from "./i18n";

/**
 * The Persian (Solar Hijri) calendar on Tehran time — how Iranian businesses
 * keep their books, and so how a rep's month is counted.
 *
 * Postgres has no Persian calendar, which is why month bucketing happens here
 * and not in SQL. Node's ICU has one (2026-09-26 → 4 Mehr 1405). Month names
 * are fixed below rather than taken from ICU, so English spelling does not
 * change with an ICU upgrade.
 */
const TEHRAN = "Asia/Tehran";

const PERSIAN_PARTS = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
  timeZone: TEHRAN,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

// en-CA writes dates as YYYY-MM-DD, the shape of a Postgres date column.
const GREGORIAN_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEHRAN,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const faNumber = new Intl.NumberFormat("fa-IR", { useGrouping: false });

const MONTHS_EN = [
  "Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar",
  "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand",
] as const;
const MONTHS_FA = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
] as const;

export type PersianYearMonth = { year: number; month: number };

function persianParts(date: Date): PersianYearMonth & { day: number } {
  const parts = PERSIAN_PARTS.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function persianYearMonth(date: Date): PersianYearMonth {
  const { year, month } = persianParts(date);
  return { year, month };
}

export function persianMonthName(month: number, locale: Locale): string {
  return (locale === "fa" ? MONTHS_FA : MONTHS_EN)[month - 1] ?? "";
}

export function persianMonthLabel(ym: PersianYearMonth, locale: Locale): string {
  const year = locale === "fa" ? faNumber.format(ym.year) : String(ym.year);
  return `${persianMonthName(ym.month, locale)} ${year}`;
}

/** An instant, read on Tehran time: "4 Mehr 1405" / "۴ مهر ۱۴۰۵". */
export function formatPersianDate(value: Date | string, locale: Locale): string {
  const { year, month, day } = persianParts(new Date(value));
  if (locale === "fa") {
    return `${faNumber.format(day)} ${MONTHS_FA[month - 1]} ${faNumber.format(year)}`;
  }
  return `${day} ${MONTHS_EN[month - 1]} ${year}`;
}

/**
 * A calendar day stored as `YYYY-MM-DD` — a follow-up date — is not an
 * instant. Reading it at Tehran noon keeps it on the same day whatever the
 * server's own time zone.
 */
export function formatPersianDay(isoDate: string, locale: Locale): string {
  return formatPersianDate(new Date(`${isoDate}T12:00:00+03:30`), locale);
}

/** Today in Tehran as `YYYY-MM-DD`, for comparing with date columns. */
export function tehranToday(now: Date = new Date()): string {
  return GREGORIAN_DAY.format(now);
}

export function tehranDatePlusDays(days: number, now: Date = new Date()): string {
  const [year, month, day] = tehranToday(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/persianCalendar.ts src/lib/persianCalendar.test.ts
git commit -m "feat: add Persian calendar helpers on Tehran time"
```

---

### Task 9: Customer and note queries

**Files:**
- Create: `src/db/customerQueries.ts`, `src/db/noteQueries.ts`
- Test: `src/db/salesReps.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 (`codeFromPhone`, `randomCustomerCode`, `latinDigits`), Task 4 (`createRep`, `cleanupReps` test helper).
- Produces:
  - `type CustomerOrigin = "self" | "rep" | "referral"`; `type CustomerRow = { id; customerCode; company; contactName; phone; email: string | null; address; city; defaultPoNumber; locale; repId: string | null; repEarnsCommission: boolean; origin: CustomerOrigin; nextFollowUpOn: string | null; createdAt: string }`
  - `type CustomerInput = { company; contactName; phone; email: string | null; address; city }`
  - `type CreateCustomerResult = { kind: "created"; id: string; customerCode: string } | { kind: "code-taken" } | { kind: "email-taken" } | { kind: "no-phone-code" }`
  - Rep-scoped: `listCustomersForRep(repId, search): Promise<(CustomerRow & { lastOrderAt: string | null })[]>`, `getCustomerForRep(repId, customerId)`, `createCustomerForRep(repId, input & { codeChoice: "phone" | "random"; passwordHash; locale })`, `updateCustomerForRep(repId, customerId, input): Promise<"ok" | "not-found" | "email-taken">`, `resetCustomerPasswordForRep(repId, customerId, hash): Promise<CustomerRow | null>`, `setFollowUpForRep(repId, customerId, date: string | null): Promise<boolean>`, `listFollowUpsDue(repId, today): Promise<CustomerRow[]>`, `countCustomersForRep(repId): Promise<number>`
  - Admin: `type AdminCustomerRow = CustomerRow & { repName: string | null; originRepName: string | null; orderCount: number }`, `type RepFilter = "all" | "none" | { repId: string }`, `listCustomersAdmin({ search, rep, page, pageSize }): Promise<{ rows: AdminCustomerRow[]; total: number }>`, `getCustomerAdmin(customerId)`, `assignCustomer(customerId, repId | null, earns): Promise<"ok" | "not-found" | "bad-rep">`, `resetCustomerPasswordAdmin(customerId, hash): Promise<CustomerRow | null>`, `setFollowUpAdmin(customerId, date | null): Promise<boolean>`
  - Notes: `type CustomerNote = { id: number; body: string; createdAt: string; authorName: string | null }`, `listNotes(customerId)`, `addNoteForRep(repId, customerId, body): Promise<boolean>`, `addNoteAdmin(customerId, body): Promise<boolean>`

- [ ] **Step 1: Write the failing integration test** (append)

```ts
import {
  assignCustomer,
  createCustomerForRep,
  getCustomerForRep,
  listCustomersForRep,
  resetCustomerPasswordForRep,
  setFollowUpForRep,
  updateCustomerForRep,
} from "./customerQueries";
import { addNoteForRep, listNotes } from "./noteQueries";

function randomPhone(): string {
  return `0912${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
}

test("a rep reads and changes only their own customers", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  try {
    const a = await createRep({ username: `ca-${suffix}`, name: "A", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    const b = await createRep({ username: `cb-${suffix}`, name: "B", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    if (a === "username-taken" || b === "username-taken") throw new Error("username clash");
    repIds.push(a.id, b.id);

    const phone = randomPhone();
    const input = { company: `Co ${suffix}`, contactName: "N", phone, email: null, address: "", city: "" };
    const created = await createCustomerForRep(a.id, { ...input, codeChoice: "phone", passwordHash: "x", locale: "fa" });
    if (created.kind !== "created") throw new Error(created.kind);
    userIds.push(created.id);
    assert.equal(created.customerCode, phone.slice(-7));

    const mine = await getCustomerForRep(a.id, created.id);
    assert.equal(mine?.origin, "rep");
    assert.equal(mine?.repEarnsCommission, true);
    const [flag] = await sql<{ must: boolean }[]>`SELECT must_change_password AS must FROM users WHERE id = ${created.id}`;
    assert.equal(flag.must, true);

    // Rep B: every path reads as not found and changes nothing.
    assert.equal(await getCustomerForRep(b.id, created.id), null);
    assert.equal(await updateCustomerForRep(b.id, created.id, { ...input, company: "Hijacked" }), "not-found");
    assert.equal(await resetCustomerPasswordForRep(b.id, created.id, "y"), null);
    assert.equal(await setFollowUpForRep(b.id, created.id, "2030-01-01"), false);
    assert.equal(await addNoteForRep(b.id, created.id, "sneaky"), false);
    assert.equal((await listCustomersForRep(b.id, "")).some((c) => c.id === created.id), false);
    assert.equal((await getCustomerForRep(a.id, created.id))?.company, `Co ${suffix}`);
    assert.deepEqual(await listNotes(created.id), []);

    // Rep A can, and search finds by ID and by phone digits.
    assert.equal(await addNoteForRep(a.id, created.id, "Called about O-rings"), true);
    assert.equal((await listNotes(created.id))[0]?.body, "Called about O-rings");
    assert.equal(await setFollowUpForRep(a.id, created.id, "2030-01-01"), true);
    assert.equal((await listCustomersForRep(a.id, created.customerCode))[0]?.id, created.id);
    assert.equal((await listCustomersForRep(a.id, phone.slice(-5))).some((c) => c.id === created.id), true);

    // The same phone again: its digits are taken, and the rep is told so.
    assert.deepEqual(
      await createCustomerForRep(a.id, { ...input, codeChoice: "phone", passwordHash: "x", locale: "fa" }),
      { kind: "code-taken" },
    );
    const random = await createCustomerForRep(a.id, { ...input, codeChoice: "random", passwordHash: "x", locale: "fa" });
    if (random.kind !== "created") throw new Error(random.kind);
    userIds.push(random.id);
    assert.notEqual(random.customerCode, created.customerCode);
    assert.deepEqual(
      await createCustomerForRep(a.id, { ...input, phone: "123", codeChoice: "phone", passwordHash: "x", locale: "fa" }),
      { kind: "no-phone-code" },
    );

    const email = `${suffix}@example.invalid`;
    const withEmail = await createCustomerForRep(a.id, { ...input, phone: randomPhone(), email, codeChoice: "phone", passwordHash: "x", locale: "fa" });
    if (withEmail.kind !== "created") throw new Error(withEmail.kind);
    userIds.push(withEmail.id);
    assert.deepEqual(
      await createCustomerForRep(a.id, { ...input, phone: randomPhone(), email: email.toUpperCase(), codeChoice: "phone", passwordHash: "x", locale: "fa" }),
      { kind: "email-taken" },
    );

    // Moving the customer hands access and notes to the new rep.
    assert.equal(await assignCustomer(created.id, b.id, false), "ok");
    assert.equal(await getCustomerForRep(a.id, created.id), null);
    assert.equal((await getCustomerForRep(b.id, created.id))?.repEarnsCommission, false);
    assert.equal((await listNotes(created.id)).length, 1);
  } finally {
    await cleanupReps(repIds, userIds);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db:reps`
Expected: FAIL — `Cannot find module './customerQueries'`.

- [ ] **Step 3: Implement** — `src/db/customerQueries.ts`

```ts
import "server-only";
import { sql } from "./index";
import { codeFromPhone, randomCustomerCode } from "@/lib/customerCode";
import { latinDigits } from "@/lib/digits";

export type CustomerOrigin = "self" | "rep" | "referral";

export type CustomerRow = {
  id: string;
  customerCode: string;
  company: string;
  contactName: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
  defaultPoNumber: string;
  locale: string;
  repId: string | null;
  repEarnsCommission: boolean;
  origin: CustomerOrigin;
  nextFollowUpOn: string | null;
  createdAt: string;
};

export type CustomerInput = {
  company: string;
  contactName: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
};

export type CreateCustomerResult =
  | { kind: "created"; id: string; customerCode: string }
  | { kind: "code-taken" }
  | { kind: "email-taken" }
  | { kind: "no-phone-code" };

const COLS = sql`u.id, u.customer_code AS "customerCode", u.company,
  u.contact_name AS "contactName", u.phone, u.email, u.address, u.city,
  u.default_po_number AS "defaultPoNumber", u.locale, u.rep_id AS "repId",
  u.rep_earns_commission AS "repEarnsCommission", u.origin,
  u.next_follow_up_on::text AS "nextFollowUpOn", u.created_at AS "createdAt"`;

function uniqueViolation(err: unknown): string | null {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === "23505" ? (e.constraint_name ?? "") : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The ID exactly; the company, contact or email by substring; or the phone's
 * digits by substring. Persian digits in the search box or in a stored phone
 * both count.
 */
function matches(search: string) {
  const text = latinDigits(search.trim());
  if (text === "") return sql`TRUE`;
  const like = `%${escapeLike(text)}%`;
  const digits = text.replace(/\D/g, "");
  const phone =
    digits.length >= 3
      ? sql`OR regexp_replace(translate(u.phone, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
                              '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`
      : sql`OR FALSE`;
  return sql`(u.customer_code = ${text} OR u.company ILIKE ${like}
              OR u.contact_name ILIKE ${like} OR u.email ILIKE ${like} ${phone})`;
}

// ── Rep-scoped. Every statement carries `rep_id = $rep` in its own WHERE, so
// a customer id posted for someone else's customer matches nothing — the
// ownership rule is in the query, not a check before it that a later edit
// could drop.

export async function listCustomersForRep(
  repId: string,
  search: string,
): Promise<(CustomerRow & { lastOrderAt: string | null })[]> {
  return sql<(CustomerRow & { lastOrderAt: string | null })[]>`
    SELECT ${COLS},
           (SELECT max(o.created_at) FROM orders o WHERE o.user_id = u.id) AS "lastOrderAt"
    FROM users u
    WHERE u.rep_id = ${repId} AND ${matches(search)}
    ORDER BY u.company, u.customer_code
    LIMIT 500
  `;
}

export async function getCustomerForRep(repId: string, customerId: string): Promise<CustomerRow | null> {
  const [row] = await sql<CustomerRow[]>`
    SELECT ${COLS} FROM users u WHERE u.id = ${customerId} AND u.rep_id = ${repId}
  `;
  return row ?? null;
}

/**
 * A rep-created customer starts with commission on and a temporary password
 * they must replace. The unique indexes decide clashes. A clash on the
 * phone-derived ID is reported rather than quietly replaced with a random one:
 * those digits usually mean this customer already has an account, and saying
 * so is the only thing that stops a duplicate.
 */
export async function createCustomerForRep(
  repId: string,
  input: CustomerInput & { codeChoice: "phone" | "random"; passwordHash: string; locale: string },
): Promise<CreateCustomerResult> {
  const fromPhone = input.codeChoice === "phone" ? codeFromPhone(input.phone) : null;
  if (input.codeChoice === "phone" && fromPhone === null) return { kind: "no-phone-code" };
  let code = fromPhone ?? randomCustomerCode();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const [row] = await sql<{ id: string; customerCode: string }[]>`
        INSERT INTO users (email, password_hash, company, contact_name, phone, address, city,
                           locale, customer_code, rep_id, origin, origin_rep_id,
                           rep_earns_commission, must_change_password)
        VALUES (${input.email}, ${input.passwordHash}, ${input.company}, ${input.contactName},
                ${input.phone}, ${input.address}, ${input.city}, ${input.locale}, ${code},
                ${repId}, 'rep', ${repId}, true, true)
        RETURNING id, customer_code AS "customerCode"
      `;
      return { kind: "created", id: row.id, customerCode: row.customerCode };
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint === null) throw err;
      if (constraint === "users_email_lower_key") return { kind: "email-taken" };
      if (fromPhone !== null && code === fromPhone) return { kind: "code-taken" };
      code = randomCustomerCode();
    }
  }
  throw new Error("Could not allocate a unique customer ID");
}

export async function updateCustomerForRep(
  repId: string,
  customerId: string,
  input: CustomerInput,
): Promise<"ok" | "not-found" | "email-taken"> {
  try {
    const result = await sql`
      UPDATE users
      SET company = ${input.company}, contact_name = ${input.contactName}, phone = ${input.phone},
          email = ${input.email}, address = ${input.address}, city = ${input.city}
      WHERE id = ${customerId} AND rep_id = ${repId}
    `;
    return result.count === 0 ? "not-found" : "ok";
  } catch (err) {
    if (uniqueViolation(err) === "users_email_lower_key") return "email-taken";
    throw err;
  }
}

export async function resetCustomerPasswordForRep(
  repId: string,
  customerId: string,
  passwordHash: string,
): Promise<CustomerRow | null> {
  const [row] = await sql<CustomerRow[]>`
    UPDATE users u SET password_hash = ${passwordHash}, must_change_password = true
    WHERE u.id = ${customerId} AND u.rep_id = ${repId}
    RETURNING ${COLS}
  `;
  return row ?? null;
}

export async function setFollowUpForRep(
  repId: string,
  customerId: string,
  date: string | null,
): Promise<boolean> {
  const result = await sql`
    UPDATE users SET next_follow_up_on = ${date}::date
    WHERE id = ${customerId} AND rep_id = ${repId}
  `;
  return result.count === 1;
}

/** Due today or overdue, oldest first. `today` is Tehran's date (persianCalendar). */
export async function listFollowUpsDue(repId: string, today: string): Promise<CustomerRow[]> {
  return sql<CustomerRow[]>`
    SELECT ${COLS} FROM users u
    WHERE u.rep_id = ${repId} AND u.next_follow_up_on <= ${today}::date
    ORDER BY u.next_follow_up_on, u.company
    LIMIT 50
  `;
}

export async function countCustomersForRep(repId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE rep_id = ${repId}`;
  return row.n;
}

// ── Admin. Callers have already passed assertAdminWrite() or the panel gate.

export type AdminCustomerRow = CustomerRow & {
  repName: string | null;
  originRepName: string | null;
  orderCount: number;
};

export type RepFilter = "all" | "none" | { repId: string };

const ADMIN_COLS = sql`${COLS}, r.name AS "repName", origin_rep.name AS "originRepName",
  (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id) AS "orderCount"`;
const ADMIN_FROM = sql`users u
  LEFT JOIN sales_reps r ON r.id = u.rep_id
  LEFT JOIN sales_reps origin_rep ON origin_rep.id = u.origin_rep_id`;

function repFilter(filter: RepFilter) {
  if (filter === "all") return sql`TRUE`;
  if (filter === "none") return sql`u.rep_id IS NULL`;
  return sql`u.rep_id = ${filter.repId}`;
}

export async function listCustomersAdmin(options: {
  search: string;
  rep: RepFilter;
  page: number;
  pageSize: number;
}): Promise<{ rows: AdminCustomerRow[]; total: number }> {
  const where = sql`${matches(options.search)} AND ${repFilter(options.rep)}`;
  const [rows, [count]] = await Promise.all([
    sql<AdminCustomerRow[]>`
      SELECT ${ADMIN_COLS} FROM ${ADMIN_FROM} WHERE ${where}
      ORDER BY u.created_at DESC, u.id
      LIMIT ${options.pageSize} OFFSET ${(options.page - 1) * options.pageSize}
    `,
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM users u WHERE ${where}`,
  ]);
  return { rows, total: count.total };
}

export async function getCustomerAdmin(customerId: string): Promise<AdminCustomerRow | null> {
  const [row] = await sql<AdminCustomerRow[]>`
    SELECT ${ADMIN_COLS} FROM ${ADMIN_FROM} WHERE u.id = ${customerId}
  `;
  return row ?? null;
}

/**
 * Who the customer's rep is, and whether that rep earns commission on them.
 * Both apply to orders placed from now on: each order locks its own copy when
 * it is placed (orderSubmissionQueries.ts), so nothing here reaches back.
 */
export async function assignCustomer(
  customerId: string,
  repId: string | null,
  earnsCommission: boolean,
): Promise<"ok" | "not-found" | "bad-rep"> {
  if (repId !== null) {
    const [rep] = await sql`SELECT 1 FROM sales_reps WHERE id = ${repId} AND active`;
    if (!rep) return "bad-rep";
  }
  const result = await sql`
    UPDATE users SET rep_id = ${repId}, rep_earns_commission = ${earnsCommission}
    WHERE id = ${customerId}
  `;
  return result.count === 0 ? "not-found" : "ok";
}

export async function resetCustomerPasswordAdmin(
  customerId: string,
  passwordHash: string,
): Promise<CustomerRow | null> {
  const [row] = await sql<CustomerRow[]>`
    UPDATE users u SET password_hash = ${passwordHash}, must_change_password = true
    WHERE u.id = ${customerId}
    RETURNING ${COLS}
  `;
  return row ?? null;
}

export async function setFollowUpAdmin(customerId: string, date: string | null): Promise<boolean> {
  const result = await sql`
    UPDATE users SET next_follow_up_on = ${date}::date WHERE id = ${customerId}
  `;
  return result.count === 1;
}
```

`src/db/noteQueries.ts`:

```ts
import "server-only";
import { sql } from "./index";

export type CustomerNote = {
  id: number;
  body: string;
  createdAt: string;
  /** The rep who wrote it; null when the admin did. */
  authorName: string | null;
};

/** Callers check access to the customer first; the notes themselves are not scoped. */
export async function listNotes(customerId: string): Promise<CustomerNote[]> {
  return sql<CustomerNote[]>`
    SELECT n.id, n.body, n.created_at AS "createdAt", r.name AS "authorName"
    FROM customer_notes n
    LEFT JOIN sales_reps r ON r.id = n.author_rep_id
    WHERE n.user_id = ${customerId}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 200
  `;
}

/**
 * Scoped in the insert itself: a note for someone else's customer selects no
 * row and inserts nothing. Append-only — there is no edit or delete.
 */
export async function addNoteForRep(repId: string, customerId: string, body: string): Promise<boolean> {
  const result = await sql`
    INSERT INTO customer_notes (user_id, author_rep_id, body)
    SELECT u.id, ${repId}, ${body} FROM users u WHERE u.id = ${customerId} AND u.rep_id = ${repId}
  `;
  return result.count === 1;
}

export async function addNoteAdmin(customerId: string, body: string): Promise<boolean> {
  const result = await sql`
    INSERT INTO customer_notes (user_id, author_rep_id, body)
    SELECT u.id, NULL, ${body} FROM users u WHERE u.id = ${customerId}
  `;
  return result.count === 1;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:db:reps && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/db/customerQueries.ts src/db/noteQueries.ts src/db/salesReps.integration.test.ts
git commit -m "feat: add rep-scoped and admin customer queries and customer notes"
```

---

### Task 10: Rep customer pages

**Files:**
- Modify: `src/app/[locale]/rep/actions.ts` (customer actions)
- Create: `src/components/CustomerNotes.tsx`, `src/components/FollowUpControl.tsx`
- Create: `src/app/[locale]/rep/(portal)/customers/page.tsx`, `…/customers/new/page.tsx`, `…/customers/[id]/page.tsx`
- Modify: `src/app/[locale]/rep/(portal)/layout.tsx` (Customers tab), `…/(portal)/page.tsx` (follow-ups due)
- Modify: `src/lib/i18n.ts` (Appendix A, Task 10)

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5, 8, 9.
- Produces: rep actions `createCustomerAction`, `updateCustomerAction`, `resetCustomerPasswordAction`, `addCustomerNoteAction`, `setFollowUpAction` (all take `FormData` with hidden `locale` and, except create, `customerId`); components `CustomerNotes({ locale, notes, action, hidden, disabled? })`, `FollowUpControl({ locale, current, today, action, hidden, disabled? })`.

- [ ] **Step 1: Rep actions** — append to `src/app/[locale]/rep/actions.ts` (add the imports these use)

```ts
import type { Locale } from "@/lib/i18n";
import type { RepRow } from "@/db/repQueries";
import { latinDigits } from "@/lib/digits";
import { isUuid } from "@/lib/ids";
import { FOLLOW_UP_DAYS } from "@/lib/repAccount";
import { generateTempPassword } from "@/lib/tempPassword";
import { tehranDatePlusDays } from "@/lib/persianCalendar";
import { setShownOnce } from "@/lib/shownOnce";
import { requireRep } from "@/lib/repSession";
import {
  createCustomerForRep,
  resetCustomerPasswordForRep,
  setFollowUpForRep,
  updateCustomerForRep,
  type CustomerInput,
} from "@/db/customerQueries";
import { addNoteForRep } from "@/db/noteQueries";

/** Every rep write: a current session, past any forced change, within the write limit. */
async function repForWrite(formData: FormData): Promise<{ rep: RepRow; locale: Locale }> {
  const locale = safeLocale(formData);
  const rep = await requireRep(locale);
  const limit = await consumeRateLimit("rep:write", RATE_LIMITS.repWrite, { accountId: rep.id });
  if (!limit.allowed) redirect(`/${locale}/rep?error=rate-limit`);
  return { rep, locale };
}

function postedCustomerId(formData: FormData): string | null {
  const id = String(formData.get("customerId") ?? "");
  return isUuid(id) ? id : null;
}

function parseCustomerForm(
  formData: FormData,
): { input: CustomerInput } | { error: "incomplete" | "invalid" } {
  const company = boundedString(formData.get("company"), REQUEST_LIMITS.companyChars);
  const contactName = boundedString(formData.get("contactName"), REQUEST_LIMITS.contactNameChars);
  const phone = boundedString(formData.get("phone"), REQUEST_LIMITS.phoneChars);
  const email = boundedString(formData.get("email"), REQUEST_LIMITS.emailChars, { allowEmpty: true });
  const address = boundedString(formData.get("address"), REQUEST_LIMITS.addressChars, { allowEmpty: true });
  const city = boundedString(formData.get("city"), REQUEST_LIMITS.cityChars, { allowEmpty: true });
  if (!company || !contactName || !phone) return { error: "incomplete" };
  if (email === null || address === null || city === null) return { error: "invalid" };
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "invalid" };
  return {
    input: {
      company,
      contactName,
      // Stored with ASCII digits so search, IDs and tel: links agree.
      phone: latinDigits(phone),
      email: email === "" ? null : email.toLowerCase(),
      address,
      city,
    },
  };
}

export async function createCustomerAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const back = `/${locale}/rep/customers/new`;
  const parsed = parseCustomerForm(formData);
  if ("error" in parsed) redirect(`${back}?error=${parsed.error}`);
  const codeChoice = formData.get("codeChoice") === "random" ? "random" : "phone";

  const password = generateTempPassword();
  const result = await createCustomerForRep(rep.id, {
    ...parsed.input,
    codeChoice,
    passwordHash: await hashPassword(password),
    locale,
  });
  if (result.kind !== "created") redirect(`${back}?error=${result.kind}`);

  await setShownOnce({ kind: "customer", subjectId: result.id, login: result.customerCode, password });
  redirect(`/${locale}/rep/customers/${result.id}?ok=created`);
}

export async function updateCustomerAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/rep/customers`);
  const back = `/${locale}/rep/customers/${id}`;
  const parsed = parseCustomerForm(formData);
  if ("error" in parsed) redirect(`${back}?error=${parsed.error}`);
  const result = await updateCustomerForRep(rep.id, id, parsed.input);
  if (result === "not-found") redirect(`/${locale}/rep/customers`);
  redirect(result === "email-taken" ? `${back}?error=email-taken` : `${back}?ok=saved`);
}

export async function resetCustomerPasswordAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/rep/customers`);
  const password = generateTempPassword();
  const customer = await resetCustomerPasswordForRep(rep.id, id, await hashPassword(password));
  if (!customer) redirect(`/${locale}/rep/customers`);
  await setShownOnce({ kind: "customer", subjectId: customer.id, login: customer.customerCode, password });
  redirect(`/${locale}/rep/customers/${customer.id}?ok=password`);
}

export async function addCustomerNoteAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/rep/customers`);
  const body = boundedString(formData.get("body"), 2000);
  if (!body) redirect(`/${locale}/rep/customers/${id}?error=invalid#notes`);
  if (!(await addNoteForRep(rep.id, id, body))) redirect(`/${locale}/rep/customers`);
  redirect(`/${locale}/rep/customers/${id}?ok=note#notes`);
}

export async function setFollowUpAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/rep/customers`);
  const choice = String(formData.get("days") ?? "");
  const days = Number(choice);
  const date =
    choice === "clear"
      ? null
      : (FOLLOW_UP_DAYS as readonly number[]).includes(days)
        ? tehranDatePlusDays(days)
        : undefined;
  if (date === undefined) redirect(`/${locale}/rep/customers/${id}?error=invalid#follow-up`);
  if (!(await setFollowUpForRep(rep.id, id, date))) redirect(`/${locale}/rep/customers`);
  redirect(`/${locale}/rep/customers/${id}#follow-up`);
}
```

- [ ] **Step 2: Shared components**

`src/components/CustomerNotes.tsx` (server component): props `{ locale: Locale; notes: CustomerNote[]; action: (formData: FormData) => Promise<void>; hidden: Record<string, string>; disabled?: boolean }`. A `<section id="notes">` bordered like the settings sections: heading `t.customerNotes`, muted hint `t.customerNotesHint`; a form (`action={action}`, one hidden input per `hidden` entry, `<textarea name="body" rows={3} maxLength={2000} required>`, submit `t.addNote`; all `disabled={disabled}`); then either `t.noNotesYet` or an `<ol>` of notes, each `<p className="whitespace-pre-line">{body}</p>` and a muted line `{authorName ?? t.noteByAdmin} · {formatPersianDate(createdAt, locale)}`.

`src/components/FollowUpControl.tsx` (server component): props `{ locale; current: string | null; today: string; action; hidden: Record<string, string>; disabled?: boolean }`. A `<section id="follow-up">`: heading `t.followUp`; the current date via `formatPersianDay(current, locale)`, shown in `text-[var(--color-danger)] font-bold` followed by ` — {t.overdue}` when `current <= today` (ISO strings compare correctly), or `t.followUpNone`; one form whose submit buttons are `name="days"` with values from `FOLLOW_UP_DAYS` — labelled `t.followUpTomorrow` for 1, else `t.followUpIn.replace("{n}", formatInt(n, locale))` — plus `value="clear"` labelled `t.followUpClear` when a date is set.

- [ ] **Step 3: Pages**

Portal layout: append `{ href: `/${l}/rep/customers`, label: t.customers }` to `sections`.

`customers/page.tsx`: `const rep = await requireRep(l)`; `q` from `searchParams`; `listCustomersForRep(rep.id, q ?? "")`; `tehranToday()`. Heading `t.customers` with a `Link` button `t.newCustomer` → `/${l}/rep/customers/new`. A GET form: `<input name="q" type="search" defaultValue={q} placeholder={t.customerSearchPlaceholder}>` and `t.search`. `spec-table` columns: `t.customerId` (`tech`, `dir="ltr"`), `t.company` (link to `/${l}/rep/customers/${id}`), `t.contactName`, `t.phone` (`tech`, `dir="ltr"`), `t.lastOrder` (`formatPersianDate` or —), `t.nextFollowUp` (`formatPersianDay`, danger colour when `<= today`, or —). Empty: `t.noCustomersYet`.

`customers/new/page.tsx`: shell like the admin settings sections; heading `t.newCustomer`; error banner mapping `incomplete` → `t.required`, `invalid` → `t.invalidInput`, `code-taken` → `t.customerCodeTaken`, `email-taken` → `t.customerEmailTaken`, `no-phone-code` → `t.customerPhoneTooShort`, `rate-limit` → `t.rateLimited`. Form `action={createCustomerAction}`, hidden `locale`, fields `company`*, `contactName`*, `phone`* (`type="tel"`, `dir="ltr"`), `email` (optional), `city` (optional), `address` (optional, full width); a fieldset `t.customerCodeChoice` with radios `codeChoice=phone` (default, `t.customerCodeFromPhone`) and `codeChoice=random` (`t.customerCodeRandom`); submit `t.createCustomer`.

`customers/[id]/page.tsx`: `id` passes `isUuid` → `getCustomerForRep(rep.id, id)` → `notFound()` when null. Parallel reads: `listNotes(id)`, `listOrdersForUser(id)` (existing, `accountQueries.ts`), `siteOrigin()`, `getFxRate()`, and `readShownOnce("customer", id)` when `ok` is `created` or `password`. Renders:
1. Heading: company, then `t.customerId` `<span className="tech" dir="ltr">{customerCode}</span>`, then a pill `repEarnsCommission ? t.commissionOn : t.commissionOff`.
2. `ShownOnceCredential` when present: heading `t.tempPasswordOnce`, `loginLabel={t.customerId}`, message `t.customerCredentialsMessage` with `{url}` = `${origin}/${l}/account/signin`, `{login}`, `{password}`.
3. Banners: `ok=saved` → `t.customerSaved`, `ok=note` → `t.noteAdded`, `error=invalid` → `t.invalidInput`, `error=incomplete` → `t.required`, `error=email-taken` → `t.customerEmailTaken`.
4. `FollowUpControl` (`action={setFollowUpAction}`, `hidden={{ locale: l, customerId: id }}`, `today={tehranToday()}`).
5. `CustomerNotes` (`action={addCustomerNoteAction}`, same hidden).
6. Section `t.customerOrders`: the orders as a list — ref (`tech`), `OrderStatusPill`, `formatPersianDate(createdAt)`, total via `formatPrice(totalCents, "IRR", l, fxRateToRial ?? liveRate)`.
7. Section `t.details`: the customer form prefilled (`action={updateCustomerAction}`, hidden `customerId`), submit `t.save`.
8. Section `t.password`: `ConfirmSubmit` titled `t.confirmIssueTempPassword` posting `resetCustomerPasswordAction`, label `t.issueTempPassword`.

Home page: add a section `t.followUpsDue` listing `listFollowUpsDue(rep.id, tehranToday())` — company link, ID, date (danger when overdue) — or `t.followUpsNoneDue`.

- [ ] **Step 4: Dictionary** — Task 10 keys, both languages.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

Browser (signed in as the Task 5 rep, in Persian and English): create a customer with phone `۰۹۱۲۳۳۳۴۴۵۵` → ID `3334455` and the temporary password show once, Share offers the message; create another with the same phone → `t.customerCodeTaken`; switch to Random → created with a different ID. Add a note; set follow-up "Tomorrow" → the date shows in Persian calendar; set 1 day on a second customer, then in `psql` backdate it (`UPDATE users SET next_follow_up_on = current_date - 1 WHERE customer_code = '…'`) → home lists it as overdue. Search by ID, by `3344`, by company.

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/rep" src/components/CustomerNotes.tsx src/components/FollowUpControl.tsx src/lib/i18n.ts
git commit -m "feat: let reps create and manage customers with notes and follow-ups"
```

---

### Task 11: Admin — Customers

**Files:**
- Create: `src/app/[locale]/admin/(panel)/customers/actions.ts`, `…/customers/page.tsx`, `…/customers/[id]/page.tsx`
- Modify: `src/app/[locale]/admin/(panel)/layout.tsx` (Customers tab)
- Modify: `src/lib/i18n.ts` (Appendix A, Task 11)

**Interfaces:**
- Consumes: Tasks 5, 8, 9, 10 (`CustomerNotes`, `FollowUpControl`).
- Produces: admin actions `assignCustomerAction`, `resetCustomerPasswordAdminAction`, `addCustomerNoteAdminAction`, `setFollowUpAdminAction`.

- [ ] **Step 1: Actions** — `customers/actions.ts`

```ts
"use server";

import { redirect } from "next/navigation";
import { assertAdminWrite } from "@/lib/admin";
import { safeLocale } from "@/lib/i18n";
import { boundedString } from "@/lib/requestLimits";
import { hashPassword } from "@/lib/password";
import { generateTempPassword } from "@/lib/tempPassword";
import { isUuid } from "@/lib/ids";
import { FOLLOW_UP_DAYS } from "@/lib/repAccount";
import { tehranDatePlusDays } from "@/lib/persianCalendar";
import { setShownOnce } from "@/lib/shownOnce";
import {
  assignCustomer,
  resetCustomerPasswordAdmin,
  setFollowUpAdmin,
} from "@/db/customerQueries";
import { addNoteAdmin } from "@/db/noteQueries";

function postedCustomerId(formData: FormData): string | null {
  const id = String(formData.get("customerId") ?? "");
  return isUuid(id) ? id : null;
}

/**
 * Changing a customer's rep, and whether that rep earns commission on them.
 * The checkbox arrives as "on" or not at all, so its absence is a deliberate
 * "off" — the form always renders it with the current value.
 */
export async function assignCustomerAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/admin/customers`);
  const raw = String(formData.get("repId") ?? "");
  const repId = raw === "" ? null : raw;
  if (repId !== null && !isUuid(repId)) redirect(`/${locale}/admin/customers/${id}?error=rep`);
  const earns = formData.get("earnsCommission") === "on";
  const result = await assignCustomer(id, repId, earns);
  if (result === "not-found") redirect(`/${locale}/admin/customers`);
  redirect(`/${locale}/admin/customers/${id}?${result === "bad-rep" ? "error=rep" : "ok=assigned"}`);
}

export async function resetCustomerPasswordAdminAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/admin/customers`);
  const password = generateTempPassword();
  const customer = await resetCustomerPasswordAdmin(id, await hashPassword(password));
  if (!customer) redirect(`/${locale}/admin/customers`);
  await setShownOnce({ kind: "customer", subjectId: customer.id, login: customer.customerCode, password });
  redirect(`/${locale}/admin/customers/${customer.id}?ok=password`);
}

export async function addCustomerNoteAdminAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/admin/customers`);
  const body = boundedString(formData.get("body"), 2000);
  if (!body) redirect(`/${locale}/admin/customers/${id}?error=invalid#notes`);
  await addNoteAdmin(id, body);
  redirect(`/${locale}/admin/customers/${id}?ok=note#notes`);
}

export async function setFollowUpAdminAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/admin/customers`);
  const choice = String(formData.get("days") ?? "");
  const days = Number(choice);
  const date =
    choice === "clear"
      ? null
      : (FOLLOW_UP_DAYS as readonly number[]).includes(days)
        ? tehranDatePlusDays(days)
        : undefined;
  if (date === undefined) redirect(`/${locale}/admin/customers/${id}?error=invalid#follow-up`);
  await setFollowUpAdmin(id, date);
  redirect(`/${locale}/admin/customers/${id}#follow-up`);
}
```

- [ ] **Step 2: Pages**

Layout: append `{ href: `/${l}/admin/customers`, label: t.customers }` after Sales reps. On the rep admin page (Task 5), under the heading, add a link `t.customers` → `/${l}/admin/customers?rep=${id}`, so a rep's customers are one click from the rep.

`customers/page.tsx`: `searchParams` `q`, `rep` (`"all"` default, `"none"`, or a uuid), `page` (integer ≥ 1, default 1). `const PAGE_SIZE = 50;` Reads `listCustomersAdmin({ search: q ?? "", rep: filter, page, pageSize: PAGE_SIZE })` and `listReps()` (for the filter list, inactive ones labelled with `t.repStatusInactive`). A GET filter form (search box, rep `<select>`: `t.allReps`, `t.noRep`, each rep; submit `t.filter`). `spec-table`: ID, company (link to `/${l}/admin/customers/${id}`), contact, phone, email, rep (`repName` or —), commission (`t.commissionShortOn` / `t.commissionShortOff`), origin label (below), created (`formatPersianDate`). Pagination links `t.pagePrevious` / `t.pageNext` preserving `q` and `rep`, shown only when there is a previous/next page (`page * PAGE_SIZE < total`).

Origin label helper (in the page file): `self` → `t.originSelf`; `rep` → `t.originRep.replace("{name}", originRepName ?? "—")`; `referral` → `t.originReferral.replace("{name}", originRepName ?? "—")`.

`customers/[id]/page.tsx`: `isUuid` → `getCustomerAdmin(id)` → `notFound()`. Reads `listActiveReps()`, `listNotes(id)`, `listOrdersForUser(id)`, `getFxRate()`, `siteOrigin()`, and `readShownOnce("customer", id)` when `ok=password`. Renders: heading (company, ID, origin label); the credential block (message `t.customerCredentialsMessage`, sign-in URL as in Task 10); banners `ok=assigned` → `t.assignmentSaved`, `ok=note` → `t.noteAdded`, `error=rep` → `t.repBadDestination`, `error=invalid` → `t.invalidInput`; section `t.assignRep` — form `action={assignCustomerAction}` with `<select name="repId">` (active reps + `<option value="">{t.noRep}</option>`, current selected; if the current rep is inactive, include it as a disabled selected option so the form never silently shows a different rep), a checkbox `name="earnsCommission"` `defaultChecked={repEarnsCommission}` labelled `t.repEarnsCommission` with hint `t.repEarnsCommissionHint`, submit `t.save`; read-only contact details (company, contact, phone, email, city, address); `FollowUpControl` and `CustomerNotes` with the admin actions; the orders list as in Task 10; the password section with `ConfirmSubmit` → `resetCustomerPasswordAdminAction`. All inputs `disabled={DEMO_MODE}`.

- [ ] **Step 3: Dictionary** — Task 11 keys, both languages.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

Browser: the Task 6 self-signed-up customer lists as "Signed up alone", no rep, commission off. Assign them to the Task 5 rep with commission left off → the rep now sees them; tick commission → saved. Filter "No rep" and by rep. Reset their password → shown once → sign in as them with it → forced to `/fa/account/password` (this is Task 7's deferred browser check) → set a new one → account page.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/admin/(panel)" src/lib/i18n.ts
git commit -m "feat: let the admin assign customers to reps and switch their commission"
```

---

### Task 12: Referral link, "your sales rep", address on the profile

**Files:**
- Create: `src/lib/referral.ts`
- Create: `src/app/[locale]/r/[code]/route.ts`
- Modify: `src/db/userQueries.ts` (`updateProfile` + address/city; `getRepContactForUser`)
- Modify: `src/app/[locale]/account/actions.ts` (`signUpAction` referral; `updateProfileAction` address/city)
- Modify: `src/app/[locale]/account/page.tsx` (rep card; profile fields)
- Modify: `src/app/[locale]/rep/(portal)/page.tsx` (referral link)
- Modify: `src/lib/i18n.ts` (Appendix A, Task 12)

**Interfaces:**
- Consumes: Task 4 (`getActiveRepByReferralCode`), Task 1 (`isReferralCode`), Task 5 (`ShareButton`, `siteOrigin`), Task 6 (`createUser` with `origin`/`repId`).
- Produces: `REFERRAL_COOKIE`, `REFERRAL_TTL_SECONDS`, `readReferralCode(): Promise<string | null>`, `clearReferralCookie()`; `getRepContactForUser(userId): Promise<{ name: string; phone: string } | null>`; `updateProfile` input gains `address`, `city`.

- [ ] **Step 1: `src/lib/referral.ts`**

```ts
import "server-only";
import { cookies } from "next/headers";
import { isReferralCode } from "./repAccount";

export const REFERRAL_COOKIE = "isupply_ref";
export const REFERRAL_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * The code only, unsigned. Forging it can do no more than the rep's own link
 * does — put a new sign-up with that rep — and the rep is re-checked as active
 * when the account is created.
 */
export async function readReferralCode(): Promise<string | null> {
  const value = (await cookies()).get(REFERRAL_COOKIE)?.value ?? "";
  return isReferralCode(value) ? value : null;
}

export async function clearReferralCookie(): Promise<void> {
  (await cookies()).delete(REFERRAL_COOKIE);
}
```

- [ ] **Step 2: `src/app/[locale]/r/[code]/route.ts`**

Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` first.

```ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { defaultLocale, isLocale } from "@/lib/i18n";
import { isReferralCode } from "@/lib/repAccount";
import { getActiveRepByReferralCode } from "@/db/repQueries";
import { REFERRAL_COOKIE, REFERRAL_TTL_SECONDS } from "@/lib/referral";

// The same ceiling every API route carries since the 2026-08-15 incident.
export const maxDuration = 60;

/**
 * A rep's marketing link. Opening it remembers the rep for 30 days and lands
 * on the catalog; whoever signs up within that time becomes the rep's
 * customer. The latest link opened wins. An unknown or deactivated rep's code
 * is ignored rather than remembered.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ locale: string; code: string }> },
) {
  const { locale, code } = await params;
  const target = isLocale(locale) ? locale : defaultLocale;
  const normalized = code.toUpperCase();
  if (isReferralCode(normalized) && (await getActiveRepByReferralCode(normalized))) {
    (await cookies()).set(REFERRAL_COOKIE, normalized, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: REFERRAL_TTL_SECONDS,
    });
  }
  redirect(`/${target}`);
}
```

- [ ] **Step 3: Sign-up and profile**

`userQueries.ts`:

```ts
/** The customer's rep, for "Your sales rep" — only while that rep is active. */
export async function getRepContactForUser(
  userId: string,
): Promise<{ name: string; phone: string } | null> {
  const [row] = await sql<{ name: string; phone: string }[]>`
    SELECT r.name, r.phone
    FROM users u JOIN sales_reps r ON r.id = u.rep_id AND r.active
    WHERE u.id = ${userId}
  `;
  return row ?? null;
}
```

and extend `updateProfile`'s input and `SET` list with `address` and `city`.

`signUpAction`, before `createUser`:

```ts
  // A referral link opened in the last 30 days makes this the rep's customer,
  // commission on — the rep brought them in. Re-checked here: a rep deactivated
  // since the link was opened credits nobody.
  const referralCode = await readReferralCode();
  const referrer = referralCode ? await getActiveRepByReferralCode(referralCode) : null;
```

pass `origin: referrer ? "referral" : "self", repId: referrer?.id ?? null`, and after a successful create `if (referralCode) await clearReferralCookie();`.

`updateProfileAction`: read `address` (`REQUEST_LIMITS.addressChars`) and `city` (`REQUEST_LIMITS.cityChars`) with `allowEmpty: true`, include them in the null check and in `updateProfile`.

`account/page.tsx`: read `getRepContactForUser(user.id)` alongside the orders. When present, a bordered box above the orders: `t.yourSalesRep`: name, and the phone as `<a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="tech" dir="ltr">`. Add `address` and `city` fields to the profile form after phone, prefilled from `user`.

Rep home: a section `t.referralLink` with the link `${await siteOrigin()}/${l}/r/${rep.referralCode}` (`tech`, `dir="ltr"`, `break-all`), hint `t.referralHint`, and `ShareButton` with text `t.referralMessage.replace("{url}", link)`.

- [ ] **Step 4: Dictionary** — Task 12 keys, both languages.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db:reps`
Expected: clean.

```bash
curl -s -o /dev/null -D - http://localhost:3200/fa/r/ABCDEF | grep -i -e "^location" -e "^set-cookie"
```

Expected with a code that belongs to no rep: a `location: /fa` line and **no** `set-cookie: isupply_ref`. With the Task 5 rep's code (shown on the rep home): `location: /fa` **and** `set-cookie: isupply_ref=…`. If the valid code redirects without the cookie, return the redirect explicitly instead of throwing one — `const response = NextResponse.redirect(new URL(`/${target}`, request.url)); response.cookies.set(REFERRAL_COOKIE, normalized, {…same options…}); return response;` — and re-run the check.

Browser: open the rep's link in a private window, sign up → the account page shows "Your sales rep" with the rep's name; admin Customers lists them as "Referred by …" with commission on. Deactivate that rep (moving customers to no rep) and repeat with a fresh private window → the sign-up lands with no rep.

- [ ] **Step 6: Commit**

```bash
git add src/lib/referral.ts "src/app/[locale]/r" src/db/userQueries.ts "src/app/[locale]/account" "src/app/[locale]/rep" src/lib/i18n.ts
git commit -m "feat: credit sign-ups from a rep's link and show customers their rep"
```

- [ ] **Step 7: Phase 2 gate** — Appendix B "Full gate". Fix anything red before Phase 3.

---

# Phase 3 — Orders and the pay link

### Task 13: Lock the rep and rate onto each order

**Files:**
- Modify: `src/db/orderSubmissionQueries.ts`
- Modify: `src/app/actions.ts` (pass `placedByRepId: null`; handle `customer-moved`)
- Modify: `src/db/orderIntegrity.integration.test.ts` (its `SubmitOrderInput` literals gain `placedByRepId: null`)
- Test: `src/db/salesReps.integration.test.ts`

**Interfaces:**
- Consumes: the Task 3 columns.
- Produces: `SubmitOrderInput.placedByRepId: string | null`; `SubmitOrderResult` gains `{ kind: "customer-moved" }`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { submitOrderFromCartInTransaction } from "./orderSubmissionQueries";
import { quoteCartFingerprint } from "@/lib/quoteSubmission";

async function cartWithOneLine(tx: Tx): Promise<{ cartId: string; fingerprint: string }> {
  const suffix = randomUUID();
  const [category] = await tx<{ id: number }[]>`
    INSERT INTO categories (slug, path, name_en, name_fa)
    VALUES (${`rep-${suffix}`}, ${`rep-${suffix}`}, 'Rep test', 'آزمایش') RETURNING id`;
  const [family] = await tx<{ id: number }[]>`
    INSERT INTO product_families (slug, category_id, name_en, name_fa)
    VALUES (${`rep-family-${suffix}`}, ${category.id}, 'Rep family', 'خانواده') RETURNING id`;
  const [product] = await tx<{ id: number }[]>`
    INSERT INTO products (part_number, family_id, specs, price_cents,
                          inventory_available, inventory_on_hold, inventory_sold)
    VALUES (${`REP-${suffix}`}, ${family.id}, '{}'::jsonb, 1000, 100, 0, 0) RETURNING id`;
  const [cart] = await tx<{ id: string }[]>`INSERT INTO carts DEFAULT VALUES RETURNING id`;
  await tx`INSERT INTO cart_items (cart_id, product_id, qty) VALUES (${cart.id}, ${product.id}, 2)`;
  return {
    cartId: cart.id,
    fingerprint: quoteCartFingerprint([{ productId: product.id, qty: 2, unitPriceCents: 1000 }]),
  };
}

async function place(tx: Tx, userId: string | null, placedByRepId: string | null) {
  const { cartId, fingerprint } = await cartWithOneLine(tx);
  return submitOrderFromCartInTransaction(tx, {
    cartId,
    cartFingerprint: fingerprint,
    submissionKey: randomUUID(),
    locale: "en",
    currency: "USD",
    userId,
    placedByRepId,
    contact: { company: "C", contactName: "N", email: "", phone: "1", poNumber: "", address: "", city: "", country: "", notes: "" },
  });
}

async function stampOf(tx: Tx, ref: string) {
  const [row] = await tx<{ repId: string | null; rateBp: number | null; placedByRep: boolean }[]>`
    SELECT rep_id AS "repId", commission_rate_bp AS "rateBp", placed_by_rep AS "placedByRep"
    FROM orders WHERE ref = ${ref}`;
  return row;
}

function created(result: Awaited<ReturnType<typeof place>>): string {
  if (result.kind !== "created") throw new Error(`expected an order, got ${result.kind}`);
  return result.ref;
}

test("the customer's rep, rate and eligibility are locked onto an order when it is placed", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const rep = await insertRep(tx, { rateBp: 250 });
    const other = await insertRep(tx, { rateBp: 900 });
    const eligible = await insertCustomer(tx, { repId: rep, earns: true });
    const ineligible = await insertCustomer(tx, { repId: rep, earns: false });

    const own = created(await place(tx, eligible, null));
    assert.deepEqual(await stampOf(tx, own), { repId: rep, rateBp: 250, placedByRep: false });

    const noCommission = created(await place(tx, ineligible, null));
    assert.deepEqual(await stampOf(tx, noCommission), { repId: rep, rateBp: 0, placedByRep: false });

    const byRep = created(await place(tx, eligible, rep));
    assert.deepEqual(await stampOf(tx, byRep), { repId: rep, rateBp: 250, placedByRep: true });

    // Later changes cannot reach back into a placed order.
    await tx`UPDATE sales_reps SET commission_rate_bp = 900 WHERE id = ${rep}`;
    await tx`UPDATE users SET rep_id = ${other} WHERE id = ${eligible}`;
    assert.deepEqual(await stampOf(tx, own), { repId: rep, rateBp: 250, placedByRep: false });

    // The first rep may no longer order for a customer who is now someone else's.
    assert.deepEqual(await place(tx, eligible, rep), { kind: "customer-moved" });

    // A locked-out rep is credited with nothing.
    await tx`UPDATE sales_reps SET active = false WHERE id = ${other}`;
    const afterLockout = created(await place(tx, eligible, null));
    assert.deepEqual(await stampOf(tx, afterLockout), { repId: null, rateBp: null, placedByRep: false });

    const guest = created(await place(tx, null, null));
    assert.deepEqual(await stampOf(tx, guest), { repId: null, rateBp: null, placedByRep: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db:reps`
Expected: FAIL — `placedByRepId` is not in `SubmitOrderInput` (type error) or the stamp is all null.

- [ ] **Step 3: Implement in `orderSubmissionQueries.ts`**

Add `placedByRepId: string | null;` to `SubmitOrderInput` (doc comment: "The rep building this order for `userId`, or null when the customer or a guest places it."), add `| { kind: "customer-moved" }` to `SubmitOrderResult`, and add above `submitOrderFromCartInTransaction`:

```ts
/**
 * Who is credited, and at what rate — decided once, here, as the order is
 * written. The customer's rep and that rep's rate are read inside the same
 * transaction and copied onto the order, so moving the customer or changing
 * the rate later cannot reach back into it. A customer who is not
 * commission-eligible still credits their rep, at 0: the sale counts toward
 * the rep's numbers, just not their commission. An inactive rep is credited
 * with nothing — deactivation moves customers, so this is only the window
 * between the two, and a locked-out rep earning from it would be wrong.
 */
async function creditFor(tx: Tx, userId: string): Promise<{ repId: string; rateBp: number } | null> {
  const [row] = await tx<
    { repId: string | null; active: boolean | null; rateBp: number | null; earns: boolean }[]
  >`
    SELECT u.rep_id AS "repId", r.active, r.commission_rate_bp AS "rateBp",
           u.rep_earns_commission AS earns
    FROM users u LEFT JOIN sales_reps r ON r.id = u.rep_id
    WHERE u.id = ${userId}
  `;
  if (!row || row.repId === null || !row.active) return null;
  return { repId: row.repId, rateBp: row.earns ? (row.rateBp ?? 0) : 0 };
}
```

In the transaction body, right after `totalCents` is computed and before the insert loop:

```ts
  const credit = input.userId ? await creditFor(tx, input.userId) : null;
  // A rep may only order for their own customer. Checked again here, inside
  // the transaction, because the customer can be moved between the checkout
  // page rendering and this write.
  if (input.placedByRepId !== null && credit?.repId !== input.placedByRepId) {
    return { kind: "customer-moved" };
  }
```

In the `INSERT INTO orders`, add the columns `rep_id, commission_rate_bp, placed_by_rep` and the values `${credit?.repId ?? null}, ${credit ? credit.rateBp : null}, ${input.placedByRepId !== null}`.

`src/app/actions.ts`: pass `placedByRepId: null` to `submitOrderFromCart`, and after the call add `if (result.kind === "customer-moved") redirect(`/${locale}/quote?error=invalid`);` (unreachable for customers and guests; it keeps the result handling exhaustive). Add `placedByRepId: null` to each `SubmitOrderInput` in `orderIntegrity.integration.test.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:db && npx tsc --noEmit`
Expected: PASS (the orders suite too) / clean.

- [ ] **Step 5: Commit**

```bash
git add src/db/orderSubmissionQueries.ts src/app/actions.ts src/db/orderIntegrity.integration.test.ts src/db/salesReps.integration.test.ts
git commit -m "feat: lock the customer's rep and commission rate onto each order when placed"
```

---

### Task 14: Bank account details

**Files:**
- Create: `src/lib/bankDetails.ts`, `src/lib/bankDetails.test.ts`
- Create: `src/lib/bankSettings.ts`
- Create: `src/components/BankDetailsForm.tsx`
- Modify: `src/app/[locale]/admin/actions.ts` (`saveBankDetailsAction`)
- Modify: `src/app/[locale]/admin/(panel)/settings/page.tsx` (new section)
- Modify: `src/lib/i18n.ts` (Appendix A, Task 14)

**Interfaces:**
- Consumes: `latinDigits`.
- Produces: `type BankFields = { nameEn; nameFa; holderEn; holderFa; card; sheba; account; noteEn; noteFa }` (all `string`), `BANK_SETTING_KEYS`, `EMPTY_BANK_FIELDS`, `normalizeCard`, `isValidCard`, `normalizeSheba`, `isValidSheba`, `normalizeAccount`, `isValidAccount`, `type BankProblem = "card" | "sheba" | "account" | "length"`, `validateBankFields(raw)`, `type BankDetails = { name; holder; card; sheba; account; note }`, `resolveBankDetails(values, locale): BankDetails | null`, `groupInFours(value)`; `getBankFields(): Promise<BankFields>`, `getBankDetails(locale): Promise<BankDetails | null>`, `saveBankFields(values)`; `BankDetailsForm`.

- [ ] **Step 1: Write the failing test** — `src/lib/bankDetails.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_BANK_FIELDS,
  groupInFours,
  isValidCard,
  isValidSheba,
  normalizeCard,
  normalizeSheba,
  resolveBankDetails,
  validateBankFields,
} from "./bankDetails";

test("a card number is sixteen digits passing the Luhn check, typed any way", () => {
  assert.equal(isValidCard("6037991234567893"), true);
  assert.equal(isValidCard("6037991234567894"), false);
  assert.equal(isValidCard("603799123456789"), false);
  assert.equal(normalizeCard("۶۰۳۷-۹۹۱۲-۳۴۵۶-۷۸۹۳"), "6037991234567893");
  assert.equal(normalizeCard("6037 9912 3456 7893"), "6037991234567893");
});

test("a Sheba number is IR and 24 digits passing the mod-97 check", () => {
  assert.equal(isValidSheba("IR820540102680020817909002"), true);
  assert.equal(isValidSheba("IR062960000000100324200001"), true);
  assert.equal(isValidSheba("IR820540102680020817909003"), false);
  assert.equal(normalizeSheba("ir82 0540 1026 8002 0817 9090 02"), "IR820540102680020817909002");
  assert.equal(normalizeSheba("820540102680020817909002"), "IR820540102680020817909002");
  assert.equal(normalizeSheba("۸۲۰۵۴۰۱۰۲۶۸۰۰۲۰۸۱۷۹۰۹۰۰۲"), "IR820540102680020817909002");
});

test("every field is optional, and one bad number refuses the whole save", () => {
  assert.deepEqual(validateBankFields(EMPTY_BANK_FIELDS), { ok: true, values: EMPTY_BANK_FIELDS });
  const typed = {
    ...EMPTY_BANK_FIELDS,
    nameFa: " بانک ملت ",
    card: "6037 9912 3456 7893",
    sheba: "IR82 0540 1026 8002 0817 9090 02",
    account: "0102-0304-05",
  };
  const ok = validateBankFields(typed);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.values.nameFa, "بانک ملت");
    assert.equal(ok.values.card, "6037991234567893");
    assert.equal(ok.values.sheba, "IR820540102680020817909002");
    assert.equal(ok.values.account, "0102-0304-05");
  }
  assert.deepEqual(validateBankFields({ ...typed, card: "6037991234567894", account: "12" }), {
    ok: false,
    problems: ["card", "account"],
  });
  assert.deepEqual(validateBankFields({ ...typed, noteEn: "x".repeat(1001) }), {
    ok: false,
    problems: ["length"],
  });
});

test("each language falls back to the other, and an empty section is nothing at all", () => {
  const values = { ...EMPTY_BANK_FIELDS, nameEn: "Bank Mellat", holderFa: "شرکت تمکس", card: "6037991234567893" };
  assert.deepEqual(resolveBankDetails(values, "fa"), {
    name: "Bank Mellat", holder: "شرکت تمکس", card: "6037991234567893", sheba: "", account: "", note: "",
  });
  assert.equal(resolveBankDetails(values, "en")?.holder, "شرکت تمکس");
  assert.equal(resolveBankDetails(EMPTY_BANK_FIELDS, "fa"), null);
});

test("numbers are grouped in fours for reading only", () => {
  assert.equal(groupInFours("6037991234567893"), "6037 9912 3456 7893");
  assert.equal(groupInFours("IR820540102680020817909002"), "IR82 0540 1026 8002 0817 9090 02");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './bankDetails'`.

- [ ] **Step 3: Implement** — `src/lib/bankDetails.ts`

```ts
import { latinDigits } from "./digits";
import type { Locale } from "./i18n";

/**
 * The business's bank account, shown to customers paying by transfer.
 *
 * Pure, so the admin form can run exactly the checks the server runs, before
 * anything is sent. Card and Sheba numbers carry check digits; checking them
 * is what stops a one-digit typo from being printed on every pay page and
 * sending customers' money nowhere.
 */
export type BankFields = {
  nameEn: string;
  nameFa: string;
  holderEn: string;
  holderFa: string;
  card: string;
  sheba: string;
  account: string;
  noteEn: string;
  noteFa: string;
};

export const BANK_SETTING_KEYS: Record<keyof BankFields, string> = {
  nameEn: "bank_name_en",
  nameFa: "bank_name_fa",
  holderEn: "bank_holder_en",
  holderFa: "bank_holder_fa",
  card: "bank_card",
  sheba: "bank_sheba",
  account: "bank_account",
  noteEn: "bank_note_en",
  noteFa: "bank_note_fa",
};

export const EMPTY_BANK_FIELDS: BankFields = {
  nameEn: "", nameFa: "", holderEn: "", holderFa: "",
  card: "", sheba: "", account: "", noteEn: "", noteFa: "",
};

const TEXT_MAX = 200;
const NOTE_MAX = 1000;

export function normalizeCard(raw: string): string {
  return latinDigits(raw).replace(/[\s-]/g, "");
}

/** Sixteen digits passing the Luhn check every Shetab card number carries. */
export function isValidCard(value: string): boolean {
  if (!/^\d{16}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let digit = Number(value[15 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Upper-case, no spaces; 24 bare digits get their IR prefix. */
export function normalizeSheba(raw: string): string {
  const value = latinDigits(raw).replace(/[\s-]/g, "").toUpperCase();
  return /^\d{24}$/.test(value) ? `IR${value}` : value;
}

/** IR and 24 digits passing the ISO 13616 mod-97 check (I = 18, R = 27). */
export function isValidSheba(value: string): boolean {
  if (!/^IR\d{24}$/.test(value)) return false;
  const rearranged = `${value.slice(4)}1827${value.slice(2, 4)}`;
  let remainder = 0;
  for (const ch of rearranged) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

export function normalizeAccount(raw: string): string {
  return latinDigits(raw).replace(/\s+/g, "");
}

/** Banks format account numbers differently; 4–30 digits with - or . between. */
export function isValidAccount(value: string): boolean {
  const digits = value.replace(/[.-]/g, "");
  return /^[0-9][0-9.-]*[0-9]$/.test(value) && digits.length >= 4 && digits.length <= 30;
}

export type BankProblem = "card" | "sheba" | "account" | "length";

export function validateBankFields(
  raw: BankFields,
): { ok: true; values: BankFields } | { ok: false; problems: BankProblem[] } {
  const values: BankFields = {
    nameEn: raw.nameEn.trim(),
    nameFa: raw.nameFa.trim(),
    holderEn: raw.holderEn.trim(),
    holderFa: raw.holderFa.trim(),
    card: normalizeCard(raw.card),
    sheba: normalizeSheba(raw.sheba),
    account: normalizeAccount(raw.account),
    noteEn: raw.noteEn.trim(),
    noteFa: raw.noteFa.trim(),
  };
  const problems: BankProblem[] = [];
  if (values.card && !isValidCard(values.card)) problems.push("card");
  if (values.sheba && !isValidSheba(values.sheba)) problems.push("sheba");
  if (values.account && !isValidAccount(values.account)) problems.push("account");
  const texts = [values.nameEn, values.nameFa, values.holderEn, values.holderFa];
  if (
    texts.some((text) => text.length > TEXT_MAX) ||
    values.noteEn.length > NOTE_MAX ||
    values.noteFa.length > NOTE_MAX
  ) {
    problems.push("length");
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, values };
}

export type BankDetails = {
  name: string;
  holder: string;
  card: string;
  sheba: string;
  account: string;
  note: string;
};

/** The reader's language first, the other one when theirs is blank; null when nothing is filled. */
export function resolveBankDetails(values: BankFields, locale: Locale): BankDetails | null {
  const text = (en: string, fa: string) => (locale === "fa" ? fa || en : en || fa);
  const details: BankDetails = {
    name: text(values.nameEn, values.nameFa),
    holder: text(values.holderEn, values.holderFa),
    card: values.card,
    sheba: values.sheba,
    account: values.account,
    note: text(values.noteEn, values.noteFa),
  };
  return Object.values(details).some((value) => value !== "") ? details : null;
}

/** Display only; stored numbers have no spaces. */
export function groupInFours(value: string): string {
  return value.replace(/(.{4})(?=.)/g, "$1 ");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Storage, action, admin section**

`src/lib/bankSettings.ts`:

```ts
import "server-only";
import { cache } from "react";
import { sql } from "@/db";
import {
  BANK_SETTING_KEYS,
  EMPTY_BANK_FIELDS,
  resolveBankDetails,
  type BankDetails,
  type BankFields,
} from "./bankDetails";
import type { Locale } from "./i18n";

const ENTRIES = Object.entries(BANK_SETTING_KEYS) as [keyof BankFields, string][];

/** One read per request, shared by everything on the page that shows them. */
export const getBankFields = cache(async (): Promise<BankFields> => {
  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM app_settings WHERE key = ANY(${ENTRIES.map(([, key]) => key)})
  `;
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const fields: BankFields = { ...EMPTY_BANK_FIELDS };
  for (const [field, key] of ENTRIES) fields[field] = byKey.get(key) ?? "";
  return fields;
});

export async function getBankDetails(locale: Locale): Promise<BankDetails | null> {
  return resolveBankDetails(await getBankFields(), locale);
}

/**
 * All nine fields in one transaction, already validated by the caller — the
 * same all-or-nothing rule as the site contact pair. No revalidation: bank
 * details render only on dynamic pages.
 */
export async function saveBankFields(values: BankFields): Promise<void> {
  await sql.begin(async (tx) => {
    for (const [field, key] of ENTRIES) {
      await tx`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (${key}, ${values[field]}, now())
        ON CONFLICT (key) DO UPDATE SET value = ${values[field]}, updated_at = now()
      `;
    }
  });
}
```

`src/components/BankDetailsForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { validateBankFields, type BankFields, type BankProblem } from "@/lib/bankDetails";

const FIELDS: { field: keyof BankFields; input: string; kind: "text" | "number" | "note"; dir: "ltr" | "rtl" }[] = [
  { field: "nameFa", input: "bankNameFa", kind: "text", dir: "rtl" },
  { field: "nameEn", input: "bankNameEn", kind: "text", dir: "ltr" },
  { field: "holderFa", input: "bankHolderFa", kind: "text", dir: "rtl" },
  { field: "holderEn", input: "bankHolderEn", kind: "text", dir: "ltr" },
  { field: "card", input: "bankCard", kind: "number", dir: "ltr" },
  { field: "sheba", input: "bankSheba", kind: "number", dir: "ltr" },
  { field: "account", input: "bankAccount", kind: "number", dir: "ltr" },
  { field: "noteFa", input: "bankNoteFa", kind: "note", dir: "rtl" },
  { field: "noteEn", input: "bankNoteEn", kind: "note", dir: "ltr" },
];

export type BankFormLabels = {
  fields: Record<keyof BankFields, string>;
  problems: Record<BankProblem, string>;
  save: string;
};

/**
 * Checked in the browser with the very function the server runs again, so a
 * mistyped card number is caught while the other eight fields are still on
 * screen instead of after a round trip that clears them. Invalid input never
 * leaves the page; valid input goes to the Server Action, which re-validates.
 */
export function BankDetailsForm({
  action,
  locale,
  initial,
  labels,
  disabled,
}: {
  action: (formData: FormData) => Promise<void>;
  locale: string;
  initial: BankFields;
  labels: BankFormLabels;
  disabled: boolean;
}) {
  const [problems, setProblems] = useState<BankProblem[]>([]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const values = Object.fromEntries(
      FIELDS.map(({ field, input }) => [field, String(data.get(input) ?? "")]),
    ) as BankFields;
    const result = validateBankFields(values);
    if (!result.ok) {
      event.preventDefault();
      setProblems(result.problems);
    } else {
      setProblems([]);
    }
  }

  return (
    <form action={action} onSubmit={onSubmit} className="grid max-w-[680px] gap-3 sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      {problems.length > 0 && (
        <ul
          role="alert"
          className="border border-[var(--color-danger)] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)] sm:col-span-2"
        >
          {problems.map((problem) => (
            <li key={problem}>{labels.problems[problem]}</li>
          ))}
        </ul>
      )}
      {FIELDS.map(({ field, input, kind, dir }) => (
        <label
          key={field}
          className={`grid gap-0.5 text-[11px] font-semibold ${kind === "note" ? "sm:col-span-2" : ""}`}
        >
          {labels.fields[field]}
          {kind === "note" ? (
            <textarea name={input} rows={3} maxLength={1000} dir={dir} defaultValue={initial[field]} disabled={disabled} />
          ) : (
            <input
              type="text"
              name={input}
              dir={dir}
              defaultValue={initial[field]}
              maxLength={kind === "number" ? 40 : 200}
              inputMode={field === "card" || field === "account" ? "numeric" : undefined}
              autoComplete="off"
              disabled={disabled}
            />
          )}
        </label>
      ))}
      <button type="submit" className="btn-small justify-self-start sm:col-span-2" disabled={disabled}>
        {labels.save}
      </button>
    </form>
  );
}
```

`admin/actions.ts`:

```ts
export async function saveBankDetailsAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const read = (name: string) => String(formData.get(name) ?? "");
  const result = validateBankFields({
    nameEn: read("bankNameEn"),
    nameFa: read("bankNameFa"),
    holderEn: read("bankHolderEn"),
    holderFa: read("bankHolderFa"),
    card: read("bankCard"),
    sheba: read("bankSheba"),
    account: read("bankAccount"),
    noteEn: read("bankNoteEn"),
    noteFa: read("bankNoteFa"),
  });
  if (!result.ok) redirect(`/${locale}/admin/settings?bank=${result.problems.join(",")}#bank`);
  await saveBankFields(result.values);
  // No revalidation: bank details render only on dynamic pages (pay links and
  // a customer's own order page), never on a cached one.
  redirect(`/${locale}/admin/settings?bank=saved#bank`);
}
```

Settings page: read `getBankFields()` with the other settings; `bank` joins the `searchParams` type. Add a section `id="bank"` (same bordered shell as Site contact) before the currency section: heading `t.bankSection`, hint `t.bankSectionHint`, `SuccessBanner` for `bank === "saved"` (`t.bankSaved`), an `ErrorBanner` listing each problem in `bank.split(",")` mapped `card` → `t.bankInvalidCard`, `sheba` → `t.bankInvalidSheba`, `account` → `t.bankInvalidAccount`, `length` → `t.bankTooLong` (the no-JavaScript path), then `<BankDetailsForm action={saveBankDetailsAction} locale={l} initial={bankFields} disabled={DEMO_MODE} labels={{ fields: { nameEn: t.bankNameEn, nameFa: t.bankNameFa, holderEn: t.bankHolderEn, holderFa: t.bankHolderFa, card: t.bankCard, sheba: t.bankSheba, account: t.bankAccount, noteEn: t.bankNoteEn, noteFa: t.bankNoteFa }, problems: { card: t.bankInvalidCard, sheba: t.bankInvalidSheba, account: t.bankInvalidAccount, length: t.bankTooLong }, save: t.bankSave }} />`.

- [ ] **Step 6: Dictionary** — Task 14 keys, both languages.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

Browser: Settings → bank section empty. Type card `6037991234567894` → the form refuses in place with `t.bankInvalidCard`, the other typed fields still filled. Fix to `…893`, Sheba `IR820540102680020817909002`, names in both languages → saved; reload shows the stored values (card without spaces). Leave the section filled for Task 15.

- [ ] **Step 8: Commit**

```bash
git add src/lib/bankDetails.ts src/lib/bankDetails.test.ts src/lib/bankSettings.ts src/components/BankDetailsForm.tsx "src/app/[locale]/admin" src/lib/i18n.ts
git commit -m "feat: add a checked bank account section to admin settings"
```

---

### Task 15: Order view, pay page and invoice by key

**Files:**
- Create: `src/lib/payToken.ts`, `src/lib/payToken.test.ts`
- Modify: `src/db/accountQueries.ts` (`DETAIL_COLS`, `listOrderItems`, `getOrderByPayToken`)
- Modify: `src/db/invoiceQueries.ts` (`InvoiceOrder.payToken`)
- Create: `src/components/OrderView.tsx`, `src/components/BankDetailsPanel.tsx`
- Modify: `src/app/[locale]/account/orders/[ref]/page.tsx` (use `OrderView`; bank details)
- Create: `src/app/[locale]/pay/[token]/page.tsx`
- Modify: `src/app/[locale]/invoice/[ref]/page.tsx` (key access; links keep the key)
- Modify: `src/lib/i18n.ts` (Appendix A, Task 15)
- Test: `src/db/salesReps.integration.test.ts`

**Interfaces:**
- Consumes: Task 3 `pay_token`, Task 14 `getBankDetails`, `groupInFours`, Task 5 `ShareButton`.
- Produces: `isPayToken(value)`, `payTokensEqual(a, b)`; `listOrderItems(orderId): Promise<AccountOrderItem[]>`, `type PayOrderDetail = AccountOrderDetail & { company: string; payToken: string }`, `getOrderByPayToken(token)`; `OrderView({ locale, order, items, currency, rate, actions?, bank?, estimate? })`, `type OrderViewOrder`; `BankDetailsPanel({ locale, bank })`.

- [ ] **Step 1: Failing tests**

`src/lib/payToken.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPayToken, payTokensEqual } from "./payToken";

const TOKEN = "a".repeat(32) + "0123456789abcdef".repeat(2);

test("only the exact shape the database stores is a pay token", () => {
  assert.equal(isPayToken(TOKEN), true);
  assert.equal(isPayToken(TOKEN.toUpperCase()), false);
  assert.equal(isPayToken(TOKEN.slice(1)), false);
  assert.equal(isPayToken(`${TOKEN}0`), false);
  assert.equal(isPayToken("../../etc/passwd"), false);
});

test("comparison is exact and never throws on different lengths", () => {
  assert.equal(payTokensEqual(TOKEN, TOKEN), true);
  assert.equal(payTokensEqual(TOKEN, `${TOKEN.slice(0, -1)}0`), false);
  assert.equal(payTokensEqual(TOKEN, "short"), false);
});
```

Integration (append):

```ts
import { getOrderByPayToken } from "./accountQueries";

test("a pay token opens its own order and nothing else", async () => {
  assertLocalDatabase();
  const [order] = await sql<{ id: number; payToken: string }[]>`
    INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Pay Co', 'N', '', 1000, 1000)
    RETURNING id, pay_token AS "payToken"`;
  try {
    assert.equal((await getOrderByPayToken(order.payToken))?.order.company, "Pay Co");
    assert.equal(await getOrderByPayToken("0".repeat(64)), null);
  } finally {
    await sql`DELETE FROM orders WHERE id = ${order.id}`;
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test; npm run test:db:reps`
Expected: FAIL — missing `./payToken` and `getOrderByPayToken`.

- [ ] **Step 3: Implement**

`src/lib/payToken.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

/**
 * Mirrors `orders_pay_token_check`. Checked before any query, so a guessed or
 * mangled link costs a regular expression, not a database round trip.
 */
export function isPayToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function payTokensEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
```

`accountQueries.ts`: move the detail SELECT list of `getOrderForUser` into a module fragment `DETAIL_COLS` (prefix every column with `o.`), move its items query into `export async function listOrderItems(orderId: number): Promise<AccountOrderItem[]>`, rewrite `getOrderForUser` with both (behaviour unchanged), and add:

```ts
export type PayOrderDetail = AccountOrderDetail & { company: string; payToken: string };

/**
 * The private pay link's order. The token is the whole authority here —
 * whoever holds the link sees this one order, exactly as whoever holds an
 * emailed invoice PDF does.
 */
export async function getOrderByPayToken(
  token: string,
): Promise<{ order: PayOrderDetail; items: AccountOrderItem[] } | null> {
  const [order] = await sql<PayOrderDetail[]>`
    SELECT ${DETAIL_COLS}, o.company, o.pay_token AS "payToken"
    FROM orders o WHERE o.pay_token = ${token} LIMIT 1
  `;
  if (!order) return null;
  return { order, items: await listOrderItems(order.id) };
}
```

`invoiceQueries.ts`: add `payToken: string` to `InvoiceOrder` and `o.pay_token AS "payToken"` (match that file's alias style) to `getInvoiceByRef`'s select.

`src/components/OrderView.tsx` — the body of `account/orders/[ref]/page.tsx` from `<OrderTimeline …>` through the total, moved verbatim into a component, with three additions: an `actions` slot replacing the hard-coded Pay/View-invoice row, a bank panel after it, and an estimate note under the total.

```tsx
import type { ReactNode } from "react";
import { OrderTimeline } from "./OrderTimeline";
import { BankDetailsPanel } from "./BankDetailsPanel";
import type { AccountOrderItem } from "@/db/accountQueries";
import type { BankDetails } from "@/lib/bankDetails";
import type { OrderStatus } from "@/lib/orders";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt, formatPrice, type Currency } from "@/lib/money";

export type OrderViewOrder = {
  status: OrderStatus;
  createdAt: string;
  invoicedAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  courier: string;
  trackingNumber: string;
  totalCents: number;
};

/**
 * One order as its buyer sees it: timeline, what to do next, how to pay,
 * tracking, lines and total. Shared by the customer's order page, the private
 * pay page and the rep's order page, which differ only in the actions they
 * offer — so a fix to the table lands on all three.
 */
export function OrderView({
  locale,
  order,
  items,
  currency,
  rate,
  actions,
  bank,
  estimate = false,
}: {
  locale: Locale;
  order: OrderViewOrder;
  items: AccountOrderItem[];
  currency: Currency;
  rate: number;
  actions?: ReactNode;
  bank?: BankDetails | null;
  /** Before invoicing these are today's catalog prices, not an offer. */
  estimate?: boolean;
}) {
  const t = getDict(locale);
  return (
    <>
      <OrderTimeline
        locale={locale}
        status={order.status}
        stamps={{
          createdAt: order.createdAt,
          invoicedAt: order.invoicedAt,
          paidAt: order.paidAt,
          shippedAt: order.shippedAt,
          deliveredAt: order.deliveredAt,
        }}
      />
      {actions && <div className="mb-4 flex flex-wrap items-center gap-3">{actions}</div>}
      {bank && <BankDetailsPanel locale={locale} bank={bank} />}
      {/* …the courier/tracking <dl>, the spec-table of items and the total
          line, moved unchanged from account/orders/[ref]/page.tsx, reading
          `order`, `items`, `currency`, `rate`, `t` and `locale`… */}
      {estimate && (
        <p className="mt-1 text-end text-[11px] text-[var(--color-ink-muted)]">{t.priceEstimate}</p>
      )}
    </>
  );
}
```

(The comment in the middle marks where the existing markup goes; it is moved, not rewritten. `formatInt` and `formatPrice` are its existing imports.)

`src/components/BankDetailsPanel.tsx`:

```tsx
import { ShareButton } from "./ShareButton";
import { groupInFours, type BankDetails } from "@/lib/bankDetails";
import { getDict, type Locale } from "@/lib/i18n";

/**
 * Card-to-card and Sheba transfers are made from a banking app on the same
 * phone, so every number has a Copy control: typing 16 to 26 digits by hand
 * is where payments go astray. Numbers read left to right in Latin digits,
 * like part numbers, and are grouped in fours only here.
 */
export function BankDetailsPanel({ locale, bank }: { locale: Locale; bank: BankDetails }) {
  const t = getDict(locale);
  const rows: { label: string; value: string; copy?: string }[] = [];
  if (bank.name) rows.push({ label: t.bankName, value: bank.name });
  if (bank.holder) rows.push({ label: t.bankHolder, value: bank.holder });
  if (bank.card) rows.push({ label: t.bankCard, value: groupInFours(bank.card), copy: bank.card });
  if (bank.sheba) rows.push({ label: t.bankSheba, value: groupInFours(bank.sheba), copy: bank.sheba });
  if (bank.account) rows.push({ label: t.bankAccount, value: bank.account, copy: bank.account });

  return (
    <section aria-labelledby="bank-heading" className="mb-4 border border-[var(--color-rule)] p-3 text-[12px]">
      <h2 id="bank-heading" className="mb-2 text-[13px] font-bold">{t.payByTransfer}</h2>
      <dl className="grid gap-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-center gap-x-3">
            <dt className="font-bold">{row.label}</dt>
            <dd className={row.copy ? "tech" : undefined} dir={row.copy ? "ltr" : undefined}>{row.value}</dd>
            {row.copy && (
              <ShareButton text={row.copy} label={t.copy} copiedLabel={t.copied} copyOnly className="text-[11px] underline" />
            )}
          </div>
        ))}
      </dl>
      {bank.note &&
        bank.note.split(/\n{2,}/).map((paragraph, i) => (
          <p key={i} className="mt-2 whitespace-pre-line">{paragraph}</p>
        ))}
    </section>
  );
}
```

`account/orders/[ref]/page.tsx`: keep the heading block; replace the rest with `<OrderView locale={l} order={order} items={items} currency={currency} rate={rate} bank={order.status === "invoiced" ? await getBankDetails(l) : null} estimate={!invoiced} actions={…the existing Pay now and View invoice elements, unchanged…} />`.

`src/app/[locale]/pay/[token]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderByPayToken } from "@/db/accountQueries";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { getBankDetails } from "@/lib/bankSettings";
import { isPayToken } from "@/lib/payToken";
import { OrderView } from "@/components/OrderView";
import { OrderStatusPill } from "@/components/OrderStatusPill";
import { getDict, isLocale, type Locale } from "@/lib/i18n";
import { customerCurrencyFor } from "@/lib/money";
import type { OrderStatus } from "@/lib/orders";

/**
 * Kept out of search results, and the page sends no referrer: the Pay button
 * leaves for a bank's page, which would otherwise receive this URL — and the
 * URL is the key.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The private pay link. No sign-in: a customer opens it from a message on
 * their phone. It shows one order — the one whose token it carries — and what
 * to do next. Before the admin prices the order there is nothing to pay, so
 * no payment instructions are shown yet.
 */
export default async function PayPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  if (!isPayToken(token)) notFound();

  const found = await getOrderByPayToken(token);
  if (!found) notFound();
  const { order, items } = found;

  const [liveRate, displayMode, bank] = await Promise.all([
    getFxRate(),
    getPriceDisplayMode(),
    order.status === "invoiced" ? getBankDetails(l) : Promise.resolve(null),
  ]);
  const invoiced = order.invoiceNumber !== null;
  const message: Record<OrderStatus, string> = {
    received: t.payBeingPriced,
    invoiced: t.payAmountDue,
    preparing: t.payPaidThanks,
    shipped: t.payPaidThanks,
    delivered: t.payPaidThanks,
    cancelled: t.payCancelled,
  };

  return (
    <main className="mx-auto max-w-[820px] px-3 pt-3 pb-16">
      <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">{order.company}</h1>
        <span className="tech text-[13px]">{order.ref}</span>
        <OrderStatusPill locale={l} status={order.status} />
      </div>
      <p className="mb-3 text-[13px]">{message[order.status]}</p>
      <OrderView
        locale={l}
        order={order}
        items={items}
        currency={customerCurrencyFor(displayMode, l)}
        rate={order.fxRateToRial ?? liveRate}
        bank={bank}
        estimate={!invoiced}
        actions={
          order.status === "cancelled" ? null : (
            <>
              {order.status === "invoiced" && order.paymentUrl && (
                <a href={order.paymentUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
                  {t.payNow}
                </a>
              )}
              {invoiced && (
                <Link href={`/${l}/invoice/${order.ref}?key=${token}`} className="btn-small" prefetch={false}>
                  {t.viewInvoice}
                </Link>
              )}
            </>
          )
        }
      />
    </main>
  );
}
```

`invoice/[ref]/page.tsx`: `searchParams` gains `key?: string`. Replace the gate:

```ts
  const { cur, key } = await searchParams;
  // A pay link carries its order's key. Its shape is checked before any query,
  // like the signed-out refusal below, so junk costs nothing and says nothing.
  const payKey = typeof key === "string" && isPayToken(key) ? key : null;
  …
  if (!staff && !uid && !payKey) notFound();
  …
  const owner = uid !== null && order.userId !== null && order.userId === uid;
  const keyed = payKey !== null && payTokensEqual(payKey, order.payToken);
  // 404 rather than 403, as before: a key for another order confirms nothing.
  if (!staff && !owner && !keyed) notFound();
```

and build both switch links with a helper that keeps the key:

```ts
  const withKey = (query: Record<string, string>) => {
    const params = new URLSearchParams(query);
    if (keyed && payKey) params.set("key", payKey);
    const s = params.toString();
    return s ? `?${s}` : "";
  };
  const languageHref = `/${other}/invoice/${order.ref}${withKey(priceDisplayMode === "both" ? { cur: currency } : {})}`;
  // currency link: `/${l}/invoice/${order.ref}${withKey({ cur: otherCurrency })}`
```

- [ ] **Step 4: Run**

Run: `npm test && npm run test:db:reps && npx tsc --noEmit && npm run lint`
Expected: PASS / clean.

- [ ] **Step 5: Dictionary** — Task 15 keys, both languages.

- [ ] **Step 6: Verify in the browser**

With the bank section filled (Task 14): take any local order's token (`docker exec isupply-db psql -U isupply -d isupply -Atc "select ref, pay_token, status from orders order by created_at desc limit 3"`). Open `/fa/pay/<token>` signed out: a `received` order says `t.payBeingPriced`, shows the estimate note and **no** bank panel. Invoice it in admin with a payment link → the pay page shows Pay, the bank panel with copy buttons, and View invoice; the invoice opens signed out via the key and its language/currency links keep the key. `/fa/invoice/<another ref>?key=<this token>` → 404. `/fa/pay/<token uppercased>` → 404. A signed-in customer's own order page still renders exactly as before, plus the bank panel while invoiced.

- [ ] **Step 7: Commit**

```bash
git add src/lib/payToken.ts src/lib/payToken.test.ts src/db/accountQueries.ts src/db/invoiceQueries.ts src/components/OrderView.tsx src/components/BankDetailsPanel.tsx "src/app/[locale]/account/orders" "src/app/[locale]/pay" "src/app/[locale]/invoice" src/lib/i18n.ts src/db/salesReps.integration.test.ts
git commit -m "feat: give every order a private pay link with payment details"
```

---

### Task 16: Rep checkout — ordering for a customer

**Files:**
- Create: `src/lib/repOrderContext.ts`
- Modify: `src/app/[locale]/rep/actions.ts` (`startOrderAction`)
- Modify: `src/app/actions.ts` (`parseContact`, rep branch, email optional when signed in)
- Create: `src/app/[locale]/quote/RepQuoteForm.tsx`
- Modify: `src/app/[locale]/quote/page.tsx` (rep branch; email optional when signed in)
- Modify: `src/app/[locale]/cart/page.tsx` (ordering-for banner; rial for reps; reorder notice)
- Modify: `src/app/[locale]/rep/(portal)/customers/[id]/page.tsx` (New order button)
- Modify: `src/lib/i18n.ts` (Appendix A, Task 16)

**Interfaces:**
- Consumes: Tasks 4, 9, 13.
- Produces: `setOrderingFor(customerId)`, `clearOrderingFor()`, `readOrderingFor(): Promise<string | null>`; `startOrderAction(formData)`; `RepQuoteForm`.

- [ ] **Step 1: `src/lib/repOrderContext.ts`**

```ts
import "server-only";
import { cookies } from "next/headers";
import { isUuid } from "./ids";

const COOKIE = "isupply_rep_for";

/**
 * Which customer a rep is ordering for, carried from their customer page
 * through the catalog to checkout. It holds only an id; every reader
 * re-checks that the customer is still the signed-in rep's, so a stale or
 * edited cookie selects nothing.
 */
export async function setOrderingFor(customerId: string): Promise<void> {
  (await cookies()).set(COOKIE, customerId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
}

export async function clearOrderingFor(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function readOrderingFor(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE)?.value ?? "";
  return isUuid(value) ? value : null;
}
```

- [ ] **Step 2: `startOrderAction`** (rep actions)

```ts
export async function startOrderAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const id = postedCustomerId(formData);
  const customer = id ? await getCustomerForRep(rep.id, id) : null;
  if (!customer) redirect(`/${locale}/rep/customers`);
  await setOrderingFor(customer.id);
  // Quick order first: reps usually know the part numbers. The catalog is one
  // click away in the masthead, and the choice survives either route.
  redirect(`/${locale}/quick-order`);
}
```

Customer page (Task 10's `customers/[id]`): add a form posting `startOrderAction` (hidden `locale`, `customerId`) with a primary button `t.newOrder`, next to the heading.

- [ ] **Step 3: `src/app/actions.ts`**

Replace the contact-parsing block of `submitQuoteAction` with a shared helper, add the rep branch, and keep everything else as it is:

```ts
type ContactResult = { contact: QuoteContact } | { error: "missing" | "invalid" };

/**
 * The checkout's contact block. Email is required only from a guest — it is
 * how they track the order. A signed-in customer's order sits on their
 * account, and a rep's customer may have no email at all.
 */
function parseContact(formData: FormData, emailRequired: boolean): ContactResult {
  const company = boundedString(formData.get("company"), REQUEST_LIMITS.companyChars);
  const contactName = boundedString(formData.get("contactName"), REQUEST_LIMITS.contactNameChars);
  const phone = boundedString(formData.get("phone"), REQUEST_LIMITS.phoneChars);
  const email = boundedString(formData.get("email"), REQUEST_LIMITS.emailChars, { allowEmpty: true });
  if (email === null) return { error: "invalid" };
  if (!company || !contactName || !phone || (emailRequired && email === "")) {
    return { error: "missing" };
  }
  const normalizedEmail = email.toLowerCase();
  if (normalizedEmail !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { error: "invalid" };
  }
  const optional = (name: string, maxChars: number) =>
    boundedString(formData.get(name), maxChars, { allowEmpty: true });
  const poNumber = optional("poNumber", REQUEST_LIMITS.poNumberChars);
  const address = optional("address", REQUEST_LIMITS.addressChars);
  const city = optional("city", REQUEST_LIMITS.cityChars);
  const country = optional("country", REQUEST_LIMITS.countryChars);
  const notes = optional("notes", REQUEST_LIMITS.notesChars);
  if (poNumber === null || address === null || city === null || country === null || notes === null) {
    return { error: "invalid" };
  }
  return {
    contact: { company, contactName, email: normalizedEmail, phone, poNumber, address, city, country, notes },
  };
}

/**
 * A rep placing an order for one of their customers: its own rate limit
 * (reps legitimately place many orders), the customer re-checked against the
 * session, the order in the customer's language, and the rep landing on the
 * order with its pay link rather than on the customer's confirmation page.
 */
async function submitForCustomer(rep: RepRow, locale: Locale, formData: FormData): Promise<void> {
  if (rep.mustChangePassword) redirect(`/${locale}/rep/password`);
  const limit = await consumeRateLimit("rep:order", RATE_LIMITS.repOrderSubmit, { accountId: rep.id });
  if (!limit.allowed) redirect(`/${locale}/quote?error=rate-limit`);

  const token = verifyQuoteSubmissionToken(
    boundedString(formData.get("submissionToken"), 2_000) ?? "",
    AUTH_SECRET,
  );
  const cartId = await getCartId();
  if (!cartId) redirect(`/${locale}/cart`);
  if (!token || token.cartId !== cartId) redirect(`/${locale}/quote?error=expired`);

  const customerId = String(formData.get("forCustomerId") ?? "");
  const customer = isUuid(customerId) ? await getCustomerForRep(rep.id, customerId) : null;
  if (!customer) redirect(`/${locale}/quote?error=customer`);
  const again = `/${locale}/quote?for=${customer.id}`;

  const parsed = parseContact(formData, false);
  if ("error" in parsed) redirect(`${again}&error=${parsed.error}`);

  const orderLocale: Locale = isLocale(customer.locale) ? customer.locale : locale;
  const result = await submitOrderFromCart({
    cartId,
    cartFingerprint: token.cartFingerprint,
    submissionKey: token.submissionKey,
    locale: orderLocale,
    currency: customerCurrencyFor(await getPriceDisplayMode(), orderLocale),
    userId: customer.id,
    placedByRepId: rep.id,
    contact: parsed.contact,
  });
  if (result.kind === "customer-moved") redirect(`/${locale}/quote?error=customer`);
  if (result.kind === "cart-changed") redirect(`${again}&error=cart-changed`);
  if (result.kind === "empty-cart" || result.kind === "missing-cart") redirect(`/${locale}/cart`);

  await clearOrderingFor();
  redirect(`/${locale}/rep/orders/${result.ref}?ok=created`);
}
```

At the top of `submitQuoteAction`, after `const locale = safeLocale(formData);`:

```ts
  // A signed-in rep orders for a customer; that path owns its own limit,
  // customer check and landing page.
  const rep = await currentRep();
  if (rep) return submitForCustomer(rep, locale, formData);
```

and in the customer path replace the removed parsing with `const parsed = parseContact(formData, userId === null); if ("error" in parsed) redirect(`/${locale}/quote?error=${parsed.error}`);`, passing `contact: parsed.contact`. New imports: `currentRep` (`@/lib/repSession`), `type RepRow` (`@/db/repQueries`), `getCustomerForRep` (`@/db/customerQueries`), `clearOrderingFor` (`@/lib/repOrderContext`), `isUuid` (`@/lib/ids`), `isLocale`, `type Locale` (`@/lib/i18n`).

- [ ] **Step 4: Checkout page**

`quote/page.tsx`: `searchParams` gains `for?: string`; add `currentRep()` to the `Promise.all`. After the fingerprint/token lines:

```tsx
  if (rep) {
    if (rep.mustChangePassword) redirect(`/${l}/rep/password`);
    const customers = await listCustomersForRep(rep.id, "");
    const wanted = (forParam && isUuid(forParam) ? forParam : null) ?? (await readOrderingFor());
    return (
      <RepQuoteForm
        locale={l}
        customers={customers}
        selected={customers.find((c) => c.id === wanted) ?? null}
        lines={lines}
        subtotal={subtotal}
        rate={rate}
        submissionToken={submissionToken}
        error={error}
      />
    );
  }
```

For signed-in customers, the email field is no longer `required` when `user` is set, and shows the `(optional)` marker (pass `optional={user ? t.optional : undefined}` and `required={!user}` to `Field`).

`RepQuoteForm.tsx` (server component, same visual shell and `Field` markup as the quote page — copy its `Field` helper into this file rather than exporting it from the page): heading `t.repOrderForCustomer`; error box mapping the quote page's errors plus `customer` → `t.customerNotYours`; a **GET** form (`method="get"`) with `<select name="for">` (first option `t.chooseCustomer` with value "", then `company — customerCode` per customer, `defaultValue={selected?.id ?? ""}`) and a submit `t.useCustomer`. When `customers` is empty: `t.repNoCustomersYet` with a link to `/${locale}/rep/customers/new`. When `selected`: the POST form `action={submitQuoteAction}` with hidden `locale`, `submissionToken` and `forCustomerId={selected.id}`, fields prefilled from `selected` (company, contactName, phone, email optional, poNumber = `defaultPoNumber`, city, address; country and notes empty), and the aside summary exactly as the quote page renders it but with money always `formatPrice(…, "IRR", locale, rate)`; submit via `QuoteSubmitButton` labelled `t.repPlaceOrder`.

`cart/page.tsx`: read `currentRep()`; when present, `currency` is `"IRR"`, and above the list a bordered line: the selected customer (`readOrderingFor()` then `getCustomerForRep`) as `t.orderingForName.replace("{name}", `${c.company} (${c.customerCode})`)`, otherwise `t.orderingForChoose`, with a `Link` `t.change` to `/${l}/rep/customers`. Also, when `searchParams.skipped` is present (Task 17), a warning box `t.reorderSkipped` followed by the part numbers (split on `,`, each in `tech`).

- [ ] **Step 5: Dictionary** — Task 16 keys, both languages.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run test:db`
Expected: clean; the orders integration suite still passes (guest path unchanged).

Browser as the rep: customer page → New order → quick order → paste a seeded part number → cart shows "Ordering for …" and rial → checkout prefilled with the customer, email empty and optional → Place order → lands on `/fa/rep/orders/ORD-…` (404 until Task 17 — confirm the URL, then continue). As a guest in another window: checkout still insists on an email. As a signed-in customer: checkout accepts an empty email.

- [ ] **Step 7: Commit**

```bash
git add src/lib/repOrderContext.ts "src/app/[locale]/rep" src/app/actions.ts "src/app/[locale]/quote" "src/app/[locale]/cart/page.tsx" src/lib/i18n.ts
git commit -m "feat: let reps check out for a customer, with the email optional when signed in"
```

---

### Task 17: Rep orders and reorder

**Files:**
- Create: `src/db/repOrderQueries.ts`
- Modify: `src/app/[locale]/rep/actions.ts` (`reorderAction`)
- Create: `src/app/[locale]/rep/(portal)/orders/page.tsx`, `…/orders/[ref]/page.tsx`
- Modify: `src/app/[locale]/rep/(portal)/layout.tsx` (Orders tab), `…/customers/[id]/page.tsx` (order links)
- Modify: `src/lib/i18n.ts` (Appendix A, Task 17)
- Test: `src/db/salesReps.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 15 (`listOrderItems`, `OrderView`), 16 (`setOrderingFor`), `addLines`/`CartCapacityError` (`src/lib/cart.ts`).
- Produces: `type RepOrderRow`, `listOrdersForRep(repId, status | null)`, `type RepOrderDetail`, `getOrderForRep(repId, ref)`, `getReorderLines(repId, ref)`; `reorderAction(formData)`.

- [ ] **Step 1: Failing test** (append)

```ts
import { getOrderForRep, getReorderLines, listOrdersForRep } from "./repOrderQueries";

test("a rep sees their customers' orders and their own credit, and nothing else", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const repIds: string[] = [];
  const userIds: string[] = [];
  const orderIds: number[] = [];
  try {
    const a = await createRep({ username: `oa-${suffix}`, name: "A", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    const b = await createRep({ username: `ob-${suffix}`, name: "B", phone: "", email: "", commissionRateBp: 250, passwordHash: "x" });
    if (a === "username-taken" || b === "username-taken") throw new Error("username clash");
    repIds.push(a.id, b.id);
    const [customer] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, customer_code, rep_id, origin, origin_rep_id, rep_earns_commission)
      VALUES (${`${suffix}@example.invalid`}, 'x', ${randomCustomerCode()}, ${a.id}, 'rep', ${a.id}, true)
      RETURNING id`;
    userIds.push(customer.id);
    const [order] = await sql<{ id: number; ref: string }[]>`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                          user_id, rep_id, commission_rate_bp, placed_by_rep)
      VALUES (${`ORD-${suffix.slice(0, 6).toUpperCase()}`}, 'Co', 'N', '', 1000, 1000,
              ${customer.id}, ${a.id}, 250, true)
      RETURNING id, ref`;
    orderIds.push(order.id);
    await sql`
      INSERT INTO order_items (order_id, product_id, part_number, family_name, qty,
                               unit_price_cents, requested_unit_price_cents)
      VALUES (${order.id}, NULL, 'GONE-1', 'F', 2, 500, 500)`;

    assert.equal((await listOrdersForRep(a.id, null)).some((o) => o.ref === order.ref), true);
    assert.equal((await listOrdersForRep(b.id, null)).some((o) => o.ref === order.ref), false);
    assert.equal(await getOrderForRep(b.id, order.ref), null);
    assert.equal(await getReorderLines(b.id, order.ref), null);

    const mine = await getOrderForRep(a.id, order.ref);
    assert.equal(mine?.order.creditedToMe, true);
    assert.equal(mine?.order.commissionRateBp, 250);
    assert.deepEqual(await getReorderLines(a.id, order.ref), {
      customerId: customer.id,
      lines: [],
      missing: ["GONE-1"],
    });

    // Moved to rep B: A keeps sight of the order it is credited with, but can
    // no longer reorder for the customer; B sees it without the credit.
    await sql`UPDATE users SET rep_id = ${b.id} WHERE id = ${customer.id}`;
    assert.equal((await getOrderForRep(a.id, order.ref))?.order.customerIsMine, false);
    assert.equal((await getReorderLines(a.id, order.ref))?.customerId, null);
    assert.equal((await getOrderForRep(b.id, order.ref))?.order.creditedToMe, false);
  } finally {
    if (orderIds.length) await sql`DELETE FROM orders WHERE id = ANY(${orderIds})`;
    await cleanupReps(repIds, userIds);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db:reps`
Expected: FAIL — `Cannot find module './repOrderQueries'`.

- [ ] **Step 3: Implement** — `src/db/repOrderQueries.ts`

```ts
import "server-only";
import { sql } from "./index";
import type { OrderStatus } from "@/lib/orders";
import { listOrderItems, type AccountOrderDetail, type AccountOrderItem } from "./accountQueries";

export type RepOrderRow = {
  id: number;
  ref: string;
  status: OrderStatus;
  createdAt: string;
  totalCents: number;
  fxRateToRial: number | null;
  invoiceNumber: string | null;
  payToken: string;
  company: string;
  customerId: string | null;
  customerCode: string | null;
  placedByRep: boolean;
};

export type RepOrderDetail = AccountOrderDetail &
  RepOrderRow & {
    commissionRateBp: number | null;
    /** Credited to this rep when it was placed. */
    creditedToMe: boolean;
    /** The customer is this rep's now — what Reorder requires. */
    customerIsMine: boolean;
  };

/**
 * What a rep may see: orders credited to them, and orders of customers who are
 * theirs now. A union of two indexed lookups rather than an OR across a join,
 * which would read every order once the table is large.
 */
function visibleTo(repId: string) {
  return sql`o.id IN (
    SELECT id FROM orders WHERE rep_id = ${repId}
    UNION
    SELECT o2.id FROM orders o2 JOIN users u2 ON u2.id = o2.user_id WHERE u2.rep_id = ${repId}
  )`;
}

const ROW_COLS = sql`o.id, o.ref, o.status, o.created_at AS "createdAt",
  o.total_cents AS "totalCents", o.fx_rate_to_rial AS "fxRateToRial",
  o.invoice_number AS "invoiceNumber", o.pay_token AS "payToken",
  COALESCE(u.company, o.company) AS company, o.user_id AS "customerId",
  u.customer_code AS "customerCode", o.placed_by_rep AS "placedByRep"`;

export async function listOrdersForRep(repId: string, status: OrderStatus | null): Promise<RepOrderRow[]> {
  return sql<RepOrderRow[]>`
    SELECT ${ROW_COLS}
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE ${visibleTo(repId)} AND ${status ? sql`o.status = ${status}` : sql`TRUE`}
    ORDER BY o.created_at DESC
    LIMIT 300
  `;
}

export async function getOrderForRep(
  repId: string,
  ref: string,
): Promise<{ order: RepOrderDetail; items: AccountOrderItem[] } | null> {
  const [order] = await sql<RepOrderDetail[]>`
    SELECT ${ROW_COLS},
           o.payment_url AS "paymentUrl", o.courier, o.tracking_number AS "trackingNumber",
           o.po_number AS "poNumber", o.invoiced_at AS "invoicedAt", o.paid_at AS "paidAt",
           o.shipped_at AS "shippedAt", o.delivered_at AS "deliveredAt",
           (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS "itemCount",
           o.commission_rate_bp AS "commissionRateBp",
           (o.rep_id = ${repId}) IS TRUE AS "creditedToMe",
           (u.rep_id = ${repId}) IS TRUE AS "customerIsMine"
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.ref = ${ref} AND ${visibleTo(repId)}
    LIMIT 1
  `;
  if (!order) return null;
  return { order, items: await listOrderItems(order.id) };
}

/**
 * The lines to copy into a new cart. `customerId` is set only while the
 * customer is still this rep's — reordering for someone else's customer is the
 * one thing visibility does not grant. Lines whose product no longer exists
 * come back as part numbers, for the rep to see what was left out.
 */
export async function getReorderLines(
  repId: string,
  ref: string,
): Promise<{ customerId: string | null; lines: { productId: number; qty: number }[]; missing: string[] } | null> {
  const [order] = await sql<{ id: number; customerId: string | null }[]>`
    SELECT o.id, CASE WHEN u.rep_id = ${repId} THEN u.id END AS "customerId"
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.ref = ${ref} AND ${visibleTo(repId)}
  `;
  if (!order) return null;
  const items = await sql<{ productId: number | null; partNumber: string; qty: number }[]>`
    SELECT p.id AS "productId", i.part_number AS "partNumber", i.qty
    FROM order_items i LEFT JOIN products p ON p.id = i.product_id
    WHERE i.order_id = ${order.id}
    ORDER BY i.id
  `;
  return {
    customerId: order.customerId,
    lines: items.flatMap((i) => (i.productId === null ? [] : [{ productId: i.productId, qty: i.qty }])),
    missing: items.filter((i) => i.productId === null).map((i) => i.partNumber),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:db:reps`
Expected: PASS.

- [ ] **Step 5: Action and pages**

`reorderAction`:

```ts
export async function reorderAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const ref = boundedString(formData.get("ref"), 20) ?? "";
  const found = await getReorderLines(rep.id, ref);
  if (!found) redirect(`/${locale}/rep/orders`);
  if (!found.customerId) redirect(`/${locale}/rep/orders/${ref}?error=not-yours`);
  try {
    await addLines(found.lines);
  } catch (error) {
    if (error instanceof CartCapacityError) redirect(`/${locale}/rep/orders/${ref}?error=cart-full`);
    throw error;
  }
  await setOrderingFor(found.customerId);
  // Part numbers are not sensitive, and the list is short: carried in the URL
  // so the cart can say what was left out.
  const skipped = found.missing.slice(0, 20).join(",");
  redirect(`/${locale}/cart${skipped ? `?skipped=${encodeURIComponent(skipped)}` : ""}`);
}
```

Layout: append `{ href: `/${l}/rep/orders`, label: t.ordersTab }`.

`orders/page.tsx`: `status` from `searchParams` (only if `isOrderStatus`); `listOrdersForRep(rep.id, status)`, `getFxRate()`, `siteOrigin()`. Filter links `t.filterAll` plus one per `ORDER_STATUSES` (labels from the existing status dictionary keys `OrderStatusPill` uses). A list: ref (link to `/${l}/rep/orders/${ref}`), company + ID, `OrderStatusPill`, `formatPersianDate(createdAt)`, total `formatPrice(totalCents, "IRR", l, fxRateToRial ?? liveRate)`, and a `ShareButton` whose text is `t.payLinkMessage` with `{company}`, `{ref}`, `{url}` = `${origin}/${l}/pay/${payToken}`.

`orders/[ref]/page.tsx`: `getOrderForRep(rep.id, ref)` → `notFound()`. Header: ref, pill, customer (link to `/${l}/rep/customers/${customerId}` when `customerIsMine`). Banners: `ok=created` → `t.repOrderCreated`; `error=not-yours` → `t.reorderNotYours`; `error=cart-full` → `t.reorderCartFull`. When `creditedToMe`: `commissionRateBp > 0 ? t.commissionLocked.replace("{percent}", commissionPercentLabel(bp, l)) : t.commissionNone`. The pay link box: `<code data-testid="pay-link" dir="ltr" className="tech break-all">{payUrl}</code>` with `ShareButton` (`t.sharePayLink`, message as above) and a `Link` `t.openPayPage` (`target="_blank"`). Then `OrderView` with `currency="IRR"`, `rate={fxRateToRial ?? liveRate}`, `estimate={invoiceNumber === null}`, and `actions` = the Reorder form (`reorderAction`, hidden `locale`, `ref`) when `customerIsMine`.

Customer page orders list: each ref links to `/${l}/rep/orders/${ref}`.

- [ ] **Step 6: Dictionary** — Task 17 keys, both languages.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

Browser: the Task 16 order page now renders with the pay link, `Share`, commission line and Reorder. Reorder → cart holds the same items, "Ordering for" shows the customer. Delete one product from the order's family in admin products, reorder again → the cart's skipped notice lists its part number. Orders list filters by status.

- [ ] **Step 8: Commit**

```bash
git add src/db/repOrderQueries.ts "src/app/[locale]/rep" src/lib/i18n.ts src/db/salesReps.integration.test.ts
git commit -m "feat: show reps their customers' orders with pay links and reorder"
```

---

### Task 18: Admin order queue — rep, customer ID, pay link

**Files:**
- Modify: `src/app/[locale]/admin/(panel)/orders/page.tsx`
- Modify: `src/lib/i18n.ts` (Appendix A, Task 18)

**Interfaces:**
- Consumes: Task 3 columns, `commissionPercentLabel`, `ShareButton`, `siteOrigin`.
- Produces: nothing new.

- [ ] **Step 1: Query**

In the orders query add `LEFT JOIN sales_reps r ON r.id = q.rep_id LEFT JOIN users u ON u.id = q.user_id` after `FROM orders q`, and select `r.name AS "repName", q.placed_by_rep AS "placedByRep", q.commission_rate_bp AS "commissionRateBp", u.customer_code AS "customerCode", q.pay_token AS "payToken"`. Add those five fields to `OrderRow` (`repName: string | null`, `placedByRep: boolean`, `commissionRateBp: number | null`, `customerCode: string | null`, `payToken: string`). Read `siteOrigin()` in the page's first `Promise.all`.

- [ ] **Step 2: Render**

In each `<summary>`, after the company: the customer ID (`tech`, `dir="ltr"`) when present, and a small bordered pill `t.repLabel`: `repName` (+ ` · {t.placedByRep}` when `placedByRep`) when present. In the details `<dl>`: a row `t.repLabel` with `repName` and `commissionRateBp > 0 ? commissionPercentLabel(commissionRateBp, l) : t.commissionNone`; a row `t.payLink` with a `ShareButton copyOnly` (label `t.copy`) whose text is `${origin}/${order.locale === "fa" ? "fa" : "en"}/pay/${payToken}` — the customer's language, like the rest of the row.

- [ ] **Step 3: Dictionary** — Task 18 keys.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean. Browser: the rep-placed order shows the rep pill and "placed by rep"; a customer's self-placed order from Task 11's assigned customer shows the rep with "no commission" when their commission was off; Copy pay link copies a URL that opens the pay page.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/admin/(panel)/orders/page.tsx" src/lib/i18n.ts
git commit -m "feat: show rep, customer ID and pay link in the admin order queue"
```

---

### Task 19: End-to-end — the rep's order loop

**Files:**
- Create: `e2e/sales-rep-flow.spec.ts`

**Interfaces:**
- Consumes: every page above; `data-testid` `shown-once-login`, `shown-once-password`, `pay-link`.
- Produces: the regression test for the whole loop.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";

const locales: Locale[] = ["en", "fa"];
const familySlug = "oil-resistant-buna-n-o-rings";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "ci-admin-password";

async function adminSignIn(page: Page, locale: Locale): Promise<void> {
  const t = getDict(locale);
  await page.goto(`/${locale}/admin/login`);
  await page.getByLabel(t.password).fill(adminPassword);
  await page.getByRole("button", { name: t.signIn }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin/orders`));
}

for (const locale of locales) {
  test(`${locale}: a rep creates a customer, orders for them and shares a working pay link`, async (
    { browser, isMobile },
    testInfo,
  ) => {
    test.skip(isMobile, "The desktop project covers the rep flow.");
    const t = getDict(locale);
    const stamp = `${locale}${testInfo.workerIndex}${Date.now()}`;
    const username = `e2e.${stamp}`.slice(0, 32);
    const company = `E2E Rep Co ${stamp}`;

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await adminSignIn(admin, locale);

    // The admin creates the rep; the temporary password is shown once.
    await admin.goto(`/${locale}/admin/reps`);
    await admin.locator('input[name="name"]').fill("E2E Rep");
    await admin.locator('input[name="username"]').fill(username);
    await admin.locator('input[name="commission"]').fill("2.5");
    await admin.getByRole("button", { name: t.createRep }).click();
    const tempPassword = (await admin.getByTestId("shown-once-password").innerText()).trim();

    // The rep must replace it, and a weak password is refused.
    const repContext = await browser.newContext();
    const rep = await repContext.newPage();
    await rep.goto(`/${locale}/rep/signin`);
    await rep.locator('input[name="username"]').fill(username);
    await rep.locator('input[name="password"]').fill(tempPassword);
    await rep.getByRole("button", { name: t.signInTitle }).click();
    await expect(rep).toHaveURL(new RegExp(`/${locale}/rep/password`));
    for (const [value, next] of [["password1", "policy"], ["Str0ng!Pass", "home"]] as const) {
      await rep.locator('input[name="newPassword"]').fill(value);
      await rep.locator('input[name="passwordAgain"]').fill(value);
      await rep.getByRole("button", { name: t.savePassword }).click();
      if (next === "policy") await expect(rep.getByText(t.repPasswordPolicy)).toBeVisible();
    }
    await expect(rep).toHaveURL(new RegExp(`/${locale}/rep(\\?|$)`));

    // A new customer's ID is the phone's last seven digits.
    const phone = `0912${String(Date.now()).slice(-7)}`;
    await rep.goto(`/${locale}/rep/customers/new`);
    await rep.locator('input[name="company"]').fill(company);
    await rep.locator('input[name="contactName"]').fill("E2E Buyer");
    await rep.locator('input[name="phone"]').fill(phone);
    await rep.getByRole("button", { name: t.createCustomer }).click();
    await expect(rep.getByTestId("shown-once-login")).toHaveText(phone.slice(-7));

    // New order → one catalog line → checkout already filled in for them.
    await rep.getByRole("button", { name: t.newOrder }).click();
    await rep.goto(`/${locale}/f/${familySlug}`);
    await rep.locator("label.row-expand").first().click();
    await rep.getByRole("spinbutton", { name: new RegExp(t.qty) }).first().fill("1");
    const add = rep.getByRole("button", { name: t.addToOrder }).first();
    await add.click();
    await expect(add).toHaveText("✓");
    await rep.goto(`/${locale}/quote`);
    await expect(rep.locator('input[name="company"]')).toHaveValue(company);
    await rep.getByRole("button", { name: t.repPlaceOrder }).click();
    await expect(rep).toHaveURL(new RegExp(`/${locale}/rep/orders/ORD-`));
    const payLink = (await rep.getByTestId("pay-link").innerText()).trim();

    // Signed out, the link works: first "being priced", then payable.
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto(payLink);
    await expect(visitor.getByText(t.payBeingPriced)).toBeVisible();

    await admin.goto(`/${locale}/admin/orders`);
    const order = admin.locator("details").filter({ hasText: company }).first();
    await order.locator("summary").click();
    await expect(order.getByText("E2E Rep").first()).toBeVisible();
    await order.locator('input[name="paymentUrl"]').fill("https://example.com/pay/e2e");
    await order.getByRole("button", { name: t.issueInvoice }).click();
    await admin
      .getByRole("dialog", { name: t.confirmIssueInvoice })
      .getByRole("button", { name: t.confirmContinue })
      .click();
    await expect(admin).toHaveURL(/ok=invoiced/);

    await visitor.reload();
    await expect(visitor.getByRole("link", { name: t.payNow })).toBeVisible();

    await Promise.all([adminContext.close(), repContext.close(), visitorContext.close()]);
  });
}
```

- [ ] **Step 2: Run it**

Follow Appendix B "Production server for e2e", then:

Run: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npx playwright test e2e/sales-rep-flow.spec.ts`
Expected: 2 passed (EN, FA desktop), 2 skipped (mobile).

- [ ] **Step 3: Commit**

```bash
git add e2e/sales-rep-flow.spec.ts
git commit -m "test: cover the rep's customer, order and pay-link loop end to end"
```

- [ ] **Step 4: Phase 3 gate** — Appendix B "Full gate", including the whole e2e suite.

---

# Phase 4 — Money

### Task 20: Rep sales summary (pure)

**Files:**
- Create: `src/lib/repStats.ts`, `src/lib/repStats.test.ts`

**Interfaces:**
- Consumes: `PersianYearMonth` (Task 8).
- Produces: `type SaleRow = { ym: PersianYearMonth; customerKey: string; company: string; salesRial: number; commissionRial: number }`, `type TargetRow = { year: number; month: number; amountRial: number }`, `type MonthLine`, `type YearLine`, `type CustomerTotal`, `type RepSummary`, `targetFor(targets, ym): number | null`, `summarizeRepSales(input): RepSummary`.

- [ ] **Step 1: Write the failing test** — `src/lib/repStats.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRepSales, targetFor, type SaleRow } from "./repStats";

const sale = (year: number, month: number, customerKey: string, salesRial: number): SaleRow => ({
  ym: { year, month },
  customerKey,
  company: `Co ${customerKey}`,
  salesRial,
  commissionRial: Math.round(salesRial * 0.025),
});
const MEHR_1405 = { year: 1405, month: 7 };

test("tiles: to date, this month, this year, customers, average per buying customer, owed", () => {
  const summary = summarizeRepSales({
    sales: [sale(1404, 12, "a", 1000), sale(1405, 1, "a", 2000), sale(1405, 7, "b", 4000), sale(1405, 7, "c", 1000)],
    customerCount: 5,
    paidRial: 100,
    targets: [],
    current: MEHR_1405,
    tableYear: 1405,
  });
  assert.equal(summary.salesToDate, 8000);
  assert.equal(summary.salesThisYear, 7000);
  assert.equal(summary.salesThisMonth, 5000);
  assert.equal(summary.customerCount, 5);
  assert.equal(summary.buyingCustomers, 3);
  assert.equal(summary.averagePerBuyingCustomer, 2667);
  assert.equal(summary.earnedRial, 200);
  assert.equal(summary.owedRial, 100);
});

test("the monthly table is one Persian year; Esfand stays in the year it belongs to", () => {
  const input = {
    sales: [sale(1404, 12, "a", 1000), sale(1405, 1, "a", 2000)],
    customerCount: 1,
    paidRial: 0,
    targets: [],
    current: MEHR_1405,
    tableYear: 1405,
  };
  const thisYear = summarizeRepSales(input);
  assert.equal(thisYear.months.length, 12);
  assert.equal(thisYear.months[0].salesRial, 2000);
  assert.equal(thisYear.months[11].salesRial, 0);
  assert.deepEqual(thisYear.years.map((y) => [y.year, y.salesRial]), [[1405, 2000], [1404, 1000]]);
  assert.deepEqual(thisYear.availableYears, [1405, 1404]);
  assert.equal(summarizeRepSales({ ...input, tableYear: 1404 }).months[11].salesRial, 1000);
});

test("a target stands from the month it is set until a later one replaces it", () => {
  const targets = [
    { year: 1405, month: 3, amountRial: 1000 },
    { year: 1405, month: 6, amountRial: 2000 },
  ];
  assert.equal(targetFor(targets, { year: 1405, month: 2 }), null);
  assert.equal(targetFor(targets, { year: 1405, month: 3 }), 1000);
  assert.equal(targetFor(targets, { year: 1405, month: 5 }), 1000);
  assert.equal(targetFor(targets, { year: 1405, month: 7 }), 2000);
  assert.equal(targetFor(targets, { year: 1406, month: 1 }), 2000);

  const summary = summarizeRepSales({
    sales: [sale(1405, 7, "a", 1500)],
    customerCount: 1,
    paidRial: 0,
    targets,
    current: MEHR_1405,
    tableYear: 1405,
  });
  assert.equal(summary.targetThisMonth, 2000);
  assert.equal(summary.percentOfTargetThisMonth, 75);
  assert.equal(summary.months[3].targetRial, 1000);
  assert.equal(summary.months[7].targetRial, null);
});

test("top customers: five at most, largest first", () => {
  const sales = ["a", "b", "c", "d", "e", "f"].map((key, i) => sale(1405, 1, key, (i + 1) * 100));
  const summary = summarizeRepSales({ sales, customerCount: 6, paidRial: 0, targets: [], current: MEHR_1405, tableYear: 1405 });
  assert.deepEqual(summary.topCustomers.map((c) => c.customerKey), ["f", "e", "d", "c", "b"]);
});

test("no sales: zeros, and no average rather than a division by zero", () => {
  const summary = summarizeRepSales({ sales: [], customerCount: 2, paidRial: 0, targets: [], current: MEHR_1405, tableYear: 1405 });
  assert.equal(summary.salesToDate, 0);
  assert.equal(summary.averagePerBuyingCustomer, null);
  assert.equal(summary.percentOfTargetThisMonth, null);
  assert.deepEqual(summary.availableYears, [1405]);
  assert.deepEqual(summary.earnedByMonth, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './repStats'`.

- [ ] **Step 3: Implement** — `src/lib/repStats.ts`

```ts
import type { PersianYearMonth } from "./persianCalendar";

/**
 * A rep's numbers, from their delivered orders.
 *
 * Pure arithmetic over rows the database already priced: each row carries its
 * exact rial sales and commission (db/repMoney.ts) and the Persian month it
 * was delivered in (lib/persianCalendar.ts). Summing whole rial below 2^53 is
 * exact in JavaScript; only the multiplication that produced them was not,
 * and that stayed in Postgres.
 */
export type SaleRow = {
  ym: PersianYearMonth;
  customerKey: string;
  company: string;
  salesRial: number;
  commissionRial: number;
};

export type TargetRow = { year: number; month: number; amountRial: number };

export type MonthLine = {
  month: number;
  salesRial: number;
  saleCount: number;
  commissionRial: number;
  targetRial: number | null;
  percentOfTarget: number | null;
};

export type YearLine = { year: number; salesRial: number; saleCount: number; commissionRial: number };

export type CustomerTotal = { customerKey: string; company: string; salesRial: number };

export type RepSummary = {
  salesToDate: number;
  salesThisMonth: number;
  salesThisYear: number;
  customerCount: number;
  buyingCustomers: number;
  averagePerBuyingCustomer: number | null;
  earnedRial: number;
  paidRial: number;
  owedRial: number;
  targetThisMonth: number | null;
  percentOfTargetThisMonth: number | null;
  tableYear: number;
  months: MonthLine[];
  years: YearLine[];
  availableYears: number[];
  topCustomers: CustomerTotal[];
  earnedByMonth: { ym: PersianYearMonth; salesRial: number; commissionRial: number }[];
};

function compareYm(a: PersianYearMonth, b: PersianYearMonth): number {
  return a.year - b.year || a.month - b.month;
}

/** The target for a month: the latest one set at or before it; null when none ever was. */
export function targetFor(targets: readonly TargetRow[], ym: PersianYearMonth): number | null {
  let best: TargetRow | null = null;
  for (const target of targets) {
    if (compareYm(target, ym) <= 0 && (best === null || compareYm(target, best) > 0)) best = target;
  }
  return best?.amountRial ?? null;
}

function percent(sales: number, target: number | null): number | null {
  return target !== null && target > 0 ? Math.round((sales / target) * 100) : null;
}

export function summarizeRepSales(input: {
  sales: readonly SaleRow[];
  /** Customers currently assigned, whether or not they have bought. */
  customerCount: number;
  paidRial: number;
  targets: readonly TargetRow[];
  current: PersianYearMonth;
  tableYear: number;
}): RepSummary {
  const { sales, targets, current, tableYear } = input;
  let salesToDate = 0;
  let salesThisMonth = 0;
  let salesThisYear = 0;
  let earnedRial = 0;
  const months: MonthLine[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, salesRial: 0, saleCount: 0, commissionRial: 0, targetRial: null, percentOfTarget: null,
  }));
  const years = new Map<number, YearLine>();
  const byMonth = new Map<string, { ym: PersianYearMonth; salesRial: number; commissionRial: number }>();
  const customers = new Map<string, CustomerTotal>();

  for (const sale of sales) {
    salesToDate += sale.salesRial;
    earnedRial += sale.commissionRial;
    if (sale.ym.year === current.year) {
      salesThisYear += sale.salesRial;
      if (sale.ym.month === current.month) salesThisMonth += sale.salesRial;
    }
    if (sale.ym.year === tableYear) {
      const line = months[sale.ym.month - 1];
      line.salesRial += sale.salesRial;
      line.saleCount += 1;
      line.commissionRial += sale.commissionRial;
    }
    const year = years.get(sale.ym.year) ?? { year: sale.ym.year, salesRial: 0, saleCount: 0, commissionRial: 0 };
    year.salesRial += sale.salesRial;
    year.saleCount += 1;
    year.commissionRial += sale.commissionRial;
    years.set(sale.ym.year, year);

    const key = `${sale.ym.year}-${sale.ym.month}`;
    const month = byMonth.get(key) ?? { ym: sale.ym, salesRial: 0, commissionRial: 0 };
    month.salesRial += sale.salesRial;
    month.commissionRial += sale.commissionRial;
    byMonth.set(key, month);

    const customer = customers.get(sale.customerKey) ?? {
      customerKey: sale.customerKey, company: sale.company, salesRial: 0,
    };
    customer.salesRial += sale.salesRial;
    customers.set(sale.customerKey, customer);
  }

  // A month still to come has no target to measure against yet.
  for (const line of months) {
    const ym = { year: tableYear, month: line.month };
    if (compareYm(ym, current) > 0) continue;
    line.targetRial = targetFor(targets, ym);
    line.percentOfTarget = percent(line.salesRial, line.targetRial);
  }

  const targetThisMonth = targetFor(targets, current);
  const buyingCustomers = customers.size;
  return {
    salesToDate,
    salesThisMonth,
    salesThisYear,
    customerCount: input.customerCount,
    buyingCustomers,
    averagePerBuyingCustomer: buyingCustomers > 0 ? Math.round(salesToDate / buyingCustomers) : null,
    earnedRial,
    paidRial: input.paidRial,
    owedRial: earnedRial - input.paidRial,
    targetThisMonth,
    percentOfTargetThisMonth: percent(salesThisMonth, targetThisMonth),
    tableYear,
    months,
    years: [...years.values()].sort((a, b) => b.year - a.year),
    availableYears: [...new Set([current.year, ...years.keys()])].sort((a, b) => b - a),
    topCustomers: [...customers.values()]
      .sort((a, b) => b.salesRial - a.salesRial || a.company.localeCompare(b.company))
      .slice(0, 5),
    earnedByMonth: [...byMonth.values()].sort((a, b) => compareYm(b.ym, a.ym)),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/repStats.ts src/lib/repStats.test.ts
git commit -m "feat: summarize a rep's sales, targets and commission by Persian month"
```

---

### Task 21: Rep money queries

**Files:**
- Create: `src/db/repMoney.ts`
- Test: `src/db/salesReps.integration.test.ts`

**Interfaces:**
- Consumes: `TargetRow` (Task 20), `PersianYearMonth` (Task 8).
- Produces: `type Db`; `type DeliveredRow = { deliveredAt: Date; customerKey: string; company: string; salesRial: number; commissionRial: number }`, `listDeliveredForRep(repId, db?)`; `type InProgressRow = { ref; status: OrderStatus; company; createdAt: Date; salesRial; commissionRial; estimate: boolean }`, `listInProgressForRep(repId, liveRate, db?)`; `salesByCustomerForRep(repId, db?): Promise<Map<string, number>>`; `type RepTotals = { repId; earnedRial; paidRial }`, `listRepTotals(db?): Promise<Map<string, RepTotals>>`; `listRecentDeliveries(days, db?)`; `type Payout = { id; amountRial; note; createdAt: Date }`, `listPayouts`, `addPayout(repId, amountRial, note, db?)`, `deletePayout(repId, payoutId, db?): Promise<boolean>`; `listTargets(repId, db?): Promise<TargetRow[]>`, `listAllTargets(db?): Promise<Map<string, TargetRow[]>>`, `setTarget(repId, ym, amountRial, db?)`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import {
  addPayout,
  deletePayout,
  listDeliveredForRep,
  listInProgressForRep,
  listPayouts,
  listRepTotals,
  listTargets,
  setTarget,
} from "./repMoney";

async function insertDelivered(
  tx: Tx,
  repId: string,
  totalCents: number,
  fxRateToRial: number,
  rateBp: number,
  deliveredAt: string,
): Promise<void> {
  await tx`
    INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                        status, rep_id, commission_rate_bp, invoice_number, fx_rate_to_rial,
                        created_at, invoiced_at, paid_at, shipped_at, delivered_at)
    VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Money Co', 'N', '',
            ${totalCents}, ${totalCents}, 'delivered', ${repId}, ${rateBp},
            ${`INV-TEST-${randomUUID().slice(0, 8)}`}, ${fxRateToRial},
            ${deliveredAt}::timestamptz - interval '9 days', ${deliveredAt}::timestamptz - interval '8 days',
            ${deliveredAt}::timestamptz - interval '6 days', ${deliveredAt}::timestamptz - interval '4 days',
            ${deliveredAt}::timestamptz)`;
}

test("one exact definition of sales and commission, and owed after payouts", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const rep = await insertRep(tx, { rateBp: 250 });
    await insertDelivered(tx, rep, 12345, 1050000, 250, "2026-09-10T10:00:00Z");
    // Cents × rate × basis points here is 1.35e19 — past 2^53, where
    // JavaScript arithmetic would already be wrong.
    await insertDelivered(tx, rep, 900000000, 1500000, 10000, "2026-09-11T10:00:00Z");

    const rows = await listDeliveredForRep(rep, tx);
    assert.deepEqual(rows.map((r) => [r.salesRial, r.commissionRial]), [
      [129_622_500, 3_240_563],
      [13_500_000_000_000, 13_500_000_000_000],
    ]);
    assert.ok(rows[0].deliveredAt instanceof Date);

    await addPayout(rep, 1_000_000, "Shahrivar", tx);
    assert.deepEqual((await listRepTotals(tx)).get(rep), {
      repId: rep,
      earnedRial: 3_240_563 + 13_500_000_000_000,
      paidRial: 1_000_000,
    });
    const [payout] = await listPayouts(rep, tx);
    assert.equal(await deletePayout(rep, payout.id, tx), true);
    assert.equal((await listRepTotals(tx)).get(rep)?.paidRial, 0);

    await setTarget(rep, { year: 1405, month: 7 }, 500_000_000, tx);
    await setTarget(rep, { year: 1405, month: 7 }, 600_000_000, tx);
    assert.deepEqual(await listTargets(rep, tx), [{ year: 1405, month: 7, amountRial: 600_000_000 }]);
  });
});

test("an order not yet invoiced is estimated at today's rate", async () => {
  assertLocalDatabase();
  await rolledBack(async (tx) => {
    const rep = await insertRep(tx, { rateBp: 500 });
    await tx`
      INSERT INTO orders (ref, company, contact_name, email, total_cents, requested_total_cents,
                          status, rep_id, commission_rate_bp)
      VALUES (${`ORD-${randomUUID().slice(0, 6).toUpperCase()}`}, 'Open Co', 'N', '', 10000, 10000,
              'received', ${rep}, 500)`;
    const [row] = await listInProgressForRep(rep, 1_000_000, tx);
    assert.equal(row.estimate, true);
    assert.equal(row.salesRial, 100_000_000);
    assert.equal(row.commissionRial, 5_000_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db:reps`
Expected: FAIL — `Cannot find module './repMoney'`.

- [ ] **Step 3: Implement** — `src/db/repMoney.ts`

```ts
import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { sql } from "./index";
import type { OrderStatus } from "@/lib/orders";
import type { PersianYearMonth } from "@/lib/persianCalendar";
import type { TargetRow } from "@/lib/repStats";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Db = Sql<{}> | TransactionSql<{}>;

/**
 * The one definition of a rep's money.
 *
 * Sales is the invoiced total converted at the rate frozen on that invoice —
 * the whole-rial total the invoice itself prints. Commission applies the rate
 * locked when the order was placed. Both are exact `numeric` arithmetic in
 * Postgres: JavaScript never multiplies these, because cents × rate × basis
 * points passes 2^53 on a large order. Results cross to JavaScript as float8:
 * postgres-js returns bigint as a string, and every rial amount here is an
 * integer far below 2^53, where a double is exact.
 *
 * `live` is today's rate, used only for orders not yet invoiced — an estimate,
 * and always labelled as one.
 */
function rate(live: number | null) {
  return live === null ? sql`o.fx_rate_to_rial` : sql`COALESCE(o.fx_rate_to_rial, ${live})`;
}
function salesRial(live: number | null = null) {
  return sql`ROUND(o.total_cents::numeric * ${rate(live)} / 100)::float8`;
}
function commissionRial(live: number | null = null) {
  return sql`ROUND(o.total_cents::numeric * ${rate(live)} * o.commission_rate_bp / 1000000)::float8`;
}

export type DeliveredRow = {
  deliveredAt: Date;
  /** The customer's id, or the order's company for an order whose customer is gone. */
  customerKey: string;
  company: string;
  salesRial: number;
  commissionRial: number;
};

/** Every sale credited to the rep, oldest first. The dashboard's only large read. */
export async function listDeliveredForRep(repId: string, db: Db = sql): Promise<DeliveredRow[]> {
  return db<DeliveredRow[]>`
    SELECT o.delivered_at AS "deliveredAt",
           COALESCE(o.user_id::text, 'order:' || o.company) AS "customerKey",
           COALESCE(u.company, o.company) AS company,
           ${salesRial()} AS "salesRial", ${commissionRial()} AS "commissionRial"
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.rep_id = ${repId} AND o.status = 'delivered'
    ORDER BY o.delivered_at
  `;
}

export type InProgressRow = {
  ref: string;
  status: OrderStatus;
  company: string;
  createdAt: Date;
  salesRial: number;
  commissionRial: number;
  /** True until the order is invoiced and its rate frozen. */
  estimate: boolean;
};

export async function listInProgressForRep(
  repId: string,
  liveRate: number,
  db: Db = sql,
): Promise<InProgressRow[]> {
  return db<InProgressRow[]>`
    SELECT o.ref, o.status, COALESCE(u.company, o.company) AS company,
           o.created_at AS "createdAt",
           ${salesRial(liveRate)} AS "salesRial", ${commissionRial(liveRate)} AS "commissionRial",
           (o.fx_rate_to_rial IS NULL) AS estimate
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.rep_id = ${repId} AND o.status IN ('received', 'invoiced', 'preparing', 'shipped')
    ORDER BY o.created_at DESC
    LIMIT 200
  `;
}

export async function salesByCustomerForRep(repId: string, db: Db = sql): Promise<Map<string, number>> {
  const rows = await db<{ customerId: string; salesRial: number }[]>`
    SELECT o.user_id AS "customerId", SUM(${salesRial()})::float8 AS "salesRial"
    FROM orders o
    WHERE o.rep_id = ${repId} AND o.status = 'delivered' AND o.user_id IS NOT NULL
    GROUP BY o.user_id
  `;
  return new Map(rows.map((row) => [row.customerId, row.salesRial]));
}

export type RepTotals = { repId: string; earnedRial: number; paidRial: number };

/** All reps, all time: one row each, for the admin's list. */
export async function listRepTotals(db: Db = sql): Promise<Map<string, RepTotals>> {
  const rows = await db<RepTotals[]>`
    SELECT r.id AS "repId",
           COALESCE((SELECT SUM(${commissionRial()}) FROM orders o
                     WHERE o.rep_id = r.id AND o.status = 'delivered'), 0)::float8 AS "earnedRial",
           COALESCE((SELECT SUM(p.amount_rial) FROM rep_payouts p WHERE p.rep_id = r.id), 0)::float8 AS "paidRial"
    FROM sales_reps r
  `;
  return new Map(rows.map((row) => [row.repId, row]));
}

/** Deliveries in the last `days`, for "this month" per rep — bucketed by the caller. */
export async function listRecentDeliveries(
  days: number,
  db: Db = sql,
): Promise<{ repId: string; deliveredAt: Date; salesRial: number }[]> {
  return db<{ repId: string; deliveredAt: Date; salesRial: number }[]>`
    SELECT o.rep_id AS "repId", o.delivered_at AS "deliveredAt", ${salesRial()} AS "salesRial"
    FROM orders o
    WHERE o.rep_id IS NOT NULL AND o.status = 'delivered'
      AND o.delivered_at >= now() - make_interval(days => ${days})
  `;
}

export type Payout = { id: number; amountRial: number; note: string; createdAt: Date };

export async function listPayouts(repId: string, db: Db = sql): Promise<Payout[]> {
  return db<Payout[]>`
    SELECT id, amount_rial::float8 AS "amountRial", note, created_at AS "createdAt"
    FROM rep_payouts WHERE rep_id = ${repId}
    ORDER BY created_at DESC, id DESC
  `;
}

export async function addPayout(repId: string, amountRial: number, note: string, db: Db = sql): Promise<void> {
  await db`INSERT INTO rep_payouts (rep_id, amount_rial, note) VALUES (${repId}, ${amountRial}, ${note})`;
}

/** For a payout recorded by mistake. Scoped to the rep, so a posted id cannot reach another's. */
export async function deletePayout(repId: string, payoutId: number, db: Db = sql): Promise<boolean> {
  const result = await db`DELETE FROM rep_payouts WHERE id = ${payoutId} AND rep_id = ${repId}`;
  return result.count === 1;
}

export async function listTargets(repId: string, db: Db = sql): Promise<TargetRow[]> {
  return db<TargetRow[]>`
    SELECT persian_year AS year, persian_month AS month, amount_rial::float8 AS "amountRial"
    FROM rep_targets WHERE rep_id = ${repId}
    ORDER BY persian_year, persian_month
  `;
}

export async function listAllTargets(db: Db = sql): Promise<Map<string, TargetRow[]>> {
  const rows = await db<(TargetRow & { repId: string })[]>`
    SELECT rep_id AS "repId", persian_year AS year, persian_month AS month,
           amount_rial::float8 AS "amountRial"
    FROM rep_targets
  `;
  const byRep = new Map<string, TargetRow[]>();
  for (const { repId, ...target } of rows) byRep.set(repId, [...(byRep.get(repId) ?? []), target]);
  return byRep;
}

/** A target from this month on, until a later one replaces it (lib/repStats.ts `targetFor`). */
export async function setTarget(
  repId: string,
  ym: PersianYearMonth,
  amountRial: number,
  db: Db = sql,
): Promise<void> {
  await db`
    INSERT INTO rep_targets (rep_id, persian_year, persian_month, amount_rial)
    VALUES (${repId}, ${ym.year}, ${ym.month}, ${amountRial})
    ON CONFLICT (rep_id, persian_year, persian_month)
    DO UPDATE SET amount_rial = EXCLUDED.amount_rial, updated_at = now()
  `;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:db:reps && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/db/repMoney.ts src/db/salesReps.integration.test.ts
git commit -m "feat: add the one exact definition of a rep's sales, commission, payouts and targets"
```

---

### Task 22: Rep home dashboard and commission page

**Files:**
- Modify: `src/lib/money.ts` (`formatRial`), `src/lib/money.test.ts`
- Create: `src/lib/repDashboard.ts`
- Create: `src/components/RepDashboard.tsx`, `src/components/CommissionReport.tsx`
- Modify: `src/app/[locale]/rep/(portal)/page.tsx`, `…/(portal)/layout.tsx` (Commission tab), `…/customers/page.tsx` (sales column)
- Create: `src/app/[locale]/rep/(portal)/commission/page.tsx`
- Modify: `src/lib/i18n.ts` (Appendix A, Task 22)

**Interfaces:**
- Consumes: Tasks 8, 9, 20, 21.
- Produces: `formatRial(rial, locale)`; `loadRepSummary(repId, tableYear?, now?): Promise<RepSummary>`; `RepDashboard({ locale, summary, yearHref })`; `CommissionReport({ locale, summary, payouts, inProgress, deleteAction? })`.

- [ ] **Step 1: Failing test** — append to `src/lib/money.test.ts`

```ts
import { formatRial } from "./money";

test("a whole-rial amount reads with the reader's digits and unit", () => {
  assert.equal(formatRial(1234567, "en"), "1,234,567 IRR");
  assert.equal(formatRial(1234567, "fa"), "۱٬۲۳۴٬۵۶۷ ریال");
  assert.equal(formatRial(0, "en"), "0 IRR");
});
```

(Match the file's existing imports; add `formatRial` to its import list rather than a second import line.)

- [ ] **Step 2: Run to verify it fails** — `npm test` → FAIL, `formatRial` is not exported.

- [ ] **Step 3: Implement**

`money.ts`:

```ts
/**
 * An amount already in whole rial — a rep's sales, commission or payout —
 * never a catalog price in cents. No catalog rounding: these are totals of
 * exact invoice amounts, and a rep compares them with what they were paid.
 */
export function formatRial(rial: number, locale: Locale): string {
  return rialWithUnit(Math.round(rial), locale);
}
```

`src/lib/repDashboard.ts`:

```ts
import "server-only";
import { persianYearMonth } from "./persianCalendar";
import { summarizeRepSales, type RepSummary } from "./repStats";
import { listDeliveredForRep, listPayouts, listTargets } from "@/db/repMoney";
import { countCustomersForRep } from "@/db/customerQueries";

/**
 * Everything the rep's home and commission pages show, from four reads. The
 * delivered orders are read once and placed in Persian months here, because
 * Postgres has no Persian calendar; the cost therefore grows with the rep's
 * delivered orders, at a few dozen bytes each.
 */
export async function loadRepSummary(
  repId: string,
  tableYear?: number,
  now: Date = new Date(),
): Promise<RepSummary> {
  const [delivered, customerCount, payouts, targets] = await Promise.all([
    listDeliveredForRep(repId),
    countCustomersForRep(repId),
    listPayouts(repId),
    listTargets(repId),
  ]);
  const current = persianYearMonth(now);
  return summarizeRepSales({
    sales: delivered.map((row) => ({
      ym: persianYearMonth(row.deliveredAt),
      customerKey: row.customerKey,
      company: row.company,
      salesRial: row.salesRial,
      commissionRial: row.commissionRial,
    })),
    customerCount,
    paidRial: payouts.reduce((sum, payout) => sum + payout.amountRial, 0),
    targets,
    current,
    tableYear: tableYear ?? current.year,
  });
}
```

`RepDashboard.tsx` (server component). Props `{ locale; summary: RepSummary; yearHref: (year: number) => string }`. Renders:
1. A tile row (grid, `[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]`, bordered tiles like the admin sections): `t.salesToDate` (`data-testid="tile-sales-to-date"`), `t.salesThisMonth`, `t.salesThisYear`, `t.customers` (`formatInt`), `t.averagePerCustomer` (or —), `t.commissionOwed` (`data-testid="tile-commission-owed"`). Money via `formatRial`.
2. Target: when `targetThisMonth` is null, `t.noTargetSet`; otherwise a bar — an outer bordered box and an inner box whose `width` is `min(100, percent)%` — and `t.targetProgress` with `{percent}` (`formatInt(percent)` + `%`/`٪`) and `{target}` (`formatRial`).
3. `t.salesByMonth` for `summary.tableYear`, with the other `availableYears` as links via `yearHref`. A `spec-table`: `t.month` (`persianMonthName`), `t.sales`, `t.saleCount`, `t.commission`, `t.target`, `t.ofTarget` (— where null). Below it a `t.yearTotals` table: year (Persian digits in `fa`), `t.sales`, `t.saleCount`, `t.commission`.
4. `t.topCustomers`: a numbered list of `company` and `formatRial(salesRial)`; `t.noSalesYet` when `salesToDate === 0`.

`CommissionReport.tsx` (server component). Props `{ locale; summary; payouts: Payout[]; inProgress: InProgressRow[]; deleteAction?: { action: (fd: FormData) => Promise<void>; hidden: Record<string, string>; labels: { delete: string; confirm: string; continue: string; discard: string } } }`. Renders tiles `t.earned`, `t.paidOut`, `t.owed`; `t.earnedByMonth` table (`persianMonthLabel(ym)`, `t.sales`, `t.commission`); `t.payouts` list (date via `formatPersianDate`, amount, note) with, when `deleteAction` is given, a `ConfirmSubmit` per payout posting `payoutId`; `t.inProgress` table (ref, company, `OrderStatusPill`, `t.expectedCommission` = `formatRial(commissionRial)` followed by ` (${t.estimateShort})` when `estimate`).

Portal pages:
- Layout: append `{ href: `/${l}/rep/commission`, label: t.commission }`.
- Home: `const year = Number(searchParams.year)`; `loadRepSummary(rep.id, Number.isInteger(year) ? year : undefined)`; `<RepDashboard locale={l} summary={summary} yearHref={(y) => `/${l}/rep?year=${y}`} />` first, then follow-ups due and the referral link (already there).
- `commission/page.tsx`: `requireRep`; `loadRepSummary`, `listPayouts`, `listInProgressForRep(rep.id, await getFxRate())`; heading `t.commission`; `<CommissionReport … />` without `deleteAction`.
- Customers list: add `salesByCustomerForRep(rep.id)` and a `t.sales` column (`formatRial(map.get(id) ?? 0)`).

- [ ] **Step 4: Dictionary** — Task 22 keys, both languages.

- [ ] **Step 5: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS / clean.

Browser as the Task 5 rep: walk the Task 16 order to delivered in admin (Mark payment received → Mark shipped with any courier and tracking → Mark delivered). Rep home: sales to date equals that order's invoice total in rial (compare with its invoice page, rial currency); commission owed = total × 2.5%; the current Persian month's row carries one sale; top customers lists the customer. Commission page lists it under the current month and shows no payouts. An order still in progress shows an estimate label until invoiced.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts src/lib/repDashboard.ts src/components/RepDashboard.tsx src/components/CommissionReport.tsx "src/app/[locale]/rep" src/lib/i18n.ts
git commit -m "feat: show reps their sales, target and commission by Persian month"
```

---

### Task 23: Admin — payouts, targets and rep numbers

**Files:**
- Modify: `src/lib/money.ts` (`parseRialAmount`), `src/lib/money.test.ts`
- Modify: `src/app/[locale]/admin/(panel)/reps/actions.ts` (`addPayoutAction`, `deletePayoutAction`, `setTargetAction`; target on create)
- Modify: `src/app/[locale]/admin/(panel)/reps/page.tsx`, `…/reps/[id]/page.tsx`
- Modify: `src/lib/i18n.ts` (Appendix A, Task 23)

**Interfaces:**
- Consumes: Tasks 20–22.
- Produces: `parseRialAmount(raw): number | null`; the three actions.

- [ ] **Step 1: Failing test** — append to `money.test.ts`

```ts
test("a typed rial amount: any keyboard, any thousands separator, whole numbers only", () => {
  assert.equal(parseRialAmount("12500000"), 12_500_000);
  assert.equal(parseRialAmount("۱۲٬۵۰۰٬۰۰۰"), 12_500_000);
  assert.equal(parseRialAmount("12,500,000"), 12_500_000);
  assert.equal(parseRialAmount(" 12 500 000 "), 12_500_000);
  assert.equal(parseRialAmount("12.5"), null);
  assert.equal(parseRialAmount("-5"), null);
  assert.equal(parseRialAmount(""), null);
  assert.equal(parseRialAmount("abc"), null);
  assert.equal(parseRialAmount("1".repeat(16)), null);
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test` → FAIL.

- [ ] **Step 3: Implement**

`money.ts` (import `latinDigits` from `./digits`):

```ts
/**
 * A whole-rial amount typed by the admin — a payout or a target. Persian or
 * ASCII digits, with whichever thousands separator was typed. A decimal point
 * is refused rather than guessed at: rial has no fractions, and "12.500"
 * could mean twelve and a half or twelve thousand five hundred.
 */
export function parseRialAmount(raw: string): number | null {
  const value = latinDigits(raw.trim()).replace(/[\s,٬'_]/g, "");
  if (!/^\d{1,15}$/.test(value)) return null;
  return Number(value);
}
```

Actions (admin `reps/actions.ts`):

```ts
export async function addPayoutAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/admin/reps`);
  const amount = parseRialAmount(String(formData.get("amount") ?? ""));
  const note = boundedString(formData.get("note"), 500, { allowEmpty: true });
  if (amount === null || amount <= 0 || note === null) {
    redirect(`/${locale}/admin/reps/${id}?error=amount#payouts`);
  }
  await addPayout(id, amount, note);
  redirect(`/${locale}/admin/reps/${id}?ok=payout#payouts`);
}

export async function deletePayoutAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  const payoutId = Number(formData.get("payoutId"));
  if (!isUuid(id) || !Number.isSafeInteger(payoutId)) redirect(`/${locale}/admin/reps`);
  await deletePayout(id, payoutId);
  redirect(`/${locale}/admin/reps/${id}?ok=payout-deleted#payouts`);
}

/** A target from the current Persian month on, until changed. */
export async function setTargetAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/admin/reps`);
  const amount = parseRialAmount(String(formData.get("target") ?? ""));
  if (amount === null) redirect(`/${locale}/admin/reps/${id}?error=amount#target`);
  await setTarget(id, persianYearMonth(new Date()), amount);
  redirect(`/${locale}/admin/reps/${id}?ok=target#target`);
}
```

In `createRepAction`, after the rep is created: `const target = String(formData.get("target") ?? "").trim();` — when non-empty, `parseRialAmount(target)`; a null result redirects to the list with `error=amount` *before* `createRep` runs (move this parsing above the create call so nothing is written when it fails), otherwise `setTarget(created.id, persianYearMonth(new Date()), amount)`.

Pages:
- `reps/page.tsx`: the new-rep form gains an optional `target` field (`t.monthlyTargetOptional`, `inputMode="numeric"`, `dir="ltr"`). The table gains `t.repThisMonth` (sum of `listRecentDeliveries(40)` rows whose `persianYearMonth(deliveredAt)` equals the current one, per rep), `t.monthlyTarget` (`targetFor(listAllTargets().get(id) ?? [], current)` with its percent), `t.earned`, `t.paidOut`, `t.owed` (from `listRepTotals()`), all via `formatRial`; `error=amount` → `t.amountInvalid`.
- `reps/[id]/page.tsx`: after the details sections, `RepDashboard` (`yearHref={(y) => `/${l}/admin/reps/${id}?year=${y}`}`), then a section `id="payouts"`: a form (`addPayoutAction`, hidden `repId`, `amount` labelled `t.payoutAmount` with `inputMode="numeric"`, `note` labelled `t.note`, submit `t.recordPayout`) and `CommissionReport` with `deleteAction` bound to `deletePayoutAction` (labels `t.deletePayout`, `t.confirmDeletePayout`, `t.confirmContinue`, `t.confirmDiscard`; hidden `locale`, `repId`); then a section `id="target"`: the current target and `t.targetFromThisMonth.replace("{month}", persianMonthLabel(current, l))`, a form (`setTargetAction`, `target` field, submit `t.setTarget`). Banners `ok=payout` → `t.payoutSaved`, `ok=payout-deleted` → `t.payoutDeleted`, `ok=target` → `t.targetSaved`, `error=amount` → `t.amountInvalid`. All inputs `disabled={DEMO_MODE}`.

- [ ] **Step 4: Dictionary** — Task 23 keys, both languages.

- [ ] **Step 5: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS / clean.

Browser: record a payout of `۱۰٬۰۰۰` → owed drops by 10,000 on both the admin page and the rep's commission page; delete it → back. Type `12.5` → `t.amountInvalid` and nothing recorded. Set a target → the rep's home bar and this month's table row show it; the reps list shows this month, target %, earned, paid, owed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts "src/app/[locale]/admin/(panel)/reps" src/lib/i18n.ts
git commit -m "feat: let the admin record payouts, set monthly targets and see rep totals"
```

---

### Task 24: Local demo data

**Files:**
- Create: `scripts/seed-reps.mts`
- Modify: `package.json` (`db:seed:reps`)

**Interfaces:**
- Consumes: `script-client` (`sql`, `isLocalTarget`, `targetHost`), `reconcileInventoryForProducts`, Tasks 1, 2, 8 helpers.
- Produces: `npm run db:seed:reps`.

- [ ] **Step 1: Write the script** — `scripts/seed-reps.mts`

```ts
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
    const at = (days: number) => new Date(created.getTime() + days * DAY);
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
              ${invoiced ? tx`'INV-' || to_char(${at(1)}::timestamptz, 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 4, '0')` : null},
              ${invoiced ? 1_000_000 + Math.floor(random() * 100_000) : null},
              ${created}, ${invoiced ? at(1) : null}, ${paid ? at(3) : null},
              ${shipped ? at(5) : null}, ${status === "delivered" ? at(9) : null})
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
  for (const rep of reps) {
    await tx`
      INSERT INTO rep_payouts (rep_id, amount_rial, note, created_at)
      VALUES (${rep.id}, 25000000, 'Demo payout', now() - interval '60 days'),
             (${rep.id}, 40000000, 'Demo payout', now() - interval '20 days')`;
  }
  await tx`
    INSERT INTO rep_targets (rep_id, persian_year, persian_month, amount_rial)
    VALUES (${reps[0].id}, ${yearAgo.year}, ${yearAgo.month}, 800000000),
           (${reps[1].id}, ${current.year}, ${current.month}, 1200000000)`;

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
```

Two notes for the executor, both checked when the script first runs: postgres-js must accept `${tx`…`}` as a nested fragment for the invoice number (it does for `sql` fragments elsewhere in this codebase; if the transaction instance refuses, build the number in a separate `SELECT … nextval('invoice_seq')` and pass it as a value), and `demoOrders` is reused as a subquery fragment three times — if postgres-js refuses to reuse a fragment, inline the subquery text in each place.

`package.json` scripts: `"db:seed:reps": "tsx scripts/seed-reps.mts",`.

- [ ] **Step 2: Run it twice and verify**

Run: `npm run db:seed:reps && npm run db:seed:reps && npm run db:reconcile:check && npm run db:verify`
Expected: the seed prints the reps and 15 customers both times; reconcile reports no problems; verify all ✓.

Browser: sign in as `demo.sara` → home shows populated tiles, a year table with sales in several Persian months, targets, top 5, overdue follow-ups; `demo.reza` shows this month's target. Measure the home page's server time and HTML size (Appendix B "Measuring a page") and note both for the hand-off.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-reps.mts package.json
git commit -m "chore: add local demo data for sales reps"
```

---

### Task 25: Documentation, end-to-end to delivery, final gate

**Files:**
- Modify: `e2e/sales-rep-flow.spec.ts` (walk to delivered; assert the dashboard)
- Modify: `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/LOCAL-DEV.md`

- [ ] **Step 1: Extend the e2e test**

Before the final `Promise.all(… close())`, add:

```ts
    // Paid, shipped, delivered — then the sale and its commission reach the rep.
    const advance = async (button: string, dialogTitle: string, fill?: () => Promise<void>) => {
      const row = admin.locator("details").filter({ hasText: company }).first();
      await row.locator("summary").click();
      if (fill) await fill();
      await row.getByRole("button", { name: button }).click();
      await admin.getByRole("dialog", { name: dialogTitle }).getByRole("button", { name: t.confirmContinue }).click();
      await expect(admin).toHaveURL(/ok=status/);
    };
    await advance(t.markPaid, t.confirmMarkPaid);
    await advance(t.markShipped, t.confirmMarkShipped, async () => {
      const row = admin.locator("details").filter({ hasText: company }).first();
      await row.locator('input[name="courier"]').fill("E2E Post");
      await row.locator('input[name="trackingNumber"]').fill("TRK-E2E-1");
    });
    await advance(t.markDelivered, t.confirmMarkDelivered);

    await rep.goto(`/${locale}/rep`);
    await expect(rep.getByTestId("tile-sales-to-date")).not.toContainText(formatRial(0, locale));
    await expect(rep.getByTestId("tile-commission-owed")).not.toContainText(formatRial(0, locale));
```

with `import { formatRial } from "../src/lib/money";` at the top.

- [ ] **Step 2: Documentation**

`docs/ARCHITECTURE.md`:
- Routes table: add `/[locale]/rep/**` (rep, own cookie), `/[locale]/pay/[token]` (public, token-gated), `/[locale]/r/[code]` (public route handler), `/[locale]/admin/(panel)/{reps,customers}` (staff).
- Rename "Two independent auth systems" to three and add a **Sales reps** bullet: own table and cookie; token key derived for the purpose; `session_version` makes deactivation and password changes end open sessions; password rule with digit normalization.
- New invariants, each a short paragraph in the file's style: *Credit and rate are locked when an order is placed* (`orders.rep_id`, `commission_rate_bp`, set in `submitOrderFromCartInTransaction`; eligibility is a per-customer flag; a sale is a delivered order); *One definition of rep money* (`db/repMoney.ts`, exact numeric, float8 at the edge, never multiplied in JavaScript); *Persian months are bucketed in JavaScript* (`lib/persianCalendar.ts`, Tehran time, why not SQL); *A pay token is the key to one order* (64 hex, default on the column, checked before any query, also opens the invoice via `?key=`, cannot be revoked); *Rep scoping is in the WHERE clause* (every rep query carries the rep id from the session; 404 not 403).
- "Where things live": the new modules.

`docs/DEPLOYMENT.md`: in the migrations section, name `20260927120000_add_sales_reps.sql` as a pre-deploy requirement (the code reads `customer_code`, `pay_token` and the rep columns on every account and order page) and note `db:verify:remote` checks its tables, columns, constraints, the four unique indexes and the migration version.

`docs/LOCAL-DEV.md`: a short section on `npm run db:seed:reps` — what it creates, that it is local-only and repeatable, and where the demo sign-in details are (the script's header).

- [ ] **Step 3: Full gate**

Run everything in Appendix B "Full gate", including the whole e2e suite.
Expected: lint, typecheck, unit, database and build clean; e2e all pass except the tests that skip themselves on the other device profile.

- [ ] **Step 4: Commit**

```bash
git add e2e/sales-rep-flow.spec.ts docs/ARCHITECTURE.md docs/DEPLOYMENT.md docs/LOCAL-DEV.md
git commit -m "docs: describe sales reps, commission and pay links; test the loop to delivery"
```

---

## Appendix A — Dictionary keys

Add each task's keys to both `en` and `fa` in `src/lib/i18n.ts`, grouped under a comment naming the feature (`// Sales reps`). Existing keys the tasks reuse are not listed.

**Task 4**

| key | en | fa |
| --- | --- | --- |
| repPortal | Sales rep | نمایندهٔ فروش |
| repSignInTitle | Sales rep sign-in | ورود نمایندهٔ فروش |
| repSignInPrompt | Sign in with the username and password you were given. | با نام کاربری و گذرواژه‌ای که دریافت کرده‌اید وارد شوید. |
| username | Username | نام کاربری |
| repSignInFailed | Username or password is incorrect. | نام کاربری یا گذرواژه نادرست است. |
| repHome | Home | خانه |
| welcomeRep | Welcome, {name} | {name}، خوش آمدید |
| choosePasswordTitle | Choose your password | گذرواژهٔ خود را انتخاب کنید |
| tempPasswordForced | You signed in with a temporary password. Choose your own to continue. | با گذرواژهٔ موقت وارد شده‌اید. برای ادامه، گذرواژهٔ خودتان را انتخاب کنید. |
| repPasswordRules | At least 8 characters, including an uppercase English letter (A–Z), a number and a special character such as ! @ # $ %. | دست‌کم ۸ نویسه، شامل یک حرف بزرگ انگلیسی (A–Z)، یک عدد و یک نویسهٔ ویژه مانند ! @ # $ %. |
| repPasswordPolicy | That password does not follow the rules below. | این گذرواژه با قواعد زیر سازگار نیست. |
| savePassword | Save password | ذخیرهٔ گذرواژه |

**Task 5**

| key | en | fa |
| --- | --- | --- |
| salesReps | Sales reps | نمایندگان فروش |
| newRep | New sales rep | نمایندهٔ فروش جدید |
| createRep | Create rep | ایجاد نماینده |
| repName | Name | نام |
| commissionPercent | Commission % | درصد پورسانت |
| commission | Commission | پورسانت |
| repStatusActive | Active | فعال |
| repStatusInactive | Deactivated | غیرفعال |
| customers | Customers | مشتریان |
| repUsernameHint | 3–32 characters: English letters, numbers, dot, dash or underscore. | ۳ تا ۳۲ نویسه: حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط. |
| repUsernameInvalid | Choose a username of 3–32 English letters, numbers, dots, dashes or underscores. | نام کاربری باید ۳ تا ۳۲ نویسه از حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد. |
| repUsernameTaken | That username is already in use. | این نام کاربری قبلاً استفاده شده است. |
| commissionInvalid | Commission must be a number from 0 to 100, with at most two decimals. | پورسانت باید عددی بین ۰ تا ۱۰۰ با حداکثر دو رقم اعشار باشد. |
| repSaved | Rep details saved. | مشخصات نماینده ذخیره شد. |
| details | Details | مشخصات |
| save | Save | ذخیره |
| issueTempPassword | Issue a new temporary password | صدور گذرواژهٔ موقت جدید |
| confirmIssueTempPassword | Issue a new temporary password? The current one stops working at once. | گذرواژهٔ موقت جدید صادر شود؟ گذرواژهٔ فعلی بی‌درنگ از کار می‌افتد. |
| repDeactivate | Deactivate | غیرفعال کردن |
| repDeactivateHint | Locks the rep out at once. Their customers move to the rep you choose; orders already placed stay credited to them. | دسترسی نماینده بی‌درنگ قطع می‌شود. مشتریانش به نمایندهٔ انتخابی منتقل می‌شوند و سفارش‌های ثبت‌شده همچنان به نام او می‌ماند. |
| repMoveCustomersTo | Move their customers to | انتقال مشتریان به |
| noRep | No rep | بدون نماینده |
| confirmDeactivateRep | Deactivate this rep? | این نماینده غیرفعال شود؟ |
| repDeactivated | Rep deactivated. | نماینده غیرفعال شد. |
| repReactivate | Reactivate | فعال‌سازی دوباره |
| repReactivated | Rep reactivated. Their former customers were not moved back. | نماینده دوباره فعال شد. مشتریان قبلی‌اش بازگردانده نشده‌اند. |
| repBadDestination | Choose an active rep, or no rep. | یک نمایندهٔ فعال یا «بدون نماینده» را انتخاب کنید. |
| tempPasswordOnce | Temporary password — copy or share it now. It will not be shown again. | گذرواژهٔ موقت — همین حالا کپی یا ارسال کنید. دوباره نمایش داده نمی‌شود. |
| tempPassword | Temporary password | گذرواژهٔ موقت |
| share | Share | ارسال |
| copy | Copy | کپی |
| copied | Copied | کپی شد |
| repCredentialsMessage | Your TEMEX sales account is ready. Sign in at {url} with username {login} and temporary password {password}. You will be asked to choose your own password. | حساب فروش شما در تمکس آماده است. در {url} با نام کاربری {login} و گذرواژهٔ موقت {password} وارد شوید. پس از ورود، گذرواژهٔ خودتان را انتخاب می‌کنید. |

**Task 6**

| key | en | fa |
| --- | --- | --- |
| customerId | Customer ID | کد مشتری |
| loginEmailOrId | Email or customer ID | ایمیل یا کد مشتری |
| signInFailed *(change)* | Email, customer ID or password is incorrect. | ایمیل، کد مشتری یا گذرواژه نادرست است. |

**Task 7** — no new keys (uses `choosePasswordTitle`, `tempPasswordForced`, `savePassword` from Task 4).

**Task 10**

| key | en | fa |
| --- | --- | --- |
| newCustomer | New customer | مشتری جدید |
| createCustomer | Create customer | ایجاد مشتری |
| customerSearchPlaceholder | ID, company or phone | کد، نام شرکت یا تلفن |
| noCustomersYet | No customers yet. | هنوز مشتری‌ای ندارید. |
| lastOrder | Last order | آخرین سفارش |
| nextFollowUp | Next follow-up | پیگیری بعدی |
| customerCodeChoice | Customer ID | کد مشتری |
| customerCodeFromPhone | Last 7 digits of the phone | ۷ رقم آخر تلفن |
| customerCodeRandom | A random 7-digit number | یک عدد تصادفی ۷ رقمی |
| customerCodeTaken | Those phone digits are already another customer's ID — this customer may already have an account. Ask the admin, or choose a random ID. | این ارقام تلفن پیش‌تر کد مشتری دیگری است؛ شاید این مشتری از قبل حساب دارد. از مدیر بپرسید یا کد تصادفی انتخاب کنید. |
| customerEmailTaken | That email already has an account. Ask the admin to assign it to you. | این ایمیل از قبل حساب دارد. از مدیر بخواهید آن را به شما واگذار کند. |
| customerPhoneTooShort | The phone number needs at least 7 digits to make an ID. Check it, or choose a random ID. | برای ساخت کد، تلفن باید دست‌کم ۷ رقم داشته باشد. آن را بررسی کنید یا کد تصادفی انتخاب کنید. |
| customerSaved | Customer details saved. | مشخصات مشتری ذخیره شد. |
| customerCredentialsMessage | Your TEMEX account is ready. Sign in at {url} with customer ID {login} and temporary password {password}. You will be asked to choose your own password. | حساب شما در تمکس آماده است. در {url} با کد مشتری {login} و گذرواژهٔ موقت {password} وارد شوید. پس از ورود، گذرواژهٔ خودتان را انتخاب می‌کنید. |
| commissionOn | Rep earns commission | پورسانت نماینده برقرار است |
| commissionOff | No commission (customer signed up alone) | بدون پورسانت (مشتری خودش ثبت‌نام کرده) |
| customerNotes | Notes | یادداشت‌ها |
| customerNotesHint | For you and the admin. The customer never sees these. | برای شما و مدیر. مشتری هرگز این‌ها را نمی‌بیند. |
| noteByAdmin | Admin | مدیر |
| followUp | Follow-up | پیگیری |
| followUpNone | No follow-up set. | پیگیری‌ای تنظیم نشده است. |
| followUpIn | In {n} days | {n} روز دیگر |
| followUpTomorrow | Tomorrow | فردا |
| followUpClear | Clear | پاک کردن |
| followUpsDue | Follow-ups due | پیگیری‌های سررسیده |
| followUpsNoneDue | Nothing due today. | امروز پیگیری سررسیده‌ای ندارید. |
| overdue | Overdue | گذشته از موعد |
| customerOrders | Orders | سفارش‌ها |

**Task 11**

| key | en | fa |
| --- | --- | --- |
| allReps | All reps | همهٔ نمایندگان |
| filter | Filter | فیلتر |
| originSelf | Signed up alone | ثبت‌نام توسط خود مشتری |
| originRep | Created by {name} | ایجادشده توسط {name} |
| originReferral | Referred by {name} | معرفی‌شده توسط {name} |
| assignRep | Rep | نماینده |
| repEarnsCommission | Rep earns commission on this customer's orders | نماینده از سفارش‌های این مشتری پورسانت می‌گیرد |
| repEarnsCommissionHint | Applies to orders placed from now on. | برای سفارش‌هایی اعمال می‌شود که از این پس ثبت شوند. |
| assignmentSaved | Assignment saved. | واگذاری ذخیره شد. |
| pagePrevious | Previous | قبلی |
| pageNext | Next | بعدی |
| createdOn | Created | تاریخ ایجاد |
| commissionShortOn | On | دارد |
| commissionShortOff | Off | ندارد |

**Task 12**

| key | en | fa |
| --- | --- | --- |
| referralLink | Your referral link | لینک معرفی شما |
| referralHint | People who sign up within 30 days of opening this link become your customers. | کسانی که ظرف ۳۰ روز پس از باز کردن این لینک ثبت‌نام کنند، مشتری شما می‌شوند. |
| referralMessage | Browse TEMEX industrial parts and open your account here: {url} | قطعات صنعتی تمکس را ببینید و حساب خود را از اینجا باز کنید: {url} |
| yourSalesRep | Your sales rep | نمایندهٔ فروش شما |

**Task 14**

| key | en | fa |
| --- | --- | --- |
| bankSection | Bank account | حساب بانکی |
| bankSectionHint | Shown on pay pages while an order awaits payment. Leave blank anything you do not want shown. | در صفحهٔ پرداخت، تا زمانی که سفارش در انتظار پرداخت است نمایش داده می‌شود. هر موردی را که نمی‌خواهید نمایش داده شود خالی بگذارید. |
| bankNameEn | Bank name (English) | نام بانک (انگلیسی) |
| bankNameFa | Bank name (Persian) | نام بانک (فارسی) |
| bankHolderEn | Account holder (English) | صاحب حساب (انگلیسی) |
| bankHolderFa | Account holder (Persian) | صاحب حساب (فارسی) |
| bankCard | Card number | شماره کارت |
| bankSheba | Sheba number | شماره شبا |
| bankAccount | Account number | شماره حساب |
| bankNoteEn | Note (English) | توضیح (انگلیسی) |
| bankNoteFa | Note (Persian) | توضیح (فارسی) |
| bankSave | Save bank account | ذخیرهٔ حساب بانکی |
| bankSaved | Bank account saved. | حساب بانکی ذخیره شد. |
| bankInvalidCard | That card number is mistyped — check its 16 digits. | شماره کارت نادرست است؛ ۱۶ رقم آن را بررسی کنید. |
| bankInvalidSheba | That Sheba number is mistyped — it is IR followed by 24 digits. | شماره شبا نادرست است؛ IR و سپس ۲۴ رقم. |
| bankInvalidAccount | An account number is 4–30 digits, optionally with dashes or dots. | شماره حساب ۴ تا ۳۰ رقم است و می‌تواند خط تیره یا نقطه داشته باشد. |
| bankTooLong | A name is limited to 200 characters and a note to 1,000. | نام حداکثر ۲۰۰ و توضیح حداکثر ۱٬۰۰۰ نویسه است. |

**Task 15**

| key | en | fa |
| --- | --- | --- |
| bankName | Bank | بانک |
| bankHolder | Account holder | صاحب حساب |
| payByTransfer | Pay by bank transfer | پرداخت با انتقال بانکی |
| payBeingPriced | We are preparing the final price for this order. This page will show the amount to pay once it is ready. | در حال آماده‌سازی قیمت نهایی این سفارش هستیم. پس از آماده شدن، مبلغ قابل پرداخت در همین صفحه نمایش داده می‌شود. |
| payAmountDue | This order is ready to pay. | این سفارش آمادهٔ پرداخت است. |
| payPaidThanks | Paid — thank you. | پرداخت شد — سپاسگزاریم. |
| payCancelled | This order was cancelled. Nothing is due. | این سفارش لغو شده است و مبلغی قابل پرداخت نیست. |
| priceEstimate | Estimate at today's catalog prices. | برآورد بر اساس قیمت‌های امروز کاتالوگ. |

**Task 16**

| key | en | fa |
| --- | --- | --- |
| repOrderForCustomer | New order for a customer | سفارش جدید برای مشتری |
| orderingForName | Ordering for {name} | سفارش برای {name} |
| orderingForChoose | You will choose the customer at checkout. | مشتری را هنگام ثبت سفارش انتخاب می‌کنید. |
| chooseCustomer | Choose a customer | انتخاب مشتری |
| useCustomer | Use | انتخاب |
| repPlaceOrder | Place order | ثبت سفارش |
| repNoCustomersYet | Create a customer first. | ابتدا یک مشتری ایجاد کنید. |
| customerNotYours | That customer is no longer assigned to you. | این مشتری دیگر به شما واگذار نشده است. |
| newOrder | New order | سفارش جدید |
| change | Change | تغییر |
| reorderSkipped | Not added — no longer sold: | افزوده نشد — دیگر فروخته نمی‌شود: |

**Task 17**

| key | en | fa |
| --- | --- | --- |
| ordersTab | Orders | سفارش‌ها |
| repOrderCreated | Order placed. Share the pay link once it is priced — its status shows here. | سفارش ثبت شد. پس از قیمت‌گذاری، لینک پرداخت را ارسال کنید؛ وضعیت آن همین‌جا نمایش داده می‌شود. |
| payLink | Pay link | لینک پرداخت |
| sharePayLink | Share pay link | ارسال لینک پرداخت |
| openPayPage | Open pay page | باز کردن صفحهٔ پرداخت |
| payLinkMessage | {company}: your TEMEX order {ref}. View and pay here: {url} | {company}: سفارش {ref} شما در تمکس. مشاهده و پرداخت: {url} |
| reorder | Reorder | سفارش دوباره |
| reorderNotYours | This customer is no longer yours, so the order cannot be repeated for them. | این مشتری دیگر به شما واگذار نشده، بنابراین تکرار سفارش برای او ممکن نیست. |
| reorderCartFull | Your cart has no room for these items. Empty it and try again. | سبد شما جای این اقلام را ندارد. آن را خالی کنید و دوباره تلاش کنید. |
| commissionLocked | Commission {percent}, locked when placed | پورسانت {percent}، ثابت‌شده هنگام ثبت |
| commissionNone | No commission on this order | این سفارش پورسانت ندارد |
| filterAll | All | همه |

**Task 18**

| key | en | fa |
| --- | --- | --- |
| repLabel | Rep | نماینده |
| placedByRep | placed by rep | ثبت‌شده توسط نماینده |

**Task 22**

| key | en | fa |
| --- | --- | --- |
| salesToDate | Sales to date | فروش تا امروز |
| salesThisMonth | This month | این ماه |
| salesThisYear | This year | امسال |
| averagePerCustomer | Average per buying customer | میانگین هر مشتری خریدار |
| commissionOwed | Commission owed | پورسانت پرداخت‌نشده |
| monthlyTarget | Monthly target | هدف فروش ماهانه |
| targetProgress | {percent} of {target} | {percent} از {target} |
| noTargetSet | No target set. | هدفی تعیین نشده است. |
| salesByMonth | Sales by month | فروش ماهانه |
| month | Month | ماه |
| year | Year | سال |
| sales | Sales | فروش |
| saleCount | Orders | سفارش |
| target | Target | هدف |
| ofTarget | % of target | ٪ از هدف |
| yearTotals | By year | سالانه |
| topCustomers | Top 5 customers | ۵ مشتری برتر |
| noSalesYet | No delivered orders yet. A sale counts once its order is marked delivered. | هنوز سفارش تحویل‌شده‌ای ندارید. فروش پس از ثبت «تحویل داده شد» محاسبه می‌شود. |
| earnedByMonth | Commission earned by month | پورسانت کسب‌شده به تفکیک ماه |
| earned | Earned | کسب‌شده |
| paidOut | Paid out | پرداخت‌شده |
| owed | Owed | مانده |
| payouts | Payouts | پرداخت‌ها |
| noPayoutsYet | No payouts recorded. | پرداختی ثبت نشده است. |
| inProgress | Orders in progress | سفارش‌های در جریان |
| expectedCommission | Expected commission | پورسانت مورد انتظار |
| estimateShort | estimate | برآورد |

**Task 23**

| key | en | fa |
| --- | --- | --- |
| recordPayout | Record payout | ثبت پرداخت |
| payoutAmount | Amount (rial) | مبلغ (ریال) |
| note | Note | توضیح |
| payoutSaved | Payout recorded. | پرداخت ثبت شد. |
| payoutDeleted | Payout deleted. | پرداخت حذف شد. |
| deletePayout | Delete | حذف |
| confirmDeletePayout | Delete this payout record? | این پرداخت حذف شود؟ |
| amountInvalid | Enter a whole number of rial. | مبلغ را به ریال و بدون اعشار وارد کنید. |
| setTarget | Set target | تعیین هدف |
| targetFromThisMonth | Applies from {month} until changed. | از {month} تا زمان تغییر اعمال می‌شود. |
| targetSaved | Target saved. | هدف ذخیره شد. |
| repThisMonth | Sales this month | فروش این ماه |
| monthlyTargetOptional | Monthly target in rial (optional) | هدف فروش ماهانه به ریال (اختیاری) |

---

## Appendix B — Local verification recipe

**Never** use `npm run build` or `npm run start` without the exports below, and never the `industrial-supply-prod` entry in `.claude/launch.json`: on this machine `.env.production.local` points both at the live database.

**Dev server with a test admin password** (browser checks). Add once to `.claude/launch.json` (commit it with Task 4 as its own `chore:` commit):

```json
{
  "name": "industrial-supply-rep-test",
  "runtimeExecutable": "bash",
  "runtimeArgs": ["-c", "ADMIN_PASSWORD=ci-admin-password exec npm run dev -- --port 3200"],
  "port": 3200
}
```

Start it with the preview tool (`preview_start` name `industrial-supply-rep-test`); it reads `.env` and `.env.local`, so the local Docker database, and signs admin in with the CI test password `ci-admin-password`. Browse `http://localhost:3200/…`.

**Production server for e2e.** In one shell:

```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
export DIRECT_DATABASE_URL="$DATABASE_URL"
export ADMIN_PASSWORD=ci-admin-password E2E_ADMIN_PASSWORD=ci-admin-password
npm run build
```

then start `npm run start -- --hostname 127.0.0.1 --port 3100` in the background from the same environment, and check `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/en/f/ball-bearings` prints `200` — that family exists only locally, so a 404 means the server is reading the live database: stop it at once. Then `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npx playwright test`. Stop the server afterwards.

**Full gate:** `npm run lint && npx tsc --noEmit && npm test && npm run test:db`, then the production build and e2e suite above.

**Measuring a page:** with the dev server stopped and the production server running (above), sign in as the rep in the browser, then in the browser console run `performance.getEntriesByType("navigation")[0]` on the page and record `responseStart - requestStart` (server time) and `transferSize`; repeat three times and take the middle value.
