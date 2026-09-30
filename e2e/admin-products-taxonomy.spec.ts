import { test, expect } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { expectNoAccessibilityViolations } from "./accessibility";
import { CLIENT_ADDRESS_HEADER } from "./clientAddress";

const locales: Locale[] = ["en", "fa"];

async function openProducts(
  page: import("@playwright/test").Page,
  locale: Locale,
  testAddress: string,
) {
  const t = getDict(locale);
  await page.setExtraHTTPHeaders({ [CLIENT_ADDRESS_HEADER]: testAddress });
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
  const hideCategory = category.locator("..").getByRole("button", {
    name: t.taxonomyHideFromCatalog.replace("{name}", "O-Rings"),
  });
  await expect(hideCategory).toBeVisible();
  await hideCategory.click();
  await expect(category.locator("..").getByRole("button", {
    name: t.taxonomyShowInCatalog.replace("{name}", "O-Rings"),
  })).toBeVisible();
  await expect(saveBar).toBeVisible();
  await page.getByRole("button", { name: t.taxonomyDone, exact: true }).click();
  await expect(category.locator("..").getByRole("img", { name: t.catalogHidden })).toBeVisible();
  await saveBar.getByRole("button", { name: t.orderDiscard }).click();
  await expect(saveBar).toBeHidden();
  await expect(category.locator("..").getByRole("img", { name: t.catalogHidden })).toBeHidden();
  await page.getByRole("button", { name: t.taxonomyArrange, exact: true }).click();
  await expect(hideCategory).toBeVisible();

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

test("a family row opens an add-a-product form built from its own columns", async (
  { page, isMobile },
  testInfo,
) => {
  test.skip(isMobile, "The inline family rows this link sits on are desktop controls.");
  const locale: Locale = "en";
  const t = getDict(locale);
  await openProducts(page, locale, `203.0.113.${80 + testInfo.workerIndex}`);

  await page.getByRole("searchbox", { name: t.taxonomyFindCategory }).fill("o-ring");
  const category = page
    .locator(".taxonomy-tree-row:not(.is-family) .taxonomy-node-name")
    .filter({ hasText: /^O-Rings$/ });
  await category.click();

  await page.getByRole("link", { name: t.newProduct }).first().click();
  await expect(page).toHaveURL(/\/admin\/products\/\d+\/new$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Add a product to");

  // The part number is optional here, exactly as a blank cell is in a file.
  await expect(page.getByLabel(t.partNumber)).toBeVisible();
  await expect(page.getByText(t.newProductPartNumberHint).first()).toBeVisible();

  // Nothing is written: a rejected entry stays on screen to be corrected.
  await page.getByLabel(t.price, { exact: true }).fill("not-a-price");
  await page.getByRole("button", { name: t.newProduct }).click();
  await expect(page.getByText(t.newProductBadPrice)).toBeVisible();
});

test("a family's product table edits in place, refuses a bad cell, and saves", async (
  { page, isMobile },
  testInfo,
) => {
  test.skip(isMobile, "The tree rail and the wide product table are desktop controls.");
  const locale: Locale = "en";
  const t = getDict(locale);
  await openProducts(page, locale, `203.0.113.${100 + testInfo.workerIndex}`);

  await page.getByRole("searchbox", { name: t.taxonomyFindCategory }).fill("o-ring");
  await page.locator(".taxonomy-tree-row.is-family .taxonomy-node-name").first().click();
  await expect(page).toHaveURL(/cat=f(%3A|:)\d+$/);
  // The tree writes `f%3A12`, a plain link `f:12`: the same address.
  const familyId = /cat=f(?:%3A|:)(\d+)$/.exec(page.url())![1];
  const familyUrl = new RegExp(`cat=f(%3A|:)${familyId}$`);
  const table = page.locator(".product-table");
  await expect(table).toBeVisible();

  // Part number and the family's first column lead; stock and price follow.
  const headers = await table.locator("thead th").allInnerTexts();
  expect(headers[0]).toBe(t.partNumber);
  expect(headers.slice(2, 4)).toEqual([t.productsQty, t.productsPriceUsd]);

  const edit = page.getByRole("button", { name: t.productsEdit, exact: true });
  const save = page.getByRole("button", { name: t.productsSave, exact: true });
  const discard = page.getByRole("button", { name: t.orderDiscard, exact: true });
  await edit.click();
  await expect(edit).toBeHidden();
  await expect(save).toBeVisible();
  await expect(discard).toBeVisible();
  await expectNoAccessibilityViolations(page, testInfo, ".taxonomy-pane");

  // Not the first row: the order tests buy that product in parallel, and an
  // order moving its stock mid-edit is refused as stale — correctly.
  const row = table.locator("tbody tr").nth(20);
  const partNumber = (await row.locator("th").innerText()).trim();
  const price = page.getByLabel(`${t.productsPriceUsd} — ${partNumber}`, { exact: true });
  const original = await price.inputValue();

  // One bad cell refuses the whole save and is marked.
  await price.fill("not-a-price");
  await save.click();
  await expect(page.locator(".taxonomy-error-banner")).toContainText(
    t.productsInvalid.replace("{n}", "1"),
  );
  await expect(price).toHaveAttribute("aria-invalid", "true");

  const changed = (Number(original) + 0.01).toFixed(2);
  await price.fill(changed);
  await save.click();
  await expect(page.locator(".taxonomy-success-banner")).toContainText(
    t.productsSaved.replace("{n}", "1"),
  );
  await expect(edit).toBeVisible();
  await expect(row).toContainText(changed);

  // Put it back, the same way.
  await edit.click();
  await price.fill(original);
  await save.click();
  await expect(row).toContainText(original);

  // Unsaved rows are guarded when another family is picked in the tree.
  await edit.click();
  await price.fill(changed);
  await page.locator(".taxonomy-tree-row.is-family .taxonomy-node-name").nth(1).click();
  const guard = page.getByRole("dialog", { name: t.productsUnsavedTitle });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: t.orderStay }).click();
  await expect(page).toHaveURL(familyUrl);
  await discard.click();
  await expect(edit).toBeVisible();

  // The columns page returns to this same family.
  await page.getByRole("link", { name: t.editColumns }).first().click();
  await expect(page).toHaveURL(/\/admin\/products\/\d+\/columns$/);
  await page.getByRole("link", { name: t.columnsBack }).click();
  await expect(page).toHaveURL(familyUrl);
  await expect(table).toBeVisible();
});
