import { test, expect } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { expectNoAccessibilityViolations } from "./accessibility";
import { adminSignIn, freshAddressHeader, signUpWithCode } from "./shop";

const locales: Locale[] = ["en", "fa"];

/**
 * A customer account without ever being given or choosing a password at
 * sign-up: the emailed code proves the address, the password comes after, and
 * later visits use the two-step form (who you are, then the password).
 */
for (const locale of locales) {
  test(`${locale}: sign up with an emailed code, choose a password, sign in again`, async (
    { browser, isMobile },
    testInfo,
  ) => {
    test.skip(isMobile, "The sign-in rules do not depend on the device.");
    const t = getDict(locale);
    const stamp = `${locale}${testInfo.workerIndex}${Date.now().toString(36)}`;

    const adminContext = await browser.newContext({ extraHTTPHeaders: freshAddressHeader() });
    const admin = await adminContext.newPage();
    await adminSignIn(admin, locale);

    const customerContext = await browser.newContext({ extraHTTPHeaders: freshAddressHeader() });
    const customer = await customerContext.newPage();
    const account = await signUpWithCode(customer, admin, locale, stamp);

    // The account number is shown, and is the last seven digits of the phone.
    await expect(customer.getByTestId("customer-id")).toHaveText(account.accountNumber);
    expect(account.accountNumber).toMatch(/^[0-9۰-۹]{7}$/);

    // Signed out, then back in: identifier first, then the password.
    await customer.getByRole("button", { name: t.signOut }).click();
    // Sign-out sends the visitor home; leaving before that lands would cancel it.
    await expect(customer).toHaveURL(new RegExp(`/${locale}$`));
    await customer.goto(`/${locale}/account/signin`);
    await customer.locator('input[name="login"]').fill(account.email);
    await customer.getByRole("button", { name: t.signInContinue }).click();
    await expect(customer).toHaveURL(/step=password/);
    await expect(customer.locator('input[name="password"]')).toBeFocused();

    // A wrong password is refused; the right one gets in.
    await customer.locator('input[name="password"]').fill("not-the-password-1");
    await customer.getByRole("button", { name: t.signInTitle, exact: true }).click();
    await expect(customer).not.toHaveURL(new RegExp(`/${locale}/account(\\?|$)`));
    await customer.goto(`/${locale}/account/signin`);
    await customer.locator('input[name="login"]').fill(account.email);
    await customer.getByRole("button", { name: t.signInContinue }).click();
    await customer.locator('input[name="password"]').fill(account.password);
    await customer.getByRole("button", { name: t.signInTitle, exact: true }).click();
    await expect(customer).toHaveURL(new RegExp(`/${locale}/account(\\?|$)`));
    await expect(customer.getByTestId("customer-id")).toHaveText(account.accountNumber);

    await expectNoAccessibilityViolations(customer, testInfo);
    await Promise.all([adminContext.close(), customerContext.close()]);
  });
}
