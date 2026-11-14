import { test, expect } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { localSql, shelfFixtures, useClientAddress } from "./shop";

const sql = localSql();
test.afterAll(() => sql.end());

/**
 * Review R-12: a refused add says so. The refusals are faked at the network
 * edge — filling a real cart to its 250-line limit, or tripping the rate limit,
 * would take hundreds of requests per run.
 */
for (const locale of ["en", "fa"] as Locale[]) {
  test(`${locale}: a refused add to the order is explained`, async ({ page }, testInfo) => {
    await useClientAddress(page, 130 + testInfo.workerIndex);
    const t = getDict(locale);
    const { onShelf } = await shelfFixtures(sql);
    let status = 409;
    await page.route("**/api/cart", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status, contentType: "application/json", body: "{}" })
        : route.fallback(),
    );

    await page.goto(`/${locale}/f/${onShelf.familySlug}?pn=${encodeURIComponent(onShelf.partNumber)}`);
    await page.locator("label.row-expand").first().click();
    const add = page.getByRole("button", { name: t.addToOrder }).first();
    const notice = page.getByRole("alert").filter({ hasText: /\S/ });

    await add.click();
    await expect(notice).toContainText(t.cartFailFull.split("{max}")[0]);

    status = 429;
    await add.click();
    await expect(notice).toContainText(t.cartFailBusy);

    status = 500;
    await add.click();
    await expect(notice).toContainText(t.cartFailGeneric);
    await page.getByRole("button", { name: t.cartFailDismiss }).click();
    await expect(notice).toHaveCount(0);
  });
}
