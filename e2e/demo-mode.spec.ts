import { test, expect } from "@playwright/test";

/**
 * The public demo publishes its admin panel on purpose, and nothing else.
 *
 * Under DEMO_MODE every visitor reads the order queue and every invoice. A pay
 * link is one order's key (it takes receipts and moves the order to payment
 * review) and a receipt carries bank details, so neither may appear there; the
 * product table's JSON is gated like the CSV export. Runs only against a
 * server started with DEMO_MODE=1 — set E2E_DEMO_MODE=1 alongside it.
 */
test("the demo shows no pay link, no receipt and no product JSON", async ({ request, isMobile }) => {
  test.skip(process.env.E2E_DEMO_MODE !== "1", "Needs a server running with DEMO_MODE=1.");
  test.skip(isMobile, "The response does not depend on the device.");

  const PAY_LINK = /\/pay\/[0-9a-f]{64}/;
  const refs = new Set<string>();
  for (const status of ["invoiced", "payment_review", "preparing"]) {
    const response = await request.get(`/en/admin/orders?status=${status}`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body, status).not.toMatch(PAY_LINK);
    for (const ref of body.match(/ORD-[A-Z2-9]{6}/g) ?? []) refs.add(ref);
  }
  expect(refs.size, "the demo database needs an invoiced order").toBeGreaterThan(0);

  for (const ref of [...refs].slice(0, 5)) {
    const invoice = await request.get(`/en/invoice/${ref}`);
    expect(invoice.status(), ref).toBe(200);
    expect(await invoice.text(), ref).not.toMatch(PAY_LINK);
    const draft = await request.get(`/en/admin/orders/${ref}/invoice`);
    expect(await draft.text(), ref).not.toMatch(PAY_LINK);
  }

  expect((await request.get("/api/payment-proofs/1")).status()).toBe(404);
  expect((await request.get("/api/admin/family/1/products")).status()).toBe(404);
});
