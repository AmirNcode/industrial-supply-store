import { test, expect, type Page } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { formatRial } from "../src/lib/money";

const locales: Locale[] = ["en", "fa"];
const familySlug = "oil-resistant-buna-n-o-rings";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "ci-admin-password";

async function adminSignIn(page: Page, locale: Locale): Promise<void> {
  const t = getDict(locale);
  await page.goto(`/${locale}/admin/login`);
  await page.getByLabel(t.password).fill(adminPassword);
  await page.getByRole("button", { name: t.signIn }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin/orders`));
}

for (const locale of locales) {
  test(`${locale}: a rep creates a customer, orders for them and shares a working pay link`, async (
    { browser, isMobile },
    testInfo,
  ) => {
    test.skip(isMobile, "The desktop project covers the rep flow.");
    const t = getDict(locale);
    const stamp = `${locale}${testInfo.workerIndex}${Date.now()}`;
    const username = `e2e.${stamp}`.slice(0, 32);
    const company = `E2E Rep Co ${stamp}`;

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await adminSignIn(admin, locale);

    // The admin creates the rep; the temporary password is shown once.
    await admin.goto(`/${locale}/admin/reps`);
    await admin.locator('input[name="name"]').fill("E2E Rep");
    await admin.locator('input[name="username"]').fill(username);
    await admin.locator('input[name="commission"]').fill("2.5");
    await admin.getByRole("button", { name: t.createRep }).click();
    const tempPassword = (await admin.getByTestId("shown-once-password").innerText()).trim();

    // The rep must replace it, and a weak password is refused.
    const repContext = await browser.newContext();
    const rep = await repContext.newPage();
    await rep.goto(`/${locale}/rep/signin`);
    await rep.locator('input[name="username"]').fill(username);
    await rep.locator('input[name="password"]').fill(tempPassword);
    await rep.getByRole("button", { name: t.signInTitle }).click();
    await expect(rep).toHaveURL(new RegExp(`/${locale}/rep/password`));
    for (const [value, next] of [["password1", "policy"], ["Str0ng!Pass", "home"]] as const) {
      await rep.locator('input[name="newPassword"]').fill(value);
      await rep.locator('input[name="passwordAgain"]').fill(value);
      await rep.getByRole("button", { name: t.savePassword }).click();
      if (next === "policy") await expect(rep.getByText(t.repPasswordPolicy)).toBeVisible();
    }
    await expect(rep).toHaveURL(new RegExp(`/${locale}/rep(\\?|$)`));

    // A new customer's ID is the phone's last seven digits.
    const phone = `0912${String(Date.now()).slice(-7)}`;
    await rep.goto(`/${locale}/rep/customers/new`);
    await rep.locator('input[name="company"]').fill(company);
    await rep.locator('input[name="contactName"]').fill("E2E Buyer");
    await rep.locator('input[name="phone"]').fill(phone);
    await rep.getByRole("button", { name: t.createCustomer }).click();
    await expect(rep.getByTestId("shown-once-login")).toHaveText(phone.slice(-7));

    // New order → one catalog line → checkout already filled in for them.
    // Wait for its landing page: navigating away mid-action would cancel the
    // request that remembers which customer this order is for.
    await rep.getByRole("button", { name: t.newOrder }).click();
    await expect(rep).toHaveURL(new RegExp(`/${locale}/quick-order$`));
    await rep.goto(`/${locale}/f/${familySlug}`);
    await rep.locator("label.row-expand").first().click();
    await rep.getByRole("spinbutton", { name: new RegExp(t.qty) }).first().fill("1");
    const add = rep.getByRole("button", { name: t.addToOrder }).first();
    await add.click();
    await expect(add).toHaveText("✓");
    await rep.goto(`/${locale}/quote`);
    await expect(rep.locator('input[name="company"]')).toHaveValue(company);
    await rep.getByRole("button", { name: t.repPlaceOrder }).click();
    await expect(rep).toHaveURL(new RegExp(`/${locale}/rep/orders/ORD-`));
    const payLink = (await rep.getByTestId("pay-link").innerText()).trim();

    // Signed out, the link works: first "being priced", then payable.
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto(payLink);
    await expect(visitor.getByText(t.payBeingPriced)).toBeVisible();

    await admin.goto(`/${locale}/admin/orders`);
    const order = admin.locator("details").filter({ hasText: company }).first();
    await order.locator("summary").click();
    await expect(order.getByText("E2E Rep").first()).toBeVisible();

    // The rep invoices at the order's prices: a draft first, then finalize.
    await rep.getByRole("link", { name: t.createInvoice }).click();
    await expect(rep).toHaveURL(new RegExp(`/${locale}/rep/orders/ORD-[^/]+/invoice$`));
    await expect(rep.getByText(t.invoiceDraftNotice)).toBeVisible();
    await rep.getByRole("button", { name: t.finalizeInvoice }).click();
    await rep
      .getByRole("dialog", { name: t.confirmFinalizeInvoice })
      .getByRole("button", { name: t.confirmContinue })
      .click();
    await expect(rep).toHaveURL(/ok=invoiced/);
    await expect(rep.getByRole("link", { name: t.createInvoice })).toHaveCount(0);

    // Payable now — by bank transfer, so the page offers the invoice, no Pay button.
    await visitor.reload();
    await expect(visitor.getByText(t.payAmountDue)).toBeVisible();
    await expect(visitor.getByRole("link", { name: t.viewInvoice })).toBeVisible();
    // The receipt upload is the next step, and says so. (Uploading itself needs
    // Storage, which the CI database service does not have.)
    await expect(visitor.getByRole("button", { name: t.proofUpload })).toBeVisible();
    await visitor.getByRole("link", { name: t.viewInvoice }).click();
    await expect(visitor.getByText(t.invoiceProofTitle)).toBeVisible();
    await admin.goto(`/${locale}/admin/orders`);

    // Paid, shipped, delivered — then the sale and its commission reach the rep.
    // The queue keeps a card open after acting on it (its <details> survives
    // the redirect), so the card is opened only when it is closed. Each step
    // waits for the order's new state: the URL reads ?ok=status after the
    // first step already, so it cannot tell one step from the next.
    const row = () => admin.locator("details").filter({ hasText: company });
    const advance = async (
      button: string,
      dialogTitle: string,
      done: () => Promise<void>,
      fill?: () => Promise<void>,
    ) => {
      if ((await row().first().getAttribute("open")) === null) await row().first().locator("summary").click();
      if (fill) await fill();
      await row().first().getByRole("button", { name: button }).click();
      await admin
        .getByRole("dialog", { name: dialogTitle })
        .getByRole("button", { name: t.confirmContinue })
        .click();
      await done();
    };
    const statusIs = (label: string) => () =>
      expect(row().first().locator("summary")).toContainText(label);
    await advance(t.markPaid, t.confirmMarkPaid, statusIs(t.statusPreparing));
    await advance(t.markShipped, t.confirmMarkShipped, statusIs(t.statusShipped), async () => {
      await row().first().locator('input[name="courier"]').fill("E2E Post");
      await row().first().locator('input[name="trackingNumber"]').fill("TRK-E2E-1");
    });
    // A delivered order leaves the default queue.
    await advance(t.markDelivered, t.confirmMarkDelivered, () => expect(row()).toHaveCount(0));

    await rep.goto(`/${locale}/rep`);
    // Whole-text comparisons: "84,350 IRR" contains the substring "0 IRR".
    await expect(rep.getByTestId("tile-sales-to-date")).not.toHaveText(formatRial(0, locale));
    await expect(rep.getByTestId("tile-commission-owed")).not.toHaveText(formatRial(0, locale));

    await Promise.all([adminContext.close(), repContext.close(), visitorContext.close()]);
  });
}
