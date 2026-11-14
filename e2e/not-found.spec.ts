import { test, expect } from "@playwright/test";
import { systemText } from "../src/lib/i18nSystem";

/**
 * Review R-9: a dead link answers 404 in the visitor's language, inside the
 * site's header and footer, with a way back — whether a page said "not found"
 * (a product family that does not exist) or no page matched the address.
 */
for (const locale of ["en", "fa"] as const) {
  for (const path of ["f/no-such-family-e2e", "no/such/page"]) {
    test(`${locale}: /${path} is a localized 404`, async ({ page }) => {
      const { t } = systemText(locale);
      const response = await page.goto(`/${locale}/${path}`);
      expect(response?.status()).toBe(404);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1, name: t.notFoundTitle })).toBeVisible();
      await expect(page.getByRole("banner").first()).toBeVisible();
      await page.getByRole("link", { name: t.toHome }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}$`));
    });
  }
}
