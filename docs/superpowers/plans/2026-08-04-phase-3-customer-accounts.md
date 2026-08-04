# Customer Accounts — Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers can hold an account, watch their orders through to delivery, read their own invoices, and have checkout prefilled — without any of it becoming a second authentication system to maintain.

**Architecture:** One new table, `users`. Sessions are a signed cookie rather than rows: HMAC of user id and expiry against `AUTH_SECRET`, the same shape `lib/admin.ts` already uses. Password hashing is scrypt from `node:crypto` — no native module, so no build surprise on a managed platform. The customer's order pages are strictly read-only; every state change belongs to staff.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), postgres-js raw SQL, Drizzle for schema definition only, Tailwind v4, `node:test` via `tsx`.

**Source spec:** `docs/superpowers/specs/2026-07-31-accounts-orders-admin-design.md`, sections "Authentication" and "Customer-facing".

**Depends on:** Phase 1 (orders domain) and Phase 2 (invoices), both on this branch.

## Global Constraints

- **No password reset in v1.** Staff reset a password by hand from the admin page. Do not build a reset flow, a token table, or an email send — nothing in this application sends email, and that is a deliberate decision recorded in the spec's Known gaps.
- **Sign-in failures are uniform.** Wrong password and unknown email both return "Email or password is incorrect". A form that distinguishes them is an account-enumeration oracle.
- **Ownership failures return 404, not 403.** A 403 confirms the reference exists.
- **`AUTH_SECRET` is required in production** and its absence must throw at startup. A predictable signing key lets anyone mint a cookie for any user id. In development it may fall back to a fixed value with a console warning.
- Passwords are compared with `timingSafeEqual`, never `===`.
- **The customer's order pages are read-only.** No approve, no cancel, no edit. Every transition belongs to staff; the spec's whole simplification rests on there being one actor.
- Guest orders stay unlinked. Without email verification, auto-claiming by matching address would let anyone read a stranger's order by signing up with their email.
- The invoice renders at `orders.fx_rate_to_toman`, never the live rate.
- Money is integer USD cents. `formatPrice`/`formatPriceBare` take a required `rate` third argument.
- Every user-visible string goes in **both** dictionaries in `src/lib/i18n.ts`.
- Locale comes from `safeLocale`/`isLocale` in `src/lib/i18n.ts`. Never interpolate an unvalidated value into a redirect.
- **After any `npm run db:push`, re-apply `src/db/extensions.sql`** and confirm the count is 11 — push silently drops every object in it, including `invoice_seq`:
  ```bash
  docker exec -i isupply-db psql -U isupply -d isupply < src/db/extensions.sql
  ```
- Postgres runs in Docker as `isupply-db` on host port **5434**.
- TypeScript strict mode, ES modules, `@/*` aliased to `src/*`.

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/lib/password.ts` | scrypt hash and verify. No database, no cookies. |
| `src/lib/password.test.ts` | Round-trip, wrong password, malformed hash. |
| `src/lib/sessionToken.ts` | Pure sign/verify of the cookie value. No `next/headers`, so it is testable. |
| `src/lib/sessionToken.test.ts` | Valid, tampered, expired. |
| `src/lib/session.ts` | Cookie read/write around `sessionToken`, plus `currentUser()`. |
| `src/db/userQueries.ts` | `createUser`, `findUserByEmail`, `getUserById`, `updateProfile`, `setPassword`. |
| `src/app/[locale]/account/actions.ts` | `signUpAction`, `signInAction`, `signOutAction`, `updateProfileAction`. |
| `src/app/[locale]/account/page.tsx` | Order list and profile, or the signed-out prompt. |
| `src/app/[locale]/account/signin/page.tsx` | Sign-in form. |
| `src/app/[locale]/account/signup/page.tsx` | Sign-up form. |
| `src/app/[locale]/account/orders/[ref]/page.tsx` | One order, read-only, with its status timeline. |
| `src/components/OrderTimeline.tsx` | The `*_at` columns rendered as a progress trail. |

**Modified**

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `users` table. |
| `src/lib/i18n.ts` | Account strings in both dictionaries. |
| `src/components/Header.tsx` | An account link beside the order link. |
| `src/app/[locale]/quote/page.tsx` | Prefill from the signed-in profile. |
| `src/app/actions.ts` | Stamp `user_id` on a submitted order. |
| `src/app/[locale]/invoice/[ref]/page.tsx` | Allow the owning customer, not only staff. |
| `src/app/[locale]/admin/actions.ts` | `resetCustomerPasswordAction`. |
| `src/app/[locale]/admin/page.tsx` | Reset-password control on an order with an account. |
| `.env.example` | Document `AUTH_SECRET`. |

---

### Task 1: Password hashing

**Files:**
- Create: `src/lib/password.ts`, `src/lib/password.test.ts`

**Interfaces:**
- Consumes: `node:crypto` only.
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, stored: string): Promise<boolean>`, `MIN_PASSWORD_LENGTH: number`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/password.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./password";

test("a hash verifies against the password that made it", async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
});

test("a wrong password does not verify", async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("Correct horse battery staple", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("the same password hashes differently every time", async () => {
  // Without a per-hash salt, identical passwords produce identical rows and a
  // stolen dump tells you which users share one.
  const a = await hashPassword("same password");
  const b = await hashPassword("same password");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same password", a), true);
  assert.equal(await verifyPassword("same password", b), true);
});

test("the stored form records its own parameters", async () => {
  const stored = await hashPassword("whatever");
  const parts = stored.split("$");
  assert.equal(parts[0], "scrypt");
  assert.equal(parts.length, 6);
});

test("a malformed stored hash fails rather than throwing", async () => {
  // A truncated or hand-edited column must read as "no match", not crash the
  // sign-in route.
  assert.equal(await verifyPassword("x", ""), false);
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  assert.equal(await verifyPassword("x", "scrypt$16384$8$1$onlyfourparts"), false);
  assert.equal(await verifyPassword("x", "argon2$1$2$3$4$5"), false);
  assert.equal(await verifyPassword("x", "scrypt$notanumber$8$1$c2FsdA==$aGFzaA=="), false);
});

test("the minimum length is stated once, for the form and the action to share", () => {
  assert.equal(typeof MIN_PASSWORD_LENGTH, "number");
  assert.ok(MIN_PASSWORD_LENGTH >= 8);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test` — fails, `Cannot find module './password'`.

- [ ] **Step 3: Implement**

Create `src/lib/password.ts`:

```ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * scrypt from node:crypto, not argon2 or bcrypt.
 *
 * Both of those are native modules, and a native module is a build failure
 * waiting to happen on a managed platform — the wrong prebuilt binary, a Node
 * version bump, a different libc in the build image. scrypt is memory-hard,
 * built in, and has no install step. The cost is that the parameters are ours
 * to choose rather than a library's to default.
 *
 * The stored form carries its own parameters, so raising them later does not
 * invalidate existing hashes: an old row verifies with the numbers it was
 * written with.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scrypt(plain, salt, expected.length, { N: n, r, p });
  } catch {
    // Absurd stored parameters can make scrypt refuse outright. That is a
    // corrupt row, not a valid password.
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test` — `pass 35`, `fail 0` (29 from Phase 2 plus 6).

- [ ] **Step 5: Commit**

```bash
git add src/lib/password.ts src/lib/password.test.ts
git commit -m "Hash passwords with scrypt from node:crypto"
```

---

### Task 2: The session cookie

**Files:**
- Create: `src/lib/sessionToken.ts`, `src/lib/sessionToken.test.ts`, `src/lib/session.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `node:crypto`; `next/headers` (in `session.ts` only).
- Produces: from `sessionToken.ts` — `signSessionToken(userId: string, expiresAtMs: number, secret: string): string`, `verifySessionToken(token: string, secret: string, nowMs?: number): string | null`, `SESSION_TTL_MS: number`. From `session.ts` — `setSessionCookie(userId: string): Promise<void>`, `clearSessionCookie(): Promise<void>`, `currentUserId(): Promise<string | null>`, `currentUser(): Promise<UserRow | null>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sessionToken.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { signSessionToken, verifySessionToken, SESSION_TTL_MS } from "./sessionToken";

const SECRET = "test-secret-not-a-real-one";
const USER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = 1_760_000_000_000;

test("a token this secret signed verifies and yields the user id", () => {
  const token = signSessionToken(USER, NOW + SESSION_TTL_MS, SECRET);
  assert.equal(verifySessionToken(token, SECRET, NOW), USER);
});

test("a token another secret signed does not verify", () => {
  // This is the whole security property: the cookie is unforgeable only
  // because the signature depends on a secret the client never sees.
  const token = signSessionToken(USER, NOW + SESSION_TTL_MS, "a different secret");
  assert.equal(verifySessionToken(token, SECRET, NOW), null);
});

test("editing the user id invalidates the signature", () => {
  const token = signSessionToken(USER, NOW + SESSION_TTL_MS, SECRET);
  const [, exp, sig] = token.split(".");
  const forged = ["11111111-2222-3333-4444-555555555555", exp, sig].join(".");
  assert.equal(verifySessionToken(forged, SECRET, NOW), null);
});

test("extending the expiry invalidates the signature", () => {
  const token = signSessionToken(USER, NOW + 1000, SECRET);
  const [id, , sig] = token.split(".");
  const forged = [id, String(NOW + 99_999_999), sig].join(".");
  assert.equal(verifySessionToken(forged, SECRET, NOW), null);
});

test("an expired token does not verify even though it is correctly signed", () => {
  const token = signSessionToken(USER, NOW - 1, SECRET);
  assert.equal(verifySessionToken(token, SECRET, NOW), null);
});

test("garbage does not verify and does not throw", () => {
  assert.equal(verifySessionToken("", SECRET, NOW), null);
  assert.equal(verifySessionToken("a.b", SECRET, NOW), null);
  assert.equal(verifySessionToken("a.b.c.d", SECRET, NOW), null);
  assert.equal(verifySessionToken("a.notanumber.c", SECRET, NOW), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test` — fails, `Cannot find module './sessionToken'`.

- [ ] **Step 3: Implement the pure half**

Create `src/lib/sessionToken.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A signed cookie, not a sessions table.
 *
 * One table fewer, no expiry sweep, and the same shape `lib/admin.ts` already
 * uses. The accepted cost is that an individual session cannot be revoked:
 * signing out clears the cookie on that device, and invalidating everything
 * everywhere means rotating `AUTH_SECRET`. At this scale that is the right
 * trade, and swapping in a `sessions` table later changes only `session.ts`.
 *
 * Kept free of `next/headers` so it can be tested without a request.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSessionToken(
  userId: string,
  expiresAtMs: number,
  secret: string,
): string {
  const payload = `${userId}.${expiresAtMs}`;
  return `${payload}.${signature(payload, secret)}`;
}

/** Returns the user id, or null for anything tampered with, expired or malformed. */
export function verifySessionToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expRaw, provided] = parts;
  if (!userId) return null;

  const expiresAt = Number(expRaw);
  if (!Number.isFinite(expiresAt)) return null;

  const expected = signature(`${userId}.${expRaw}`, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Checked after the signature, so an attacker learns nothing from timing
  // about whether a forged token happened to be in date.
  if (expiresAt <= nowMs) return null;

  return userId;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test` — `pass 41`, `fail 0`.

- [ ] **Step 5: Write the cookie wrapper**

Create `src/lib/session.ts`:

```ts
import "server-only";
import { cookies } from "next/headers";
import { signSessionToken, verifySessionToken, SESSION_TTL_MS } from "./sessionToken";
import { getUserById, type UserRow } from "@/db/userQueries";

const COOKIE = "isupply_session";

/**
 * A predictable signing key means anyone can mint a cookie for any user id, so
 * production refuses to start without one rather than falling back to a value
 * that is in the repository.
 */
function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production (16+ characters)");
  }
  console.warn("⚠  AUTH_SECRET unset — using a development-only key");
  return "development-only-insecure-key";
}

export async function setSessionCookie(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, signSessionToken(userId, Date.now() + SESSION_TTL_MS, secret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function currentUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token, secret());
}

export async function currentUser(): Promise<UserRow | null> {
  const id = await currentUserId();
  if (!id) return null;
  return getUserById(id);
}
```

- [ ] **Step 6: Document the secret**

Append to `.env.example`:

```
# Signs the customer session cookie. Required in production — the app refuses
# to start without it, because a predictable key lets anyone mint a session for
# any account. Generate with: openssl rand -base64 32
AUTH_SECRET=
```

- [ ] **Step 7: Commit**

`npx tsc --noEmit` will fail until Task 3 creates `userQueries`. Commit the
pure module and its tests now, and the wrapper with Task 3:

```bash
git add src/lib/sessionToken.ts src/lib/sessionToken.test.ts .env.example
git commit -m "Sign the session cookie instead of storing sessions"
```

---

### Task 3: The users table and its queries

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/userQueries.ts`
- Commit `src/lib/session.ts` from Task 2 here.

**Interfaces:**
- Consumes: `sql` from `@/db`; `hashPassword` from `@/lib/password`.
- Produces: `type UserRow`, `createUser(input): Promise<UserRow | "email-taken">`, `findUserByEmail(email): Promise<(UserRow & { passwordHash: string }) | null>`, `getUserById(id): Promise<UserRow | null>`, `updateProfile(id, input): Promise<void>`, `setPassword(userId, hash): Promise<void>`, `findUserIdByEmail(email): Promise<string | null>`.

- [ ] **Step 1: Add the table**

Append to `src/db/schema.ts`:

```ts
// ---------------------------------------------------------------------------
// Customer accounts
// ---------------------------------------------------------------------------

/**
 * One table. Sessions are a signed cookie (see lib/sessionToken.ts), so there
 * is no companion sessions table to sweep.
 *
 * Email uniqueness is enforced by a `lower(email)` index in extensions.sql
 * rather than a plain unique constraint: addresses are case-insensitive in
 * practice, and two rows differing only in capitalisation are two people who
 * both think they own the account.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    company: text("company").notNull().default(""),
    contactName: text("contact_name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    defaultPoNumber: text("default_po_number").notNull().default(""),
    locale: text("locale").notNull().default("en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [index("users_created_idx").on(t.createdAt)],
);
```

- [ ] **Step 2: Add the case-insensitive unique index**

Append to `src/db/extensions.sql`:

```sql

-- Email is case-insensitive in practice; two rows differing only in
-- capitalisation are two people who both believe they own the account.
-- An expression index is not expressible in Drizzle's DSL, hence its home here.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));
```

- [ ] **Step 3: Push, then restore the extensions**

Run: `npm run db:push`

Expected: it proposes creating `users` and dropping the objects in
`extensions.sql`. Accept the table creation. **If it proposes dropping or
altering any other table or column, answer no, stop, and report BLOCKED.**

Then immediately:

```bash
docker exec -i isupply-db psql -U isupply -d isupply < src/db/extensions.sql
docker exec isupply-db psql -U isupply -d isupply -c "\di" | grep -c "trgm_idx\|fts_idx\|path_prefix_idx\|psv_product_idx\|orders_invoice_number_key\|orders_email_ref_idx\|users_email_lower_key"
```

Expected: 11.

Confirm `invoice_seq` survived, since losing it breaks invoicing outright:

```bash
docker exec isupply-db psql -U isupply -d isupply -c "SELECT last_value FROM invoice_seq;"
```

- [ ] **Step 4: Write the queries**

Create `src/db/userQueries.ts`:

```ts
import "server-only";
import { sql } from "./index";

export type UserRow = {
  id: string;
  email: string;
  company: string;
  contactName: string;
  phone: string;
  defaultPoNumber: string;
  locale: string;
};

const COLS = sql`id, email, company, contact_name AS "contactName", phone,
                 default_po_number AS "defaultPoNumber", locale`;

export async function getUserById(id: string): Promise<UserRow | null> {
  // A malformed uuid would make Postgres raise rather than return no rows,
  // and this value comes from a cookie.
  const rows = await sql<UserRow[]>`
    SELECT ${COLS} FROM users WHERE id::text = ${id} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findUserByEmail(
  email: string,
): Promise<(UserRow & { passwordHash: string }) | null> {
  const rows = await sql<(UserRow & { passwordHash: string })[]>`
    SELECT ${COLS}, password_hash AS "passwordHash"
    FROM users WHERE lower(email) = lower(${email}) LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export type NewUser = {
  email: string;
  passwordHash: string;
  company: string;
  contactName: string;
  phone: string;
  locale: string;
};

/**
 * Returns "email-taken" rather than throwing, because a duplicate address is
 * an ordinary thing for a person to do, not an exceptional condition. The
 * unique index is what actually decides — checking first and inserting second
 * is a race, and this is the one place two simultaneous sign-ups collide.
 */
export async function createUser(input: NewUser): Promise<UserRow | "email-taken"> {
  try {
    const rows = await sql<UserRow[]>`
      INSERT INTO users (email, password_hash, company, contact_name, phone, locale)
      VALUES (${input.email}, ${input.passwordHash}, ${input.company},
              ${input.contactName}, ${input.phone}, ${input.locale})
      RETURNING ${COLS}
    `;
    return rows[0];
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") return "email-taken";
    throw err;
  }
}

export async function updateProfile(
  id: string,
  input: { company: string; contactName: string; phone: string; defaultPoNumber: string; locale: string },
): Promise<void> {
  await sql`
    UPDATE users
    SET company = ${input.company}, contact_name = ${input.contactName},
        phone = ${input.phone}, default_po_number = ${input.defaultPoNumber},
        locale = ${input.locale}
    WHERE id::text = ${id}
  `;
}

export async function setPassword(userId: string, passwordHash: string): Promise<void> {
  await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id::text = ${userId}`;
}

export async function touchLastLogin(userId: string): Promise<void> {
  await sql`UPDATE users SET last_login_at = now() WHERE id::text = ${userId}`;
}
```

- [ ] **Step 5: Verify against the live database**

```bash
node --import tsx --conditions=react-server -e "import('./src/db/userQueries.ts').then(async m => { const a = await m.createUser({email:'Test@Example.com',passwordHash:'x',company:'C',contactName:'N',phone:'1',locale:'en'}); console.log('created:', typeof a === 'string' ? a : a.email); const b = await m.createUser({email:'test@example.com',passwordHash:'x',company:'C',contactName:'N',phone:'1',locale:'en'}); console.log('duplicate differing only in case:', b); process.exit(0); })"
docker exec isupply-db psql -U isupply -d isupply -c "DELETE FROM users WHERE lower(email)='test@example.com';"
```

Expected: the first prints the created address, the second prints
`email-taken` — proving the case-insensitive index does its job. Then the row
is removed.

- [ ] **Step 6: Commit**

Run `npx tsc --noEmit` (no output) and `npm test` (`pass 41`).

```bash
git add src/db/schema.ts src/db/extensions.sql src/db/userQueries.ts src/lib/session.ts
git commit -m "Add the users table, keyed on a case-insensitive email"
```

---

### Task 4: Sign up, sign in, sign out

**Files:**
- Create: `src/app/[locale]/account/actions.ts`, `src/app/[locale]/account/signin/page.tsx`, `src/app/[locale]/account/signup/page.tsx`
- Modify: `src/lib/i18n.ts`, `src/components/Header.tsx`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `MIN_PASSWORD_LENGTH`; `setSessionCookie`, `clearSessionCookie`, `currentUserId`; `createUser`, `findUserByEmail`, `touchLastLogin`; `safeLocale`.
- Produces: `signUpAction`, `signInAction`, `signOutAction`.

- [ ] **Step 1: Add the strings**

Add to `en`:

```ts
  // Account
  account: "Account",
  signUp: "Create account",
  signInTitle: "Sign in",
  signUpTitle: "Create an account",
  signInPrompt: "Sign in to see your orders and invoices.",
  signUpPrompt: "Create an account to track your orders and download invoices.",
  haveAccount: "Already have an account?",
  needAccount: "Need an account?",
  passwordAgain: "Confirm password",
  signInFailed: "Email or password is incorrect.",
  emailTaken: "An account with that email already exists.",
  passwordTooShort: "Use at least 8 characters.",
  passwordMismatch: "The two passwords do not match.",
  signUpIncomplete: "Fill in every required field.",
  myOrders: "My orders",
  profile: "Profile",
  saveProfile: "Save profile",
  profileSaved: "Profile saved.",
  defaultPoNumber: "Default PO number",
  noOrdersYet: "No orders yet.",
  orderPlaced: "Placed",
  viewOrder: "View",
  viewInvoice: "View invoice",
  payNow: "Pay now",
  signedInAs: "Signed in as",
```

and to `fa`:

```ts
  account: "حساب کاربری",
  signUp: "ایجاد حساب",
  signInTitle: "ورود",
  signUpTitle: "ایجاد حساب کاربری",
  signInPrompt: "برای مشاهده سفارش‌ها و صورتحساب‌ها وارد شوید.",
  signUpPrompt: "برای پیگیری سفارش‌ها و دریافت صورتحساب حساب بسازید.",
  haveAccount: "قبلاً حساب ساخته‌اید؟",
  needAccount: "حساب ندارید؟",
  passwordAgain: "تکرار گذرواژه",
  signInFailed: "ایمیل یا گذرواژه نادرست است.",
  emailTaken: "حسابی با این ایمیل از قبل وجود دارد.",
  passwordTooShort: "حداقل ۸ نویسه وارد کنید.",
  passwordMismatch: "دو گذرواژه یکسان نیستند.",
  signUpIncomplete: "همه فیلدهای الزامی را تکمیل کنید.",
  myOrders: "سفارش‌های من",
  profile: "مشخصات",
  saveProfile: "ذخیره مشخصات",
  profileSaved: "مشخصات ذخیره شد.",
  defaultPoNumber: "شماره سفارش خرید پیش‌فرض",
  noOrdersYet: "هنوز سفارشی ثبت نشده است.",
  orderPlaced: "تاریخ ثبت",
  viewOrder: "مشاهده",
  viewInvoice: "مشاهده صورتحساب",
  payNow: "پرداخت",
  signedInAs: "واردشده با",
```

- [ ] **Step 2: Write the actions**

Create `src/app/[locale]/account/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { safeLocale } from "@/lib/i18n";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { setSessionCookie, clearSessionCookie, currentUserId } from "@/lib/session";
import { createUser, findUserByEmail, touchLastLogin, updateProfile } from "@/db/userQueries";

export async function signUpAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("passwordConfirm") ?? "");
  const company = String(formData.get("company") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!email || !company || !contactName || !phone) {
    redirect(`/${locale}/account/signup?error=incomplete`);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    redirect(`/${locale}/account/signup?error=short`);
  }
  if (password !== confirm) {
    redirect(`/${locale}/account/signup?error=mismatch`);
  }

  const created = await createUser({
    email,
    passwordHash: await hashPassword(password),
    company,
    contactName,
    phone,
    locale,
  });
  if (created === "email-taken") {
    redirect(`/${locale}/account/signup?error=taken`);
  }

  await setSessionCookie(created.id);
  revalidatePath("/", "layout");
  redirect(`/${locale}/account`);
}

export async function signInAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const user = await findUserByEmail(email);

  /*
   * One failure message and one code path for both "no such account" and
   * "wrong password".
   *
   * Distinguishing them turns this form into an oracle for which addresses
   * have accounts — worth something on its own, and worth more when the same
   * addresses appear in a credential dump from somewhere else. The dummy
   * verify keeps the timing of the two cases comparable, which is the other
   * half of the same leak.
   */
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");

  if (!user || !ok) {
    redirect(`/${locale}/account/signin?error=failed`);
  }

  await setSessionCookie(user.id);
  await touchLastLogin(user.id);
  revalidatePath("/", "layout");
  redirect(`/${locale}/account`);
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  await clearSessionCookie();
  revalidatePath("/", "layout");
  redirect(`/${locale}`);
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const id = await currentUserId();
  if (!id) redirect(`/${locale}/account/signin`);

  await updateProfile(id, {
    company: String(formData.get("company") ?? "").trim(),
    contactName: String(formData.get("contactName") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    defaultPoNumber: String(formData.get("defaultPoNumber") ?? "").trim(),
    locale,
  });
  revalidatePath("/", "layout");
  redirect(`/${locale}/account?ok=profile`);
}
```

- [ ] **Step 3: Write the two forms**

Both pages are Server Components that redirect to `/account` if already signed
in. Follow the existing form styling in `src/app/[locale]/quote/page.tsx` —
the same `<label>` / `<span className="mb-0.5 block font-bold">` / `<input
className="w-full">` shape, and the same red banner markup for errors.

`src/app/[locale]/account/signin/page.tsx`: email and password fields, a
submit button, an error banner keyed on `?error=failed` showing
`t.signInFailed`, and a link to `/[locale]/account/signup`.

`src/app/[locale]/account/signup/page.tsx`: email, password, confirm password,
company, contact name, phone — all required — with banners for
`?error=incomplete|short|mismatch|taken` showing `t.signUpIncomplete`,
`t.passwordTooShort`, `t.passwordMismatch`, `t.emailTaken`, and a link to
`/[locale]/account/signin`. Give the password inputs
`minLength={MIN_PASSWORD_LENGTH}` and `type="password"`, and the email input
`type="email"` with `dir="ltr"`.

Both include `<input type="hidden" name="locale" value={l} />`.

- [ ] **Step 4: Add the header link**

In `src/components/Header.tsx`, add an account link beside the existing order
link, pointing at `/${locale}/account`, labelled `t.account`. Match the
surrounding link styling exactly. Do not read the session here — the header
renders on cached catalog pages, and reading a cookie would make every one of
them dynamic. The link is unconditional; `/account` itself decides whether to
show orders or a sign-in prompt.

- [ ] **Step 5: Verify**

`npx tsc --noEmit` clean, `npm test` `pass 41`.

With the dev server running:
1. `/en/account/signup` — submit with a 3-character password, get
   `t.passwordTooShort`. Submit with mismatched passwords, get
   `t.passwordMismatch`. Submit valid details, land on `/en/account`.
2. Sign out, then `/en/account/signin` with the wrong password → the same
   message as an unknown address. Confirm both by reading the rendered text.
3. Sign in correctly, land on `/en/account`.
4. `/fa/account/signup` renders right-to-left in Persian.

Use a throwaway address such as `buyer@example.test`. Record it — later tasks
reuse it.

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/account" src/lib/i18n.ts src/components/Header.tsx
git commit -m "Let customers create an account and sign in"
```

---

### Task 5: The account area

**Files:**
- Create: `src/app/[locale]/account/page.tsx`, `src/components/OrderTimeline.tsx`, `src/app/[locale]/account/orders/[ref]/page.tsx`
- Create: `src/db/accountQueries.ts`

**Interfaces:**
- Consumes: `currentUser` from `@/lib/session`; `OrderStatusPill`, `STATUS_LABEL_KEY`; `formatPrice`, `formatInt`; `getFxRate`.
- Produces: `listOrdersForUser(userId)`, `getOrderForUser(userId, ref)`; `<OrderTimeline locale order />`.

- [ ] **Step 1: Write the queries**

Create `src/db/accountQueries.ts` with two functions. `listOrdersForUser`
returns `id, ref, status, createdAt, totalCents, fxRateToToman, invoiceNumber`
plus an item count, `WHERE user_id::text = ${userId} ORDER BY created_at DESC`.

`getOrderForUser(userId, ref)` returns one order and its items, with
**`WHERE ref = ${ref} AND user_id::text = ${userId}`** — the ownership
predicate belongs in the query, not in a check afterwards. Return `null` when
it matches nothing; the page turns that into a 404.

Include `fx_rate_to_toman` in both. A customer's own order list must show the
same money the invoice does.

- [ ] **Step 2: Write the timeline**

Create `src/components/OrderTimeline.tsx` — a Server Component taking the four
`*_at` values and the status, rendering the reached steps with their dates and
the unreached ones muted. Use `STATUS_LABEL_KEY` from `OrderStatusPill.tsx` so
the customer sees the same words as staff. Dates format as
`new Date(v).toISOString().slice(0, 10)` in `class="tech"` — Latin digits, as
every other identifier in this application.

A cancelled order shows the steps it reached and then a cancelled marker; do
not render the remaining steps as if they were still coming.

- [ ] **Step 3: Write the account page**

`src/app/[locale]/account/page.tsx`: if `currentUser()` is null, render
`t.signInPrompt` with links to sign in and sign up — not a redirect, so the
page is linkable from the header for signed-out visitors too.

Signed in, render two sections: the order list (reference as a link to the
detail page, date, `<OrderStatusPill>`, item count, total at
`o.fxRateToToman ?? rate`), and a profile form posting to
`updateProfileAction` with company, contact name, phone and default PO. Show
`t.profileSaved` on `?ok=profile`. Include a sign-out form posting to
`signOutAction`.

Empty state: `t.noOrdersYet` with a link to the catalog.

- [ ] **Step 4: Write the order detail page**

`src/app/[locale]/account/orders/[ref]/page.tsx`: `currentUser()` null →
redirect to sign-in. Otherwise `getOrderForUser`; null → `notFound()`.

**Read-only.** Render the timeline, the line items with quantity, unit price
and line total at the order's frozen rate where it has one, the total, the
courier and tracking number once shipped, a **Pay now** link to `payment_url`
while invoiced, and a **View invoice** link once an invoice number exists.

No forms, no buttons that change anything. If you find yourself adding one,
stop — every transition belongs to staff, and that is what keeps this phase
small.

- [ ] **Step 5: Verify**

Sign in as the account from Task 4. It has no orders, so confirm the empty
state first. Then attach an existing order to it:

```bash
docker exec isupply-db psql -U isupply -d isupply -c "UPDATE orders SET user_id = (SELECT id FROM users WHERE lower(email)='buyer@example.test') WHERE ref='ORD-7647RZ';"
```

Confirm:
1. `/en/account` lists `ORD-7647RZ` with its status pill and total.
2. `/en/account/orders/ORD-7647RZ` renders the timeline, the line item, the
   invoice link and the Pay now link.
3. `/en/account/orders/ORD-DH4XH5` is a **404** — that order belongs to nobody.
4. Sign out and load `/en/account/orders/ORD-7647RZ` — redirected to sign-in.
5. `/fa/account` renders right-to-left with Persian status words.

Leave the order attached; the next task uses it.

- [ ] **Step 6: Commit**

```bash
git add src/db/accountQueries.ts src/components/OrderTimeline.tsx "src/app/[locale]/account"
git commit -m "Show a customer their orders, read-only"
```

---

### Task 6: Checkout prefill, order linkage, and customer invoice access

**Files:**
- Modify: `src/app/[locale]/quote/page.tsx`, `src/app/actions.ts`, `src/app/[locale]/invoice/[ref]/page.tsx`, `src/app/[locale]/admin/actions.ts`, `src/app/[locale]/admin/page.tsx`, `src/lib/i18n.ts`

**Interfaces:**
- Consumes: `currentUser`, `currentUserId`; `findUserIdByEmail`, `setPassword`; `hashPassword`; `assertAdminWrite`.
- Produces: `resetCustomerPasswordAction`.

- [ ] **Step 1: Prefill checkout**

In `src/app/[locale]/quote/page.tsx`, call `currentUser()` and pass
`defaultValue` into the `Field` components for company, contact name, phone and
PO number (`user.defaultPoNumber`). `Field` currently takes no
`defaultValue` — add an optional prop and pass it through to the input.

Signed out, everything renders exactly as it does today.

- [ ] **Step 2: Stamp the order**

In `src/app/actions.ts`, `submitQuoteAction`: read `currentUserId()` and add
`user_id` to the INSERT column list, passing the id or `null`.

Guest checkout must keep working unchanged. Do not attempt to match a guest's
typed email against an existing account — without email verification that
would let anyone attach a stranger's order to themselves by typing their
address, and the spec rules it out explicitly.

- [ ] **Step 3: Open the invoice to its owner**

In `src/app/[locale]/invoice/[ref]/page.tsx`, replace the staff-only gate with:
staff (or `DEMO_MODE`) may read any invoice; a signed-in customer may read one
whose `user_id` matches theirs. Anything else is `notFound()`.

Fetch the order's `user_id` for this comparison — `getInvoiceByRef` does not
currently select it, so add `user_id AS "userId"` to that query and the type.

- [ ] **Step 4: Staff password reset**

Add to `src/app/[locale]/admin/actions.ts`:

```ts
/**
 * Generates a password, stores its hash, and hands the plaintext back exactly
 * once through the redirect so staff can read it out.
 *
 * There is no reset email in this version, so this is the only way back in for
 * a customer who has forgotten theirs. The plaintext is never stored and never
 * shown again — reloading the page loses it, which is the intended behaviour.
 */
export async function resetCustomerPasswordAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const email = String(formData.get("email") ?? "").trim();

  const userId = await findUserIdByEmail(email);
  if (!userId) redirect(`/${locale}/admin?error=no-account`);

  const generated = randomBytes(9).toString("base64url");
  await setPassword(userId, await hashPassword(generated));
  redirect(`/${locale}/admin?newPassword=${encodeURIComponent(generated)}`);
}
```

Add the imports it needs (`randomBytes` from `node:crypto`, `findUserIdByEmail`
and `setPassword` from `@/db/userQueries`, `hashPassword` from
`@/lib/password`).

- [ ] **Step 5: Render the reset control**

In `src/app/[locale]/admin/page.tsx`, on an order whose email has an account,
render a small form posting to `resetCustomerPasswordAction` with the email as
a hidden field, disabled under `DEMO_MODE`. Show the generated password from
`?newPassword=` in a prominent banner with a note that it will not be shown
again, and an error banner for `?error=no-account`.

Add both strings to both dictionaries:

```ts
  resetPassword: "Reset password",
  newPasswordOnce: "New password — copy it now, it will not be shown again:",
  noAccountForEmail: "No account exists for that email address.",
```

```ts
  resetPassword: "بازنشانی گذرواژه",
  newPasswordOnce: "گذرواژه جدید — همین حالا کپی کنید، دوباره نمایش داده نمی‌شود:",
  noAccountForEmail: "حسابی با این ایمیل وجود ندارد.",
```

Knowing which orders have an account needs one extra query — select the set of
`lower(email)` values present in `users` for the emails on the visible orders,
rather than a per-row lookup.

- [ ] **Step 6: Verify end to end**

1. Signed in, `/en/quote` prefills company, contact name and phone.
2. Submit an order while signed in; confirm in psql that its `user_id` is set
   and that it appears at `/en/account`.
3. Submit an order signed out; confirm `user_id` is null and it does **not**
   appear in the account list even though the email matches.
4. As the owner, open the invoice for `ORD-7647RZ` — it renders. Sign out and
   load the same URL — 404.
5. From `/en/admin` under `DEMO_MODE=0`, reset the customer's password, note
   the generated value, and sign in with it. **Do not type the admin password
   yourself** — if you cannot reach the signed-in admin page, exercise
   `resetCustomerPasswordAction`'s helpers from the command line instead and
   say so.

- [ ] **Step 7: Commit**

```bash
git add "src/app/[locale]/quote/page.tsx" src/app/actions.ts "src/app/[locale]/invoice" "src/app/[locale]/admin" src/db/invoiceQueries.ts src/lib/i18n.ts
git commit -m "Link orders to accounts, prefill checkout, open invoices to their owner"
```

---

## Phase 3 done

A customer can create an account, sign in, watch their orders, read their own
invoices and have checkout prefilled. Staff can reset a forgotten password.

Not built here: guest order tracking (Phase 4), password reset by email, email
verification, and rate limiting — all recorded in the spec's Known gaps.
