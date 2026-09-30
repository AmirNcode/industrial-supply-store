import { test, expect } from "@playwright/test";

/**
 * Review finding M-6: every page sends the basic security headers, and the
 * pages one click from changing an order refuse to be framed at all.
 */
test("pages send security headers, and signed-in and money pages refuse framing", async ({
  request,
  isMobile,
}) => {
  test.skip(isMobile, "Headers do not depend on the device.");

  const home = await request.get("/fa");
  expect(home.headers()["x-content-type-options"]).toBe("nosniff");
  expect(home.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(home.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(home.headers()["x-powered-by"]).toBeUndefined();

  for (const path of ["/fa/admin/login", "/en/account/signin", "/en/rep/signin"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()["x-frame-options"], path).toBe("DENY");
    expect(response.headers()["content-security-policy"], path).toContain("frame-ancestors 'none'");
  }
  const pay = await request.get(`/en/pay/${"0".repeat(64)}`);
  expect(pay.headers()["referrer-policy"]).toBe("no-referrer");
  expect(pay.headers()["x-frame-options"]).toBe("DENY");
});
