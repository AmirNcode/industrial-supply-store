import { test, expect, type Page } from "@playwright/test";
import { getDict } from "../src/lib/i18n";

const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "ci-admin-password";

async function adminSignIn(page: Page): Promise<void> {
  const t = getDict("en");
  await page.goto("/en/admin/login");
  await page.getByLabel(t.password).fill(adminPassword);
  await page.getByRole("button", { name: t.signIn }).click();
  await expect(page).toHaveURL(/\/en\/admin\/orders/);
}

/**
 * One shared admin password means a copied cookie looks like a colleague's.
 * "Sign out everywhere" is the revocation (review finding H-9): after it, a
 * session opened elsewhere is back at the sign-in page.
 */
test("sign out everywhere ends every other admin session", async ({ browser, isMobile }) => {
  test.skip(isMobile, "The session rule does not depend on the device.");
  const t = getDict("en");
  const [first, second] = await Promise.all([browser.newContext(), browser.newContext()]);
  const a = await first.newPage();
  const b = await second.newPage();
  await adminSignIn(a);
  await adminSignIn(b);

  const cookie = (await second.cookies()).find((c) => c.name === "isupply_admin");
  expect(cookie?.value ?? "", "the cookie carries no password hash").toMatch(/^a1\.\d+\.\d+\./);

  await a.goto("/en/admin/settings");
  await a.getByRole("button", { name: t.signOutEverywhere }).click();
  await a
    .getByRole("dialog", { name: t.confirmSignOutEverywhere })
    .getByRole("button", { name: t.confirmContinue })
    .click();
  await expect(a).toHaveURL(/\/en\/admin\/login/);

  await b.goto("/en/admin/orders");
  await expect(b).toHaveURL(/\/en\/admin\/login/);
  await Promise.all([first.close(), second.close()]);
});
