import "dotenv/config";
import { expect, type Page } from "@playwright/test";
import postgres, { type Sql } from "postgres";
import { getDict, type Locale } from "../src/lib/i18n";
import { CLIENT_ADDRESS_HEADER } from "./clientAddress";

export const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "ci-admin-password";

/** A pay link is a 64-hex key; `?placed=1` is how checkout lands on it. */
export const PAY_URL = /\/pay\/[0-9a-f]{64}\?placed=1$/;

/**
 * A connection for specs that need to set up or read back data. Like the
 * product-creation spec, it refuses anything but this machine's database.
 */
export function localSql() {
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("These browser tests require an isolated local DATABASE_URL.");
  }
  return postgres(url, { max: 1 });
}

/** Separate rate-limit buckets per spec and worker; see clientAddress.ts. */
export async function useClientAddress(page: Page, octet: number): Promise<void> {
  await page.setExtraHTTPHeaders({ [CLIENT_ADDRESS_HEADER]: `203.0.113.${octet}` });
}

/**
 * An address no earlier run has used. Customer sign-in steps are limited per
 * address for 15 minutes, which a few reruns of a spec would otherwise trip.
 */
export function freshClientAddress(): string {
  const octet = () => 1 + Math.floor(Math.random() * 254);
  return `198.18.${octet()}.${octet()}`;
}

export const freshAddressHeader = () => ({ [CLIENT_ADDRESS_HEADER]: freshClientAddress() });

export async function adminSignIn(page: Page, locale: Locale): Promise<void> {
  const t = getDict(locale);
  await page.goto(`/${locale}/admin/login`);
  await page.getByLabel(t.password).fill(adminPassword);
  await page.getByRole("button", { name: t.signIn }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin/orders`));
}

function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

/**
 * Puts one product into the cart from its family page. Without a part number
 * it takes the first row, as the original specs did.
 */
export async function addToCart(
  page: Page,
  locale: Locale,
  familySlug: string,
  options: { partNumber?: string; qty?: string } = {},
): Promise<void> {
  const t = getDict(locale);
  const query = options.partNumber ? `?pn=${encodeURIComponent(options.partNumber)}` : "";
  await page.goto(`/${locale}/f/${familySlug}${query}`);
  // Ordering lives in the expanded row, not in a column of the grid, so the
  // part number has to be opened before there is a quantity to fill.
  const toggle = options.partNumber
    ? page.locator("label.row-expand").filter({ hasText: exactly(options.partNumber) })
    : page.locator("label.row-expand");
  await toggle.first().click();
  const quantity = page.getByRole("spinbutton", { name: new RegExp(t.qty) }).first();
  const add = page.getByRole("button", { name: t.addToOrder }).first();
  await quantity.fill(options.qty ?? "1");
  await add.click();
  // The local request can finish between two assertions, so wait for the
  // durable success state rather than the transient busy attribute.
  await expect(add).toHaveText("✓");
}

export type CheckoutDetails = {
  company: string;
  contactName?: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
};

/** The guest checkout form, every required field filled unless left out on purpose. */
export async function fillCheckout(page: Page, details: CheckoutDetails): Promise<void> {
  await page.locator('input[name="company"]').fill(details.company);
  await page.locator('input[name="contactName"]').fill(details.contactName ?? "Checkout Test");
  await page.locator('input[name="email"]').fill(details.email);
  await page.locator('input[name="phone"]').fill(details.phone ?? "+1 555 0100");
  if (details.address !== undefined) await page.locator('input[name="address"]').fill(details.address);
  if (details.city !== undefined) await page.locator('input[name="city"]').fill(details.city);
}

/** From the cart page, whichever way the cart splits: CHECKOUT or REQUEST QUOTE. */
export function cartContinueLink(page: Page, locale: Locale) {
  const t = getDict(locale);
  return page.getByRole("link", { name: new RegExp(`^(${t.checkout}|${t.requestQuote})$`) });
}

/** The checkout form's submit button: PLACE ORDER or the quote-request label. */
export function checkoutSubmit(page: Page, locale: Locale) {
  const t = getDict(locale);
  return page.getByRole("button", { name: new RegExp(`^(${t.placeOrder}|${t.submitRequest})$`) });
}

const LATIN_DIGITS = (text: string) =>
  text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/**
 * Locally nothing is emailed: every message is kept in the admin email log.
 * This reads the newest sign-in code sent to `email` from it, with an admin
 * session of its own so the customer's browser stays signed out of the panel.
 */
export async function readLoginCode(admin: Page, locale: Locale, email: string): Promise<string> {
  const t = getDict(locale);
  await admin.goto(`/${locale}/admin/emails`);
  const row = admin.locator("tr").filter({ hasText: email }).filter({ hasText: "login-code" }).first();
  await expect(row).toBeVisible();
  await row.getByText(t.emailShowBody).click();
  const body = LATIN_DIGITS(await row.locator("pre").innerText());
  const code = body.match(/(?<!\d)\d{6}(?!\d)/)?.[0];
  if (!code) throw new Error(`No 6-digit code in the sign-in email for ${email}.`);
  return code;
}

export type NewAccount = { email: string; password: string; accountNumber: string; company: string };

/**
 * A customer joins the way the site now lets them: no password at sign-up, a
 * code from the email, then a password of their own. Ends on the account page.
 */
export async function signUpWithCode(
  customer: Page,
  admin: Page,
  locale: Locale,
  stamp: string,
): Promise<NewAccount> {
  const t = getDict(locale);
  const email = `e2e-${stamp}@example.com`;
  const company = `E2E Account Co ${stamp}`;
  const password = `Customer-${stamp}-9!`;
  const phone = `0912${String(Date.now()).slice(-7)}`;

  await customer.goto(`/${locale}/account/signup`);
  await customer.locator('input[name="email"]').fill(email);
  await customer.locator('input[name="company"]').fill(company);
  await customer.locator('input[name="contactName"]').fill("E2E Buyer");
  await customer.locator('input[name="phone"]').fill(phone);
  await customer.getByRole("button", { name: t.signUp, exact: true }).click();
  await expect(customer).toHaveURL(new RegExp(`/${locale}/account/signin/code`));

  const code = await readLoginCode(admin, locale, email);
  await customer.locator('input[name="code"]').fill(code);
  await customer.getByRole("button", { name: t.signInContinue }).click();
  await expect(customer).toHaveURL(new RegExp(`/${locale}/account/password/new`));

  await customer.locator('input[name="newPassword"]').fill(password);
  await customer.locator('input[name="passwordAgain"]').fill(password);
  await customer.getByRole("button", { name: t.savePassword }).click();
  await expect(customer).toHaveURL(new RegExp(`/${locale}/account(\\?|$)`));
  const accountNumber = (await customer.getByTestId("customer-id").innerText()).trim();
  return { email, password, accountNumber, company };
}

export type Fixture = { familySlug: string; partNumber: string };

/**
 * Stock is set here, on two products of the spec's own choosing, rather than
 * read from whatever the database holds: a fresh CI database has no stock
 * counts and the local demo seed has some, and a pish-factor needs the goods
 * on the shelf. Two products, so the instant and quote tests cannot undo each
 * other when they run side by side. Families the other specs depend on are
 * left alone.
 */
export async function shelfFixtures(sql: Sql): Promise<{ onShelf: Fixture; supplier: Fixture }> {
  const rows = await sql<{ slug: string; part: string }[]>`
    SELECT DISTINCT ON (f.id) f.slug, p.part_number AS part
    FROM products p JOIN product_families f ON f.id = p.family_id
    WHERE p.price_cents > 0 AND f.slug NOT LIKE 'e2e-%'
      AND f.slug NOT IN ('oil-resistant-buna-n-o-rings', 'wire-markers')
    ORDER BY f.id, p.id
    LIMIT 2
  `;
  if (rows.length < 2) throw new Error("The catalog needs two priced products in different families.");
  const [a, b] = rows.map((r) => ({ familySlug: r.slug, partNumber: r.part }));
  return { onShelf: a, supplier: b };
}

export async function setShelfOf(
  sql: Sql,
  fixture: Fixture,
  inStock: boolean,
  available: number,
): Promise<void> {
  await sql`
    UPDATE products SET in_stock = ${inStock}, inventory_available = ${available}
    WHERE part_number = ${fixture.partNumber}
      AND family_id = (SELECT id FROM product_families WHERE slug = ${fixture.familySlug})
  `;
}

/**
 * Places an order for goods on the shelf as a guest and returns the pay page's
 * address. Used by specs that need a real pay page to look at.
 */
export async function placeInstantOrder(
  page: Page,
  locale: Locale,
  sql: Sql,
  marker: string,
): Promise<string> {
  const { onShelf } = await shelfFixtures(sql);
  await setShelfOf(sql, onShelf, true, 50);
  await addToCart(page, locale, onShelf.familySlug, { partNumber: onShelf.partNumber });
  await page.goto(`/${locale}/quote`);
  await fillCheckout(page, {
    company: marker,
    email: `${marker.toLowerCase()}@example.com`,
    address: "7 Public Page Road",
    city: "Tehran",
  });
  await checkoutSubmit(page, locale).click();
  await expect(page).toHaveURL(PAY_URL);
  return page.url();
}
