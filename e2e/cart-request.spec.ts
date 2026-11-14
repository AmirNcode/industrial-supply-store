import { test, expect } from "@playwright/test";
import type { Locale } from "../src/lib/i18n";
import { addToCart, localSql, shelfFixtures, useClientAddress } from "./shop";

const sql = localSql();
test.afterAll(() => sql.end());

/**
 * Review R-10: a visitor who has never added anything costs no cart request,
 * however many pages they open; once they have a cart the badge still follows
 * them from page to page.
 */
for (const locale of ["en", "fa"] as Locale[]) {
  test(`${locale}: the cart is only asked for once a visitor has one`, async ({ page }, testInfo) => {
    await useClientAddress(page, 120 + testInfo.workerIndex);
    const cartReads: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "GET" && new URL(request.url()).pathname === "/api/cart") {
        cartReads.push(request.url());
      }
    });
    const { onShelf } = await shelfFixtures(sql);

    await page.goto(`/${locale}`);
    await page.goto(`/${locale}/f/${onShelf.familySlug}`);
    // The add working proves the page's scripts ran, CartSync among them, so
    // "no request yet" is a real answer rather than a page still loading.
    // (Waiting for a quiet network is no use: the footer's seal image hangs.)
    await addToCart(page, locale, onShelf.familySlug, { partNumber: onShelf.partNumber });
    expect(cartReads).toHaveLength(0);

    const read = page.waitForRequest(
      (request) => request.method() === "GET" && new URL(request.url()).pathname === "/api/cart",
    );
    await page.goto(`/${locale}`);
    await read;
    // The badge is the cart link's count; it only appears from a real answer.
    const cartLink = page.locator(`a[href="/${locale}/cart"]`).filter({ visible: true }).first();
    await expect(cartLink).toContainText(/[1۱]/);
  });
}
