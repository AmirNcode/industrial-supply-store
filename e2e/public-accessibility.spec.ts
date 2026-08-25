import { test, expect } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { expectNoAccessibilityViolations } from "./accessibility";

const locales: Locale[] = ["en", "fa"];
const familySlug = "oil-resistant-buna-n-o-rings";

for (const locale of locales) {
  test(`${locale}: public navigation does not expose the admin route`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.locator('a[href*="/admin"]')).toHaveCount(0);
  });

  test(`${locale}: catalog and family meet the automated WCAG A/AA gate`, async ({ page }, testInfo) => {
    await page.goto(`/${locale}`);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr");
    await expectNoAccessibilityViolations(page, testInfo);

    await page.goto(`/${locale}/f/${familySlug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page, testInfo);
  });

  test(`${locale}: autocomplete exposes and operates the combobox pattern`, async ({ page }) => {
    const t = getDict(locale);
    await page.goto(`/${locale}`);

    const search = page.getByRole("combobox", { name: t.search });
    await search.fill("oring");
    const listbox = page.getByRole("listbox", { name: t.search });
    await expect(listbox).toBeVisible();
    await expect(search).toHaveAttribute("aria-expanded", "true");
    const listboxId = await listbox.getAttribute("id");
    expect(listboxId).toBeTruthy();
    await expect(search).toHaveAttribute("aria-controls", listboxId!);

    await search.press("ArrowDown");
    const activeId = await search.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    await expect(listbox.getByRole("option", { selected: true })).toHaveAttribute(
      "id",
      activeId!,
    );

    await search.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(search).toBeFocused();

    await search.fill("oring ");
    await expect(listbox).toBeVisible();
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${locale}/(?:c|f)/`));
  });

  test(`${locale}: mobile navigation and filters contain and restore focus`, async (
    { page, isMobile },
    testInfo,
  ) => {
    test.skip(!isMobile, "Mobile overlays are not rendered in the desktop layout.");
    const t = getDict(locale);
    await page.goto(`/${locale}`);

    const menuButton = page.getByRole("button", { name: t.browseCatalog });
    await menuButton.click();
    const menu = page.getByRole("dialog", { name: t.browseCatalog });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("link").first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(menu.getByRole("link").last()).toBeFocused();
    await expectNoAccessibilityViolations(page, testInfo, '[role="dialog"]');
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(menuButton).toBeFocused();

    await page.goto(`/${locale}/f/${familySlug}`);
    const filterButton = page.getByRole("button", {
      name: new RegExp(t.filterBy, locale === "en" ? "i" : undefined),
    });
    await filterButton.click();
    const sheet = page.getByRole("dialog", { name: t.filterBy });
    const close = sheet.getByRole("button", { name: t.done });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(sheet.locator("button").last()).toBeFocused();
    await expectNoAccessibilityViolations(page, testInfo, '[role="dialog"]');
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(filterButton).toBeFocused();
  });
}
