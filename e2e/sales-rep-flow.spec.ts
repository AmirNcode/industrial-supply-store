import { test, expect, type Page } from "@playwright/test";
import { getDict, type Locale } from "../src/lib/i18n";
import { formatRial } from "../src/lib/money";
import { hashPassword } from "../src/lib/password";
import { normalizeRepPassword } from "../src/lib/repPassword";
import { randomReferralCode } from "../src/lib/repAccount";
import { codeFromPhone } from "../src/lib/customerCode";
import { expectNoAccessibilityViolations } from "./accessibility";
import { addToCart, freshAddressHeader, localSql } from "./shop";

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
  test(`${locale}: a rep creates a customer, orders for them and shares a working pay link`, async ({
    browser,
    isMobile,
  }, testInfo) => {
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
    const tempPassword = (
      await admin.getByTestId("shown-once-password").innerText()
    ).trim();
    // Once on screen, the plaintext leaves the browser's cookies (L-24).
    const holdsCredential = async (context: typeof adminContext) =>
      (await context.cookies()).some(
        (cookie) => cookie.name === "isupply_shown_once",
      );
    await expect.poll(() => holdsCredential(adminContext)).toBe(false);

    // The rep must replace it, and a weak password is refused.
    const repContext = await browser.newContext();
    const rep = await repContext.newPage();
    await rep.goto(`/${locale}/rep/signin`);
    await rep.locator('input[name="username"]').fill(username);
    await rep.locator('input[name="password"]').fill(tempPassword);
    await rep.getByRole("button", { name: t.signInTitle }).click();
    await expect(rep).toHaveURL(new RegExp(`/${locale}/rep/password`));
    for (const [value, next] of [
      ["password1", "policy"],
      ["Str0ng!Pass", "home"],
    ] as const) {
      await rep.locator('input[name="newPassword"]').fill(value);
      await rep.locator('input[name="passwordAgain"]').fill(value);
      await rep.getByRole("button", { name: t.savePassword }).click();
      if (next === "policy")
        await expect(rep.getByText(t.repPasswordPolicy)).toBeVisible();
    }
    await expect(rep).toHaveURL(new RegExp(`/${locale}/rep(\\?|$)`));

    // A new customer's ID is the phone's last seven digits.
    const phone = `0912${String(Date.now()).slice(-7)}`;
    await rep.goto(`/${locale}/rep/customers/new`);
    await rep.locator('input[name="company"]').fill(company);
    await rep.locator('input[name="contactName"]').fill("E2E Buyer");
    await rep.locator('input[name="phone"]').fill(phone);
    await rep.getByRole("button", { name: t.createCustomer }).click();
    await expect(rep.getByTestId("shown-once-login")).toHaveText(
      phone.slice(-7),
    );
    await expect.poll(() => holdsCredential(repContext)).toBe(false);

    // New order → one catalog line → checkout already filled in for them.
    // Wait for its landing page: navigating away mid-action would cancel the
    // request that remembers which customer this order is for.
    await rep.getByRole("button", { name: t.newOrder }).click();
    await expect(rep).toHaveURL(new RegExp(`/${locale}/quick-order$`));
    await addToCart(rep, locale, familySlug, { partNumber: await pricedPartNumber() });
    await rep.goto(`/${locale}/quote`);
    await expect(rep.locator('input[name="company"]')).toHaveValue(company);
    // Delivery address and city are required for every order, a rep's too.
    await rep.locator('input[name="address"]').fill("2 Rep Street");
    await rep.locator('input[name="city"]').fill("Karaj");
    await rep.getByRole("button", { name: t.repPlaceOrder }).click();
    await expect(rep).toHaveURL(new RegExp(`/${locale}/rep/orders/ORD-`));
    const payLink = (await rep.getByTestId("pay-link").innerText()).trim();

    // Signed out, the link works: first "being priced", then payable.
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto(payLink);
    // Which path the order took depends on the shelf: a seeded catalog has no
    // stock, so it waits for a quote; a database someone has stocked issues
    // the pro forma at checkout. Both are right, and the walk covers either.
    await expect(
      visitor.getByText(t.payBeingPriced).or(visitor.getByText(t.payAmountDue)),
    ).toBeVisible();
    const instant = await visitor.getByText(t.payAmountDue).isVisible();

    await admin.goto(`/${locale}/admin/orders`);
    const order = admin.locator("details").filter({ hasText: company }).first();
    await order.locator("summary").click();
    await expect(order.getByText("E2E Rep").first()).toBeVisible();
    // The queue carries no order's key until staff ask for that one.
    const token = payLink.split("/pay/")[1];
    expect(await admin.content()).not.toContain(token);
    await order.getByRole("button", { name: t.showPayLink }).click();
    await expect(order.getByTestId("admin-pay-link")).toHaveText(payLink);

    if (!instant) {
      // The rep quotes at the order's prices: a draft first, then send it.
      await rep.getByRole("link", { name: t.sendQuote }).click();
      await expect(rep).toHaveURL(
        new RegExp(`/${locale}/rep/orders/ORD-[^/]+/invoice$`),
      );
      await expect(rep.getByText(t.quoteDraftNotice)).toBeVisible();
      await rep.getByRole("button", { name: t.sendQuote }).click();
      await rep
        .getByRole("dialog", { name: t.confirmSendQuote })
        .getByRole("button", { name: t.confirmContinue })
        .click();
      await expect(rep).toHaveURL(/ok=quoted/);
      await expect(rep.getByRole("link", { name: t.sendQuote })).toHaveCount(0);

      // The customer says yes: the pro forma is issued, and only now payable.
      await visitor.reload();
      await expect(
        visitor.getByRole("button", { name: t.acceptQuote }),
      ).toBeVisible();
      await rep.getByRole("button", { name: t.acceptForCustomer }).click();
      await expect(rep).toHaveURL(/ok=invoiced/);
    }

    // Payable now — by bank transfer, so the page offers the invoice, no Pay button.
    await visitor.reload();
    await expect(visitor.getByText(t.payAmountDue)).toBeVisible();
    await expect(
      visitor.getByRole("link", { name: t.viewPishFactor }),
    ).toBeVisible();
    // The receipt upload is the next step, and says so. (Uploading itself needs
    // Storage, which the CI database service does not have.)
    await expect(
      visitor.getByRole("button", { name: t.proofUpload }),
    ).toBeVisible();
    await visitor.getByRole("link", { name: t.viewPishFactor }).click();
    await expect(visitor.getByText(t.pishFactorTitle).first()).toBeVisible();
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
      if ((await row().first().getAttribute("open")) === null)
        await row().first().locator("summary").click();
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
    await advance(
      t.markShipped,
      t.confirmMarkShipped,
      statusIs(t.statusShipped),
      async () => {
        await row().first().locator('input[name="courier"]').fill("E2E Post");
        await row()
          .first()
          .locator('input[name="trackingNumber"]')
          .fill("TRK-E2E-1");
      },
    );
    // A delivered order leaves the default queue.
    await advance(t.markDelivered, t.confirmMarkDelivered, () =>
      expect(row()).toHaveCount(0),
    );

    await rep.goto(`/${locale}/rep`);
    // Whole-text comparisons: "84,350 Rials" contains the substring "0 Rials".
    await expect(rep.getByTestId("tile-sales-to-date")).not.toHaveText(
      formatRial(0, locale),
    );
    await expect(rep.getByTestId("tile-commission-owed")).not.toHaveText(
      formatRial(0, locale),
    );

    await Promise.all([
      adminContext.close(),
      repContext.close(),
      visitorContext.close(),
    ]);
  });
}

// ── Project B: reps find unassigned customers, order for them, and win them
// when the order is paid; another rep sees only who the customer belongs to.

const sql = localSql();
test.afterAll(() => sql.end());
const REP_PASSWORD = "E2e-Rep-Pass-1405!";

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

/** The seed script still writes only the legacy columns, so this spec makes its own reps and customer. */
async function makeRep(name: string, username: string): Promise<string> {
  const [rep] = await sql<{ id: string }[]>`
    INSERT INTO sales_reps (username, password_hash, name, phone, commission_rate_bp, referral_code, must_change_password)
    VALUES (${username}, ${await hashPassword(normalizeRepPassword(REP_PASSWORD))}, ${name}, '09120000000', 300,
            ${randomReferralCode()}, false)
    RETURNING id`;
  return rep.id;
}

async function repSignIn(page: Page, locale: Locale, username: string): Promise<void> {
  const t = getDict(locale);
  await page.goto(`/${locale}/rep/signin`);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(REP_PASSWORD);
  await page.getByRole("button", { name: t.signInTitle }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/rep(\\?|$)`));
}

for (const locale of locales) {
  test(`${locale}: a rep wins an unassigned customer by a paid order; another rep sees only who has them`, async (
    { browser, isMobile },
    testInfo,
  ) => {
    test.skip(isMobile, "The desktop project covers the rep flow.");
    const t = getDict(locale);
    const stamp = `${locale}${testInfo.workerIndex}${Date.now()}`;
    const fragment = `zq${stamp}`;
    const company = `E2E Unassigned ${fragment}`;
    const nameA = `E2E Rep A ${stamp}`;
    const nameB = `E2E Rep B ${stamp}`;
    await makeRep(nameA, `e2e.a.${stamp}`.slice(0, 32));
    await makeRep(nameB, `e2e.b.${stamp}`.slice(0, 32));
    const phone = `0912${String(Date.now()).slice(-7)}`;
    const [customer] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, company, contact_name, phone, locale, customer_code, origin)
      VALUES (${`${fragment}@example.invalid`}, '!', ${company}, 'E2E Lead', ${phone}, ${locale},
              ${codeFromPhone(phone)!}, 'self')
      RETURNING id`;
    const part = await pricedPartNumber();

    const ctx = () => browser.newContext({ extraHTTPHeaders: freshAddressHeader() });
    const [adminContext, contextA, contextB] = await Promise.all([ctx(), ctx(), ctx()]);
    const [admin, repA, repB] = await Promise.all([
      adminContext.newPage(),
      contextA.newPage(),
      contextB.newPage(),
    ]);

    // Rep A: a short fragment is refused, a long one finds the unassigned customer.
    await repSignIn(repA, locale, `e2e.a.${stamp}`.slice(0, 32));
    await repA.goto(`/${locale}/rep/customers?q=zq`);
    await expect(repA.getByText(t.repSearchTooShort)).toBeVisible();
    await repA.goto(`/${locale}/rep/customers?q=${fragment}`);
    const found = repA.getByTestId("rep-search-unassigned");
    await expect(found).toHaveCount(1);
    await expect(found).toContainText(company);
    await expect(found).toContainText(t.repUnassigned);
    await expect(found).toContainText(phone);
    await expectNoAccessibilityViolations(repA, testInfo);

    // "New order" from the result, then one priced line, then the form.
    await found.getByRole("button", { name: t.newOrder }).click();
    await expect(repA).toHaveURL(new RegExp(`/${locale}/quick-order$`));
    await addToCart(repA, locale, familySlug, { partNumber: part });
    await repA.goto(`/${locale}/quote`);
    await expect(repA.getByTestId("rep-order-unassigned")).toHaveText(t.repOrderUnassignedNote);
    await expect(repA.locator('input[name="company"]')).toHaveValue(company);
    // Only what is needed to order: no email, no PO number field.
    await expect(repA.locator('input[name="email"]')).toHaveCount(0);
    await expect(repA.locator("body")).not.toContainText(`${fragment}@example.invalid`);
    await repA.locator('input[name="address"]').fill("3 Claim Street");
    await repA.locator('input[name="city"]').fill("Karaj");
    await expectNoAccessibilityViolations(repA, testInfo);
    await repA.getByRole("button", { name: t.repPlaceOrder }).click();
    await expect(repA).toHaveURL(new RegExp(`/${locale}/rep/orders/ORD-`));
    const orderUrl = repA.url().split("?")[0];
    // The order carries no email at all: the rep cannot read the customer's
    // address off it, whatever the form posted; mail still goes to the account.
    const [stored] = await sql<{ email: string }[]>`SELECT email FROM orders WHERE ref = ${orderUrl.split("/").pop()!}`;
    expect(stored.email).toBe("");
    await expect(repA.locator("body")).not.toContainText(`${fragment}@example.invalid`);
    await expect(repA.getByTestId("commission-line")).toHaveText(t.repOrderPendingClaim);
    await expectNoAccessibilityViolations(repA, testInfo);

    // Not a customer of A's yet, and its commission is tagged, not counted.
    await repA.goto(`/${locale}/rep/customers`);
    await expect(repA.getByText(company)).toHaveCount(0);
    await repA.goto(`/${locale}/rep/commission`);
    await expect(repA.getByTestId("pending-claim")).toBeVisible();
    await expect(repA.getByTestId("commission-expected-total")).toHaveText(formatRial(0, locale));
    await expectNoAccessibilityViolations(repA, testInfo);

    // Depending on stock the order is quoted first or already a pro forma.
    await repA.goto(orderUrl);
    if (await repA.getByRole("link", { name: t.sendQuote }).isVisible()) {
      await repA.getByRole("link", { name: t.sendQuote }).click();
      await repA.getByRole("button", { name: t.sendQuote }).click();
      await repA
        .getByRole("dialog", { name: t.confirmSendQuote })
        .getByRole("button", { name: t.confirmContinue })
        .click();
      await expect(repA).toHaveURL(/ok=quoted/);
      await repA.getByRole("button", { name: t.acceptForCustomer }).click();
      await expect(repA).toHaveURL(/ok=invoiced/);
    }

    // The admin confirms payment: that is what makes the customer A's.
    await adminSignIn(admin, locale);
    await admin.goto(`/${locale}/admin/orders`);
    const row = admin.locator("details").filter({ hasText: company }).first();
    if ((await row.getAttribute("open")) === null) await row.locator("summary").click();
    await row.getByRole("button", { name: t.markPaid }).click();
    await admin
      .getByRole("dialog", { name: t.confirmMarkPaid })
      .getByRole("button", { name: t.confirmContinue })
      .click();
    await expect(row.locator("summary")).toContainText(t.statusPreparing);

    await repA.goto(orderUrl);
    await expect(repA.getByTestId("commission-line")).not.toHaveText(t.repOrderPendingClaim);
    await expect(repA.getByTestId("commission-line")).not.toHaveText(t.repOrderLostClaim);
    await repA.goto(`/${locale}/rep/customers?q=${fragment}`);
    await expect(repA.getByRole("link", { name: company })).toBeVisible();
    await expect(repA.getByTestId("rep-search-unassigned")).toHaveCount(0);

    // Rep B: the same search shows one plain line, no link, no id anywhere.
    await repSignIn(repB, locale, `e2e.b.${stamp}`.slice(0, 32));
    await repB.goto(`/${locale}/rep/customers?q=${fragment}`);
    const taken = repB.getByTestId("rep-search-taken");
    await expect(taken).toHaveCount(1);
    await expect(taken).toContainText(t.repAssignedTo.replace("{name}", nameA));
    await expect(taken.locator("a, button")).toHaveCount(0);
    await expect(repB.getByTestId("rep-search-unassigned")).toHaveCount(0);
    expect(await repB.content()).not.toContain(customer.id);
    await expectNoAccessibilityViolations(repB, testInfo);

    // Typing the id into the order link is refused the same way, with no form.
    await addToCart(repB, locale, familySlug, { partNumber: part });
    await repB.goto(`/${locale}/quote?for=${customer.id}`);
    await expect(repB.getByTestId("rep-order-taken")).toHaveText(t.repOrderTaken.replace("{name}", nameA));
    await expect(repB.locator('input[name="company"]')).toHaveCount(0);
    await expectNoAccessibilityViolations(repB, testInfo);
    // The customer's own page is a 404 for B.
    const response = await repB.goto(`/${locale}/rep/customers/${customer.id}`);
    expect(response?.status()).toBe(404);

    await Promise.all([adminContext.close(), contextA.close(), contextB.close()]);
  });

  test(`${locale}: admin sets an account's reps, shares and rate; a bad total changes nothing`, async ({
    browser,
    isMobile,
  }, testInfo) => {
    test.skip(isMobile, "The desktop project covers the admin editor.");
    const t = getDict(locale);
    const stamp = `${locale}${testInfo.workerIndex}${Date.now()}`;
    const nameA = `E2E Split A ${stamp}`;
    const nameB = `E2E Split B ${stamp}`;
    await makeRep(nameA, `e2e.sa.${stamp}`.slice(0, 32));
    await makeRep(nameB, `e2e.sb.${stamp}`.slice(0, 32));
    const company = `E2E Split Co ${stamp}`;
    const phone = `0913${String(Date.now()).slice(-7)}`;
    const [customer] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, company, contact_name, phone, locale, customer_code, origin)
      VALUES (${`split${stamp}@example.invalid`}, '!', ${company}, 'E2E Split', ${phone}, ${locale},
              ${codeFromPhone(phone)!}, 'self')
      RETURNING id`;

    const context = await browser.newContext({ extraHTTPHeaders: freshAddressHeader() });
    const admin = await context.newPage();
    await adminSignIn(admin, locale);
    const customerUrl = `/${locale}/admin/customers/${customer.id}`;
    const shareBoxes = admin.locator('input[name="share"]');
    const repSelects = admin.locator('select[name="repId"]');
    // Persian digits typed into the boxes are accepted, so the fa run types them.
    const typed = (n: number) => (locale === "fa" ? String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]) : String(n));

    const save = async () => {
      await admin
        .locator("form")
        .filter({ has: admin.locator('input[name="rate"]') })
        .getByRole("button", { name: t.save })
        .click();
    };

    await admin.goto(customerUrl);
    await expect(admin.getByTestId("split-unassigned")).toHaveText(t.adminNoRepsState);
    await admin.getByRole("button", { name: t.adminAddRep }).click();
    await admin.getByRole("button", { name: t.adminAddRep }).click();
    await repSelects.nth(0).selectOption({ label: nameA });
    await repSelects.nth(1).selectOption({ label: nameB });
    await shareBoxes.nth(0).fill(typed(75));
    await shareBoxes.nth(1).fill(typed(25));
    await admin.locator('input[name="rate"]').fill(locale === "fa" ? "۵" : "5");
    await expect(admin.getByTestId("split-rate-hint")).toContainText(nameA);
    await save();
    await expect(admin.getByText(t.assignmentSaved)).toBeVisible();

    const expectSaved = async (a: string, b: string, rate: string) => {
      await admin.goto(customerUrl);
      await expect(shareBoxes.nth(0)).toHaveValue(a);
      await expect(shareBoxes.nth(1)).toHaveValue(b);
      await expect(admin.locator('input[name="rate"]')).toHaveValue(rate);
      await expect(repSelects.nth(0).locator("option:checked")).toHaveText(nameA);
    };
    await expectSaved("75", "25", "5");
    await expectNoAccessibilityViolations(admin, testInfo);

    // 75 + 15 is refused with the plain message and nothing is written.
    await shareBoxes.nth(1).fill(typed(15));
    await save();
    await expect(admin.getByText(t.adminSplitErrorTotal)).toBeVisible();
    await expectSaved("75", "25", "5");

    // Every share cleared saves as an equal split, shown back as blanks.
    await shareBoxes.nth(0).fill("");
    await shareBoxes.nth(1).fill("");
    await save();
    await expect(admin.getByText(t.assignmentSaved)).toBeVisible();
    await expectSaved("", "", "5");

    // A row set back to "Choose a rep" is refused with a message, never dropped
    // quietly. The browser's own `required` check stops this first, so it is
    // switched off to exercise the server.
    await admin.goto(customerUrl);
    await repSelects.nth(1).selectOption({ value: "" });
    await admin.locator("form").filter({ has: admin.locator('input[name="rate"]') }).evaluate((form: HTMLFormElement) => {
      form.noValidate = true;
    });
    await save();
    await expect(admin.getByText(t.adminSplitErrorRepMissing)).toBeVisible();
    await expectSaved("", "", "5");
    await expect(repSelects.nth(1).locator("option:checked")).toHaveText(nameB);

    // Removing every row is the explicit way to unassign.
    await admin.goto(customerUrl);
    await admin.getByRole("button", { name: t.adminRemoveRep }).first().click();
    await admin.getByRole("button", { name: t.adminRemoveRep }).first().click();
    await expect(admin.getByTestId("split-unassigned")).toHaveText(t.adminNoRepsState);
    await save();
    await expect(admin.getByText(t.assignmentSaved)).toBeVisible();
    await admin.goto(customerUrl);
    await expect(admin.getByTestId("split-unassigned")).toHaveText(t.adminNoRepsState);

    // Reps again for the list check below.
    await admin.getByRole("button", { name: t.adminAddRep }).click();
    await admin.getByRole("button", { name: t.adminAddRep }).click();
    await repSelects.nth(0).selectOption({ label: nameA });
    await repSelects.nth(1).selectOption({ label: nameB });
    await save();
    await expect(admin.getByText(t.assignmentSaved)).toBeVisible();

    // The customers list names every rep with the effective share.
    await admin.goto(`/${locale}/admin/customers?q=${encodeURIComponent(company)}`);
    const row = admin.locator("tr", { hasText: company });
    await expect(row).toContainText(nameA);
    await expect(row).toContainText(nameB);

    await context.close();
  });
}
