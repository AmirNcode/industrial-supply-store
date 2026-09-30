import { test, expect } from "@playwright/test";

/**
 * Review finding L-18: the confirmation page shows a reference only when it
 * has the shape of one the shop issues, so a crafted link cannot print its
 * own text under "Your reference".
 */
test("the confirmation page shows real-looking references only", async ({ page, isMobile }) => {
  test.skip(isMobile, "The rule does not depend on the device.");

  const spoof = "CALL 0912 000 0000 TO PAY";
  await page.goto(`/en/quote/submitted?ref=${encodeURIComponent(spoof)}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(spoof)).toHaveCount(0);
  await expect(page.getByText("Your reference")).toHaveCount(0);

  await page.goto("/en/quote/submitted?ref=ORD-ABC234");
  await expect(page.getByText("ORD-ABC234", { exact: true })).toBeVisible();
});
