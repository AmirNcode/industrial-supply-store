import { test, expect } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { expectNoAccessibilityViolations } from "./accessibility";

const locales: Locale[] = ["en", "fa"];

async function openProducts(
  page: import("@playwright/test").Page,
  locale: Locale,
  testAddress: string,
) {
  const t = getDict(locale);
  await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": testAddress });
  await page.goto(`/${locale}/admin/products`);
  if (page.url().includes("/admin/login")) {
    await page.getByLabel(t.password).fill(process.env.E2E_ADMIN_PASSWORD ?? "ci-admin-password");
    await page.getByRole("button", { name: t.signIn }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/orders`));
    await page.goto(`/${locale}/admin/products`);
  }
}

for (const locale of locales) {
  test(`${locale}: products taxonomy selection survives URL navigation`, async (
    { page, isMobile },
    testInfo,
  ) => {
    const t = getDict(locale);
    await openProducts(
      page,
      locale,
      `203.0.113.${20 + testInfo.workerIndex + (locale === "fa" ? 10 : 0)}`,
    );
    await expect(page.locator(".taxonomy-card")).toBeVisible();
    await expect(page).toHaveURL(/\?cat=c%3A\d+|\?cat=c:\d+/);

    if (isMobile) {
      const picker = page.getByLabel(t.taxonomyChooseNode);
      await expect(picker).toBeVisible();
      const familyValue = await picker.locator('option[value^="f:"]').first().getAttribute("value");
      expect(familyValue).toBeTruthy();
      await picker.selectOption(familyValue!);
    } else {
      await expect(page.locator(".taxonomy-rail")).toBeVisible();
      const search = page.getByRole("searchbox", { name: t.taxonomyFindCategory });
      await search.fill("o-ring");
      const family = page.locator(".taxonomy-tree-row.is-family .taxonomy-node-name").first();
      await expect(family).toBeVisible();
      await family.click();
    }

    await expect(page).toHaveURL(/\?cat=f%3A\d+|\?cat=f:\d+/);
    await expect(page.getByRole("heading", { name: t.taxonomyCatalogImport })).toBeVisible();
    await expectNoAccessibilityViolations(page, testInfo, ".taxonomy-card");

    await page.goBack();
    await expect(page).toHaveURL(/\?cat=c%3A\d+|\?cat=c:\d+/);
  });
}

test("products taxonomy stages and discards reversible work without writing", async (
  { page, isMobile },
  testInfo,
) => {
  test.skip(isMobile, "The fixed tree rail and inline family rows are desktop controls.");
  const locale: Locale = "en";
  const t = getDict(locale);
  await openProducts(page, locale, `203.0.113.${60 + testInfo.workerIndex}`);

  await page.getByRole("searchbox", { name: t.taxonomyFindCategory }).fill("o-ring");
  const category = page
    .locator(".taxonomy-tree-row:not(.is-family) .taxonomy-node-name")
    .filter({ hasText: /^O-Rings$/ });
  await expect(category).toBeVisible();
  await category.click();

  const addSubcategory = page.getByRole("button", { name: t.taxonomyAddSubcategory });
  const addFamily = page.getByRole("button", { name: t.taxonomyAddFamily });
  await expect(addSubcategory).toBeDisabled();
  await expect(addFamily).toBeEnabled();
  await expect(page.locator(".taxonomy-rule-banner")).toContainText("holds product families");

  await addFamily.click();
  const createForm = page.locator(".taxonomy-create-form");
  await expect(createForm).toContainText(t.taxonomyNewFamily);
  await createForm.getByRole("button", { name: t.fxCancel }).click();
  await expect(createForm).toBeHidden();

  await page.getByRole("button", { name: t.taxonomyEditImageText }).first().click();
  const editor = page.locator(".taxonomy-media-editor");
  await editor.getByRole("textbox").fill("Temporary browser QA description");
  await editor.getByRole("button", { name: t.taxonomySaveImageText }).click();
  const saveBar = page.locator(".taxonomy-save-bar");
  await expect(saveBar).toBeVisible();
  await saveBar.getByRole("button", { name: t.orderDiscard }).click();
  await expect(saveBar).toBeHidden();

  await page.getByRole("button", { name: t.taxonomyArrange, exact: true }).click();
  const secondFamily = page.locator(".taxonomy-family-row").nth(1);
  await secondFamily
    .locator(".taxonomy-move-buttons")
    .getByRole("button", { name: t.columnsMoveDown })
    .click();
  await expect(saveBar).toBeVisible();

  await secondFamily.getByRole("link", { name: t.editColumns }).click();
  const guard = page.getByRole("dialog", { name: t.taxonomyUnsavedTitle });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: t.orderStay }).click();
  await expect(guard).toBeHidden();

  await saveBar.getByRole("button", { name: t.orderDiscard }).click();
  await expect(saveBar).toBeHidden();
  await expectNoAccessibilityViolations(page, testInfo, ".taxonomy-card");
});
