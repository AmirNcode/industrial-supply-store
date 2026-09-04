import { test, expect } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { expectNoAccessibilityViolations } from "./accessibility";

const locales: Locale[] = ["en", "fa"];
const familySlug = "oil-resistant-buna-n-o-rings";

for (const locale of locales) {
  test(`${locale}: cart, quote, and admin confirmation work by keyboard`, async (
    { page, isMobile },
    testInfo,
  ) => {
    test.skip(isMobile, "The mobile project covers the mobile-only overlays.");
    const t = getDict(locale);
    const marker = `E2E-${locale}-${testInfo.workerIndex}-${Date.now()}`;

    await page.goto(`/${locale}/f/${familySlug}`);
    // Ordering lives in the expanded row now, not in a column of the grid, so
    // the part number has to be opened before there is a quantity to fill.
    await page.locator("label.row-expand").first().click();
    const quantity = page.getByRole("spinbutton", { name: new RegExp(t.qty) }).first();
    const add = page.getByRole("button", { name: t.addToOrder }).first();
    await quantity.fill("1");
    await add.click();
    // The local request can finish between two assertions, so wait for the
    // durable success state rather than trying to observe the transient busy
    // attribute.
    await expect(add).toHaveText("✓");

    await page.goto(`/${locale}/cart`);
    await expect(page.getByRole("heading", { name: new RegExp(t.yourOrder) })).toBeVisible();
    await expectNoAccessibilityViolations(page, testInfo);
    await page.getByRole("link", { name: t.requestQuote }).click();

    await page.locator('input[name="company"]').fill(marker);
    await page.locator('input[name="contactName"]').fill("Keyboard Test");
    await page.locator('input[name="email"]').fill(`${marker.toLowerCase()}@example.com`);
    await page.locator('input[name="phone"]').fill("+1 555 0100");
    await expectNoAccessibilityViolations(page, testInfo);
    await page.getByRole("button", { name: t.submitRequest }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/quote/submitted\\?ref=`));
    await expect(page.getByRole("heading", { name: t.quoteSubmitted })).toBeVisible();

    await page.goto(`/${locale}/admin/login`);
    await page.getByLabel(t.password).fill(process.env.E2E_ADMIN_PASSWORD ?? "ci-admin-password");
    await page.getByRole("button", { name: t.signIn }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/orders`));

    const order = page.locator("details").filter({ hasText: marker }).first();
    await expect(order).toBeVisible();
    await order.locator("summary").click();
    await order.locator('input[name="paymentUrl"]').fill("https://example.com/pay/e2e");

    const issueInvoice = order.getByRole("button", { name: t.issueInvoice });
    await issueInvoice.click();
    const dialog = page.getByRole("dialog", { name: t.confirmIssueInvoice });
    const discard = dialog.getByRole("button", { name: t.confirmDiscard });
    const continueButton = dialog.getByRole("button", { name: t.confirmContinue });
    await expect(discard).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(continueButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(discard).toBeFocused();
    await expectNoAccessibilityViolations(page, testInfo, '[role="dialog"]');
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(issueInvoice).toBeFocused();
  });
}
