import { test, expect } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { expectNoAccessibilityViolations } from "./accessibility";
import {
  adminSignIn,
  addToCart,
  cartContinueLink,
  checkoutSubmit,
  fillCheckout,
  localSql,
  PAY_URL,
  useClientAddress,
} from "./shop";

const locales: Locale[] = ["en", "fa"];
const familySlug = "oil-resistant-buna-n-o-rings";

const sql = localSql();
test.afterAll(() => sql.end());

/**
 * The first part of the family, unless it has no price: an unpriced line can
 * only be quoted once an admin types a price, which this walk does not do,
 * and a hand-edited local row must not be able to break it.
 */
async function pricedPartNumber(): Promise<string> {
  const [row] = await sql<{ part: string }[]>`
    SELECT p.part_number AS part
    FROM products p JOIN product_families f ON f.id = p.family_id
    WHERE f.slug = ${familySlug} AND p.price_cents > 0
    ORDER BY p.id
    LIMIT 1
  `;
  if (!row) throw new Error(`${familySlug} has no priced part.`);
  return row.part;
}

/**
 * One order from the cart to "delivered", by keyboard-operable controls.
 *
 * Whether the first part of the family is on the shelf depends on the
 * database (a fresh CI one has no stock counts; the local demo seed has), so
 * the walk follows what checkout actually did: a quote request goes through
 * "Send quote" and "Customer accepted" first; a pro forma issued at checkout
 * skips both. Either way the invoice number must not exist until payment is
 * confirmed.
 */
for (const locale of locales) {
  test(`${locale}: cart, checkout, quote, payment and delivery work by keyboard`, async (
    { page, isMobile },
    testInfo,
  ) => {
    test.skip(isMobile, "The mobile project covers the mobile-only overlays.");
    const t = getDict(locale);
    const marker = `E2E-${locale}-${testInfo.workerIndex}-${Date.now()}`;
    await useClientAddress(page, 20 + testInfo.workerIndex + (locale === "fa" ? 10 : 0));

    await addToCart(page, locale, familySlug, { partNumber: await pricedPartNumber() });

    await page.goto(`/${locale}/cart`);
    await expect(page.getByRole("heading", { name: new RegExp(t.yourOrder) })).toBeVisible();
    await expectNoAccessibilityViolations(page, testInfo);
    await cartContinueLink(page, locale).click();

    await fillCheckout(page, {
      company: marker,
      email: `${marker.toLowerCase()}@example.com`,
      address: "1 Keyboard Street",
      city: "Tehran",
    });
    await expectNoAccessibilityViolations(page, testInfo);
    await checkoutSubmit(page, locale).click();

    // Checkout lands on the order's own pay page, not a bare confirmation.
    await expect(page).toHaveURL(PAY_URL);
    await expect(page.getByRole("heading", { level: 1, name: marker })).toBeVisible();
    const instant = await page.getByText(t.payPlacedPish).isVisible();
    if (!instant) await expect(page.getByText(t.payPlacedQuote)).toBeVisible();
    await expectNoAccessibilityViolations(page, testInfo);

    await adminSignIn(page, locale);
    const order = page.locator("details").filter({ hasText: marker }).first();
    await expect(order).toBeVisible();
    await order.locator("summary").click();
    // The queue keeps a card open after acting on it, so it is only opened
    // when it is closed.
    const row = () => page.locator("details").filter({ hasText: marker }).first();
    const confirmIn = async (title: string) => {
      await page
        .getByRole("dialog", { name: title })
        .getByRole("button", { name: t.confirmContinue })
        .click();
    };

    if (!instant) {
      // Send quote opens a draft; nothing is sent until it is confirmed.
      await order.getByRole("button", { name: t.sendQuote }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/admin/orders/ORD-[^/]+/invoice\\?`));
      await expect(page.getByText(t.quoteDraftNotice)).toBeVisible();
      // The VAT row itself, not the notice that mentions VAT.
      await expect(page.getByText(new RegExp(`^${t.invoiceVat.split("(")[0].trim()} \\(`))).toBeVisible();
      await expectNoAccessibilityViolations(page, testInfo);

      const sendQuote = page.getByRole("button", { name: t.sendQuote });
      await sendQuote.click();
      const dialog = page.getByRole("dialog", { name: t.confirmSendQuote });
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
      await expect(sendQuote).toBeFocused();

      await sendQuote.click();
      await confirmIn(t.confirmSendQuote);
      await expect(page).toHaveURL(/ok=quoted/);
      await expect(row().locator("summary")).toContainText(t.statusQuoted);

      // The customer has accepted by phone: staff issue the pro forma for them.
      if ((await row().getAttribute("open")) === null) await row().locator("summary").click();
      await row().getByRole("button", { name: t.acceptForCustomer }).click();
      await confirmIn(t.acceptForCustomer);
      await expect(page).toHaveURL(/ok=invoiced/);
    }

    // Awaiting payment on a pro forma: no invoice number exists yet.
    await expect(row().locator("summary")).toContainText(t.statusInvoiced);
    if ((await row().getAttribute("open")) === null) await row().locator("summary").click();
    await expect(row().getByText(t.pishFactorTitle).first()).toBeVisible();
    await expect(row().getByText(/INV-\d{4}-\d+/)).toHaveCount(0);

    // Payment confirmed → the number is assigned, and the order is paid.
    await row().getByRole("button", { name: t.markPaid }).click();
    await confirmIn(t.confirmMarkPaid);
    await expect(row().locator("summary")).toContainText(t.statusPreparing);
    if ((await row().getAttribute("open")) === null) await row().locator("summary").click();
    await expect(row().getByText(/INV-\d{4}-\d+/).first()).toBeVisible();

    await row().locator('input[name="courier"]').fill("E2E Post");
    await row().locator('input[name="trackingNumber"]').fill("TRK-E2E-1");
    await row().getByRole("button", { name: t.markShipped }).click();
    await confirmIn(t.confirmMarkShipped);
    await expect(row().locator("summary")).toContainText(t.statusShipped);

    if ((await row().getAttribute("open")) === null) await row().locator("summary").click();
    await row().getByRole("button", { name: t.markDelivered }).click();
    await confirmIn(t.confirmMarkDelivered);
    // A delivered order leaves the default queue.
    await expect(page.locator("details").filter({ hasText: marker })).toHaveCount(0);
  });
}
