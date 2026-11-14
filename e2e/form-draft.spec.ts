import { test, expect } from "@playwright/test";
import type { Locale } from "../src/lib/i18n";
import { addToCart, checkoutSubmit, fillCheckout, localSql, setShelfOf, shelfFixtures, useClientAddress } from "./shop";

const sql = localSql();
test.afterAll(() => sql.end());

/**
 * Review R-13: a checkout the server refuses comes back with what was typed.
 * The browser's own "required" check is switched off for the one field left
 * empty, which is what an older browser or a changed cart amounts to.
 */
for (const locale of ["en", "fa"] as Locale[]) {
  test(`${locale}: a refused checkout keeps what was typed`, async ({ page }, testInfo) => {
    await useClientAddress(page, 140 + testInfo.workerIndex);
    const { onShelf } = await shelfFixtures(sql);
    await setShelfOf(sql, onShelf, true, 50);
    await addToCart(page, locale, onShelf.familySlug, { partNumber: onShelf.partNumber });
    await page.goto(`/${locale}/quote`);

    const company = `Draft Co ${Date.now()}`;
    await fillCheckout(page, { company, email: `draft-${Date.now()}@example.com`, address: "9 Kept Street" });
    await page.locator('textarea[name="notes"]').fill("Ring before delivery");
    await page.locator('input[name="city"]').evaluate((el) => el.removeAttribute("required"));
    await checkoutSubmit(page, locale).click();

    await expect(page).toHaveURL(/\/quote\?error=missing/);
    await expect(page.locator('input[name="company"]')).toHaveValue(company);
    await expect(page.locator('input[name="contactName"]')).toHaveValue("Checkout Test");
    await expect(page.locator('input[name="phone"]')).toHaveValue("+1 555 0100");
    await expect(page.locator('input[name="address"]')).toHaveValue("9 Kept Street");
    await expect(page.locator('textarea[name="notes"]')).toHaveValue("Ring before delivery");

    // A fresh visit starts clean.
    await page.goto(`/${locale}/quote`);
    await expect(page.locator('input[name="company"]')).toHaveValue("");
  });
}
