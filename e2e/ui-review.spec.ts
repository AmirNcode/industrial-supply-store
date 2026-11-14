import { test, expect } from "@playwright/test";
import { getDict } from "../src/lib/i18n";

/** Review R-30: the tab title and search snippet are in the page's language. */
for (const locale of ["en", "fa"] as const) {
  test(`${locale}: the page title and description are in its language`, async ({ page }) => {
    const t = getDict(locale);
    await page.goto(`/${locale}`);
    await expect(page).toHaveTitle(`${t.brand} — ${t.tagline}`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", t.metaDescription);
  });
}

/**
 * Review R-15: on a touch screen the menu button answers a 44px touch although
 * it is drawn 35px wide. Checked by asking the browser what sits 20px to the
 * side of its centre — outside the drawn button, inside the touch area.
 */
test("the phone menu button has a 44px touch area", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Touch areas only apply on touch screens.");
  const t = getDict("en");
  await page.goto("/en");
  const button = page.getByRole("button", { name: t.browseCatalog }).first();
  const box = (await button.boundingBox())!;
  expect(box.width).toBeLessThan(44);
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") ?? null,
    [box.x + box.width / 2 - 20, box.y + box.height / 2],
  );
  expect(hit).toBe(t.browseCatalog);
});
