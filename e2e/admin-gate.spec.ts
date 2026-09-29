import { test, expect } from "@playwright/test";

/**
 * A stranger asking for an admin page gets the sign-in redirect and nothing
 * else.
 *
 * Until 2026-09-29 the redirect carried the whole page — every open order's
 * contact details, pay links and staff notes, the customer list, stock — because
 * the only check lived in the panel layout, and Next renders the page anyway
 * (`src/lib/admin.ts`). A browser follows the redirect, so it never showed; only
 * a request that does not follow it can see the difference, which is what this
 * makes. `src/lib/adminGate.test.ts` covers every page structurally; this proves
 * the pages that list the most data stay empty at runtime.
 */
const ADMIN_PATHS = [
  "/fa/admin/orders",
  "/en/admin/orders?status=delivered",
  "/en/admin/customers",
  "/en/admin/reps",
  "/en/admin/settings",
  "/en/admin/products",
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

test("admin pages send a stranger to sign in and carry none of their data", async ({
  request,
  isMobile,
}) => {
  test.skip(isMobile, "The response does not depend on the device.");

  // The site's own contact address is in every page's header; anything else
  // with an @ in an anonymous admin response is someone's data.
  const publicEmails = new Set((await (await request.get("/en")).text()).match(EMAIL) ?? []);

  for (const path of ADMIN_PATHS) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers()["location"] ?? "", path).toMatch(/\/admin\/login$/);

    const body = await response.text();
    expect(body, `${path} carries an order reference`).not.toMatch(/ORD-[A-Z2-9]{6}/);
    expect(body, `${path} carries a pay link`).not.toMatch(/\/pay\/[0-9a-f]{64}/);
    expect(body, `${path} carries stock figures`).not.toContain("inventoryAvailable");
    const foreign = (body.match(EMAIL) ?? []).filter((email) => !publicEmails.has(email));
    expect(foreign, `${path} carries email addresses`).toEqual([]);
  }
});
