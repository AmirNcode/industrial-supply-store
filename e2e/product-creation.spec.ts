import "dotenv/config";
import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { getDict, type Locale } from "../src/lib/i18n";

// These tests write fixtures. They may never use a hosted production database.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Product-creation browser tests require an isolated local DATABASE_URL.");
}
const sql = postgres(databaseUrl, { max: 1 });
test.afterAll(() => sql.end());

for (const locale of ["en", "fa"] as Locale[]) {
  test(`${locale}: creating a product refuses duplicate and deleted part numbers`, async ({ page }, testInfo) => {
    const t = getDict(locale);
    const slug = `e2e-product-${locale}-${testInfo.workerIndex}-${Date.now()}`;
    const [category] = await sql`INSERT INTO categories (slug, path, depth, name_en, name_fa)
      VALUES (${slug}, ${slug}, 0, ${slug}, ${slug}) RETURNING id`;
    try {
      const [family] = await sql`INSERT INTO product_families (slug, category_id, name_en, name_fa)
        VALUES (${slug}, ${category.id}, ${slug}, ${slug}) RETURNING id`;
      const familyId = Number(family.id);
      await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": `203.0.113.${140 + testInfo.workerIndex}` });
      await page.goto(`/${locale}/admin/login`);
      await page.getByLabel(t.password).fill(process.env.E2E_ADMIN_PASSWORD ?? "ci-admin-password");
      await page.getByRole("button", { name: t.signIn }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/admin/orders`));
      await page.goto(`/${locale}/admin/products/${familyId}/new`);
      await page.getByLabel(t.price, { exact: true }).fill("12.34");
      await page.getByRole("button", { name: t.newProduct, exact: true }).click();
      await expect.poll(async () => {
        const [result] = await sql`SELECT count(*)::int AS n FROM products WHERE family_id = ${familyId!}`;
        return result.n;
      }).toBe(1);
      const [product] = await sql`SELECT id, part_number, price_cents FROM products WHERE family_id = ${familyId}`;
      await expect(page.getByText(t.newProductCreated.replace("{part}", product.part_number), { exact: true })).toBeVisible();
      expect(product.price_cents).toBe(1234);
      await page.getByLabel(t.partNumber, { exact: true }).fill(product.part_number);
      await page.getByLabel(t.price, { exact: true }).fill("99.99");
      await page.getByRole("button", { name: t.newProduct, exact: true }).click();
      await expect(page.getByText(t.newProductAlreadyExists, { exact: true })).toBeVisible();
      await expect(page.getByLabel(t.price, { exact: true })).toHaveValue("99.99");
      const [unchanged] = await sql`SELECT price_cents FROM products WHERE id = ${product.id}`;
      expect(unchanged.price_cents).toBe(1234);
      await sql`DELETE FROM products WHERE id = ${product.id}`;
      await page.getByRole("button", { name: t.newProduct, exact: true }).click();
      await expect(page.getByText(t.importReservedNumber, { exact: true })).toBeVisible();
      const [remaining] = await sql`SELECT count(*)::int AS n FROM products WHERE family_id = ${familyId}`;
      expect(remaining.n).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`${locale}-duplicate-protection.png`), fullPage: true });
    } finally {
      const [family] = await sql`SELECT family_number FROM product_families WHERE category_id = ${category.id}`;
      await sql`DELETE FROM categories WHERE id = ${category.id}`;
      if (family?.family_number) {
        await sql`DELETE FROM part_number_registry WHERE family_number = ${family.family_number}`;
      }
    }
  });
}

for (const locale of ["en", "fa"] as Locale[]) {
  test(`${locale}: CSV review submits both skip-invalid and generate-number choices`, async ({ page }, testInfo) => {
    const t = getDict(locale);
    const [family] = await sql`SELECT id FROM product_families ORDER BY id LIMIT 1`;
    const headers = [
      { plan: { header: "part_number", role: "builtin", field: "part_number" }, isNew: false },
      { plan: { header: "price_usd", role: "builtin", field: "price_usd" }, isNew: false },
    ];
    let appliedPlan: { autoNumber?: boolean; skipBadRows?: boolean } | undefined;
    // Only the transport is mocked here. Database review/allocation behavior
    // is covered by the integration suite; no hosted storage is used in CI.
    await page.route("**/storage/v1/object/upload/sign/**", async (route) => {
      await route.fulfill({ json: { Key: "catalog-imports/review.csv" } });
    });
    await page.route("**/api/admin/import", async (route) => {
      const input = route.request().postDataJSON();
      if (input.kind === "prepare") {
        await route.fulfill({ json: { upload: {
          browserUrl: new URL(page.url()).origin, browserKey: "test-only-key", bucket: "catalog-imports",
          path: "review.csv", storageToken: "test-only-token", handle: "test-only-handle",
        } } });
      } else if (input.stage === "review") {
        await route.fulfill({ json: { state: { kind: "review", familyId: family.id,
          headers, missing: [], rowCount: 2, problems: [],
          rowProblems: [{ row: 3, column: "price_usd", message: "Not a number" }], goodRows: 1, blankRows: 1,
          plan: { headers: headers.map((h) => h.plan), dropKeys: [], mode: "update", skipBadRows: false },
        } } });
      } else {
        appliedPlan = JSON.parse(input.plan);
        await route.fulfill({ json: { state: { kind: "ok", familyId: family.id, inserted: 1,
          updated: 0, removed: 0, addedColumns: 0, droppedColumns: 0, skipped: [], priceless: [], mismatches: [],
        } } });
      }
    });
    await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": `203.0.113.${180 + testInfo.workerIndex}` });
    await page.goto(`/${locale}/admin/login`);
    await page.getByLabel(t.password).fill(process.env.E2E_ADMIN_PASSWORD ?? "ci-admin-password");
    await page.getByRole("button", { name: t.signIn }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/orders`));
    await page.goto(`/${locale}/admin/products?cat=f:${family.id}`);
    const form = page.locator(".taxonomy-import-form").filter({ visible: true }).first();
    await form.locator('input[type="file"]').setInputFiles({ name: "review.csv", mimeType: "text/csv",
      buffer: Buffer.from("part_number,price_usd\n,10\n,not-a-price\n") });
    await form.getByRole("button", { name: new RegExp(t.uploadCsv) }).click();
    const confirm = form.getByRole("button", { name: t.reviewConfirm, exact: true });
    await expect(confirm).toBeDisabled();
    const number = new Intl.NumberFormat(locale).format(1);
    await form.getByLabel(t.reviewSkipBadRows.replace("{bad}", number).replace("{good}", number), { exact: true }).check();
    await expect(confirm).toBeDisabled();
    await form.getByLabel(t.reviewBlankPartsGenerate, { exact: true }).check();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect.poll(() => appliedPlan).toMatchObject({ autoNumber: true, skipBadRows: true });
    await expect(form.getByText(t.importSummary.replace("{inserted}", number).replace("{updated}", new Intl.NumberFormat(locale).format(0)), { exact: true })).toBeVisible();
  });
}
