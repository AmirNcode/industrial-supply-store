import { test, expect } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { expectNoAccessibilityViolations } from "./accessibility";
import { adminSignIn, freshAddressHeader } from "./shop";

const locales: Locale[] = ["en", "fa"];

/** Staff alert inboxes are kept in Admin → Settings: personal addresses go in and come out. */
for (const locale of locales) {
  test(`${locale}: admin adds and removes a staff notification email`, async ({ browser, isMobile }, testInfo) => {
    test.skip(isMobile, "A settings list does not depend on the device.");
    const t = getDict(locale);
    const context = await browser.newContext({ extraHTTPHeaders: freshAddressHeader() });
    const admin = await context.newPage();
    await adminSignIn(admin, locale);

    const email = `e2e-staff-${locale}-${Date.now().toString(36)}@gmail.com`;
    await admin.goto(`/${locale}/admin/settings`);
    const section = admin.locator("#staff-emails");
    await section.getByLabel(t.email).fill(email);
    await section.getByRole("button", { name: t.staffEmailAdd }).click();
    await expect(admin.getByText(t.staffEmailAdded)).toBeVisible();
    await expect(section.getByText(email)).toBeVisible();

    // The same address twice is refused, whatever its case.
    await section.getByLabel(t.email).fill(email.toUpperCase());
    await section.getByRole("button", { name: t.staffEmailAdd }).click();
    await expect(admin.getByText(t.staffEmailExists)).toBeVisible();

    await expectNoAccessibilityViolations(admin, testInfo);

    await section.getByRole("button", { name: `${t.staffEmailRemove} ${email}` }).click();
    await expect(admin.getByText(t.staffEmailRemoved)).toBeVisible();
    await expect(section.getByText(email)).toHaveCount(0);
    await context.close();
  });
}
