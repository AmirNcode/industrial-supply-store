import { test, expect } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import {
  addToCart,
  cartContinueLink,
  checkoutSubmit,
  fillCheckout,
  freshAddressHeader,
  localSql,
  PAY_URL,
  setShelfOf,
  shelfFixtures,
  type Fixture,
} from "./shop";

const locales: Locale[] = ["en", "fa"];
const sql = localSql();
test.afterAll(() => sql.end());
const fixtures = () => shelfFixtures(sql);
const setShelf = (fixture: Fixture, inStock: boolean, available: number) =>
  setShelfOf(sql, fixture, inStock, available);

for (const locale of locales) {
  test.describe(`${locale}`, () => {
    test.use({ extraHTTPHeaders: freshAddressHeader() });

    test("goods on the shelf: checkout lands on a pay page awaiting payment", async ({ page }, testInfo) => {
      const t = getDict(locale);
      const { onShelf } = await fixtures();
      await setShelf(onShelf, true, 50);
      const marker = `E2E-INSTANT-${locale}-${testInfo.workerIndex}-${Date.now()}`;

      await addToCart(page, locale, onShelf.familySlug, { partNumber: onShelf.partNumber });
      await page.goto(`/${locale}/cart`);
      // Every line priced and in stock: the cart says CHECKOUT, not REQUEST QUOTE.
      await expect(page.getByRole("link", { name: t.checkout })).toBeVisible();
      await expect(page.getByRole("link", { name: t.requestQuote })).toHaveCount(0);
      await cartContinueLink(page, locale).click();

      await expect(page.getByRole("heading", { level: 1, name: t.checkoutTitle })).toBeVisible();
      // No country field any more; the optional tax and postal details are there.
      await expect(page.locator('input[name="country"]')).toHaveCount(0);
      for (const name of ["postalCode", "nationalId", "economicCode"]) {
        await expect(page.locator(`input[name="${name}"]`)).not.toHaveAttribute("required", "");
      }
      await fillCheckout(page, {
        company: marker,
        email: `${marker.toLowerCase()}@example.com`,
        address: "12 Shelf Road",
        city: "Tehran",
      });
      await checkoutSubmit(page, locale).click();

      await expect(page).toHaveURL(PAY_URL);
      // A pish-factor needs a rate and the seller's real contact details; if
      // the database has neither, checkout correctly falls back to a quote
      // request, and this says so instead of failing on a missing banner.
      if (await page.getByText(t.payPlacedQuote).isVisible()) {
        throw new Error(
          "Checkout fell back to a quote request: this database has no exchange rate or seller contact, so no pro forma can be issued.",
        );
      }
      await expect(page.getByText(t.payPlacedPish)).toBeVisible();
      await expect(page.getByText(t.statusInvoiced).first()).toBeVisible();
      await expect(page.getByText(t.orderDeadline).or(page.getByText(/24|۲۴/)).first()).toBeVisible();
      await expect(page.getByRole("link", { name: t.viewPishFactor })).toBeVisible();
      await expect(page.getByRole("button", { name: t.proofUpload })).toBeVisible();
    });

    test("goods bought from a supplier: checkout is a quote request, not a payment", async ({ page }, testInfo) => {
      const t = getDict(locale);
      const { supplier } = await fixtures();
      await setShelf(supplier, false, 0);
      const marker = `E2E-QUOTE-${locale}-${testInfo.workerIndex}-${Date.now()}`;

      await addToCart(page, locale, supplier.familySlug, { partNumber: supplier.partNumber });
      await page.goto(`/${locale}/cart`);
      await expect(page.getByRole("link", { name: t.requestQuote })).toBeVisible();
      await expect(page.getByRole("link", { name: t.checkout })).toHaveCount(0);
      await cartContinueLink(page, locale).click();
      await fillCheckout(page, {
        company: marker,
        email: `${marker.toLowerCase()}@example.com`,
        address: "3 Supplier Lane",
        city: "Shiraz",
      });
      await checkoutSubmit(page, locale).click();

      await expect(page).toHaveURL(PAY_URL);
      await expect(page.getByText(t.payPlacedQuote)).toBeVisible();
      await expect(page.getByText(t.statusReceived).first()).toBeVisible();
      // Nothing to pay yet: no receipt upload.
      await expect(page.getByRole("button", { name: t.proofUpload })).toHaveCount(0);
    });

    test("the checkout form refuses a missing address or city", async ({ page, isMobile }) => {
      test.skip(isMobile, "The browser's own validation does not depend on the device.");
      const { supplier } = await fixtures();
      await addToCart(page, locale, supplier.familySlug, { partNumber: supplier.partNumber });
      await page.goto(`/${locale}/quote`);

      const address = page.locator('input[name="address"]');
      const city = page.locator('input[name="city"]');
      await expect(address).toHaveAttribute("required", "");
      await expect(city).toHaveAttribute("required", "");

      // Everything else filled; the browser stops the submit on the address.
      await fillCheckout(page, { company: "E2E No Address", email: "e2e-no-address@example.com" });
      await checkoutSubmit(page, locale).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/quote$`));
      expect(await address.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);

      // With the address but no city, it stops on the city.
      await address.fill("5 Missing City Street");
      await checkoutSubmit(page, locale).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/quote$`));
      expect(await city.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  });
}
