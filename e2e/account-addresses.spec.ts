import { test, expect } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { expectNoAccessibilityViolations } from "./accessibility";
import { addToCart, adminSignIn, freshAddressHeader, signUpWithCode } from "./shop";

const locales: Locale[] = ["en", "fa"];
const familySlug = "oil-resistant-buna-n-o-rings";

for (const locale of locales) {
  test(`${locale}: a saved delivery address is offered at checkout`, async ({ browser, isMobile }, testInfo) => {
    test.skip(isMobile, "The desktop project covers the account flow.");
    const t = getDict(locale);
    const stamp = `${locale}${testInfo.workerIndex}${Date.now().toString(36)}`;
    const addressName = `Warehouse ${stamp}`;
    const street = `${stamp} Industrial Road`;

    const adminContext = await browser.newContext({ extraHTTPHeaders: freshAddressHeader() });
    const admin = await adminContext.newPage();
    await adminSignIn(admin, locale);
    const customerContext = await browser.newContext({ extraHTTPHeaders: freshAddressHeader() });
    const customer = await customerContext.newPage();
    await signUpWithCode(customer, admin, locale, stamp);

    // A new account has no address; add one from the account page.
    const section = customer.locator("#addresses");
    if (!(await section.evaluate((el: HTMLDetailsElement) => el.open))) {
      await section.locator("summary").first().click();
    }
    await expect(section.getByText(t.noAddresses)).toBeVisible();
    await section.locator('input[name="label"]').fill(addressName);
    await section.locator('input[name="recipient"]').fill("E2E Receiver");
    await section.locator('[name="address"]').fill(street);
    await section.locator('input[name="city"]').fill("Karaj");
    await section.getByRole("button", { name: t.saveProfile }).click();
    await expect(customer).toHaveURL(/ok=address/);
    await expect(customer.locator("#addresses")).toContainText(street);
    await expect(customer.locator("#addresses").getByText(t.defaultAddress, { exact: true })).toBeVisible();
    await expectNoAccessibilityViolations(customer, testInfo, "#addresses");

    // Checkout offers it, chosen by default, with the typed fields left for "a different address".
    await addToCart(customer, locale, familySlug);
    await customer.goto(`/${locale}/quote`);
    const saved = customer.locator('input[name="addressChoice"]');
    await expect(saved).toHaveCount(2);
    await expect(saved.first()).toBeChecked();
    await expect(customer.getByText(addressName)).toBeVisible();
    await expect(customer.getByText(street)).toBeVisible();
    await expect(customer.getByText(t.addressChoiceNew)).toBeVisible();
    await expect(customer.locator('input[name="address"]')).not.toHaveAttribute("required", "");
    await expectNoAccessibilityViolations(customer, testInfo);

    await Promise.all([adminContext.close(), customerContext.close()]);
  });
}
