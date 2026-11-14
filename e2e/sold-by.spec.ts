import "dotenv/config";
import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { getDict, type Locale } from "../src/lib/i18n";
import { CLIENT_ADDRESS_HEADER } from "./clientAddress";

// These tests write fixtures. They may never use a hosted production database.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Sold-by browser tests require an isolated local DATABASE_URL.");
}
const sql = postgres(databaseUrl, { max: 1 });
test.afterAll(() => sql.end());

for (const locale of ["en", "fa"] as Locale[]) {
  test(`${locale}: switching a family to single units drops the pack column`, async ({ page, isMobile }, testInfo) => {
    test.skip(isMobile, "The desktop project covers the admin switch.");
    const t = getDict(locale);
    const slug = `e2e-soldby-${locale}-${testInfo.workerIndex}-${Date.now()}`;
    const [category] = await sql`INSERT INTO categories (slug, path, depth, name_en, name_fa)
      VALUES (${slug}, ${slug}, 0, ${slug}, ${slug}) RETURNING id`;
    try {
      const [family] = await sql`INSERT INTO product_families (slug, category_id, name_en, name_fa)
        VALUES (${slug}, ${category.id}, ${slug}, ${slug}) RETURNING id`;
      await sql`INSERT INTO products (part_number, family_id, specs, price_cents, pack_qty)
        VALUES (${`SB-${Date.now()}-${locale}`}, ${family.id}, '{}'::jsonb, 1000, 10)`;
      const packHeader = page.locator(".catalog-table thead th", { hasText: t.pkgQty });

      await page.goto(`/${locale}/f/${slug}`);
      await expect(packHeader).toHaveCount(1);

      await page.setExtraHTTPHeaders({ [CLIENT_ADDRESS_HEADER]: `203.0.113.${200 + testInfo.workerIndex}` });
      await page.goto(`/${locale}/admin/login`);
      await page.getByLabel(t.password).fill(process.env.E2E_ADMIN_PASSWORD ?? "ci-admin-password");
      await page.getByRole("button", { name: t.signIn }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/admin/orders`));
      await page.goto(`/${locale}/admin/products?cat=f:${family.id}`);
      const select = page.getByLabel(t.soldByLabel).filter({ visible: true }).first();
      await select.selectOption("unit");
      await expect(page.getByRole("status").filter({ hasText: t.soldBySaved }).first()).toBeVisible();

      await page.goto(`/${locale}/f/${slug}`);
      await expect(packHeader).toHaveCount(0);
      await expect(page.locator(".catalog-table thead th.price-head")).toContainText(`${t.price} / ${t.each}`);
      await expect(page.locator('td[data-cell="pack"]')).toHaveCount(0);
    } finally {
      await sql`DELETE FROM categories WHERE id = ${category.id}`;
    }
  });
}
