import { test, expect, type Page } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { hashPassword } from "../src/lib/password";
import { normalizeRepPassword } from "../src/lib/repPassword";
import { randomReferralCode } from "../src/lib/repAccount";
import { addToCart, adminSignIn, freshAddressHeader, localSql, signUpWithCode } from "./shop";

/**
 * iOS Safari zooms the page when a focused control's text is under 16px, and
 * does not zoom back out. The rule that prevents it is one media query in
 * globals.css (review R-7); this walks every area of the site at phone width
 * and fails on any control a person types or picks in that is smaller, so a
 * new compact editor cannot bring the zoom back unnoticed. It reads computed
 * style, which is also set on controls inside closed sheets and `<details>`.
 */
const locales: Locale[] = ["en", "fa"];
const familySlug = "oil-resistant-buna-n-o-rings";
const REP_PASSWORD = "Rep-Phone-Size-9!";
const sql = localSql();
const repIds: string[] = [];

test.use({ viewport: { width: 375, height: 812 } });
test.afterAll(async () => {
  if (repIds.length) await sql`DELETE FROM sales_reps WHERE id = ANY(${repIds}::uuid[])`;
  await sql.end();
});

async function smallControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const skipped = ["hidden", "checkbox", "radio", "file", "range", "color", "submit", "button", "reset", "image"];
    return [...document.querySelectorAll<HTMLInputElement>("input, select, textarea")]
      .filter((el) => !skipped.includes(el.type))
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()}[type=${el.type}] name=${el.name} class=${el.className} ${getComputedStyle(el).fontSize}`);
  });
}

async function expectNoSmallControls(page: Page, paths: string[]): Promise<void> {
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
    expect(await smallControls(page), `${path} has a control under 16px`).toEqual([]);
  }
}

for (const locale of locales) {
  test(`${locale}: no typed control is under 16px on a phone — storefront and checkout`, async ({ page, isMobile }) => {
    test.skip(!isMobile, "The rule applies at phone widths only.");
    await page.setExtraHTTPHeaders(freshAddressHeader());
    await expectNoSmallControls(
      page,
      ["", "/c/sealing", "/l/sealing", `/f/${familySlug}`, "/search?q=ring", "/track", "/quick-order", "/cart",
        "/account/signin", "/account/signup", "/admin/login", "/rep/signin"].map((p) => `/${locale}${p}`),
    );
    await addToCart(page, locale, familySlug);
    await expectNoSmallControls(page, [`/${locale}/cart`, `/${locale}/quote`]);
    await expect(page).toHaveURL(new RegExp(`/${locale}/quote`));
  });

  test(`${locale}: no typed control is under 16px on a phone — account, admin and rep portal`, async ({ browser, isMobile }, testInfo) => {
    test.skip(!isMobile, "The rule applies at phone widths only.");
    const context = () => browser.newContext({ extraHTTPHeaders: freshAddressHeader(), viewport: { width: 375, height: 812 } });
    const stamp = `${locale}${testInfo.workerIndex}${Date.now()}`;

    const adminContext = await context();
    const admin = await adminContext.newPage();
    await adminSignIn(admin, locale);
    await expectNoSmallControls(
      admin,
      ["orders", "customers", "reps", "products", "settings", "emails"].map((p) => `/${locale}/admin/${p}`),
    );

    const customerContext = await context();
    const customer = await customerContext.newPage();
    await signUpWithCode(customer, admin, locale, stamp);
    await expectNoSmallControls(customer, [`/${locale}/account`, `/${locale}/account/password`]);

    const username = `phone-size-${stamp}`;
    const [rep] = await sql<{ id: string }[]>`
      INSERT INTO sales_reps (username, password_hash, name, phone, commission_rate_bp, referral_code, must_change_password)
      VALUES (${username}, ${await hashPassword(normalizeRepPassword(REP_PASSWORD))}, 'Phone Size', '09120000000', 300,
              ${randomReferralCode()}, false)
      RETURNING id`;
    repIds.push(rep.id);
    const repContext = await context();
    const repPage = await repContext.newPage();
    await repPage.goto(`/${locale}/rep/signin`);
    await repPage.locator('input[name="username"]').fill(username);
    await repPage.locator('input[name="password"]').fill(REP_PASSWORD);
    await repPage.getByRole("button", { name: getDict(locale).signInTitle }).click();
    await expect(repPage).toHaveURL(new RegExp(`/${locale}/rep(\\?|$)`));
    await expectNoSmallControls(
      repPage,
      ["", "/customers", "/customers/new", "/orders", "/commission"].map((p) => `/${locale}/rep${p}`),
    );

    await Promise.all([adminContext.close(), customerContext.close(), repContext.close()]);
  });
}
