import { test, expect } from "@playwright/test";

/**
 * A large form post to a page that uploads nothing is refused before Next
 * reads it (`src/proxy.ts`, `lib/actionBodyLimit.ts`, review M-16).
 *
 * Two ways past it existed until the fix review of 2026-09-30: the public
 * admin sign-in page counted as an upload page, and a form posted without the
 * `Next-Action` header — as a browser does before the page's JavaScript runs —
 * never reached the check at all, because Next treats every multipart POST as
 * a possible action.
 */
test("large form posts to non-upload pages are refused, with or without the action header", async ({
  request,
  isMobile,
}) => {
  test.skip(isMobile, "The response does not depend on the device.");

  const html = await (await request.get("/en/admin/login")).text();
  const actionId = html.match(/\$ACTION_ID_([0-9a-f]+)/)?.[1];
  expect(actionId, "the sign-in form's action id").toBeTruthy();

  const multipart = { [`$ACTION_ID_${actionId}`]: "", locale: "en", pad: "a".repeat(2_000_000) };
  const cases: [path: string, withHeader: boolean][] = [
    ["/en/cart", false],
    ["/en/admin/login", false],
    ["/en/admin/login", true],
  ];
  for (const [path, withHeader] of cases) {
    const response = await request.post(path, {
      multipart,
      headers: withHeader ? { "next-action": actionId! } : {},
      maxRedirects: 0,
    });
    expect(response.status(), `${path} ${withHeader ? "with" : "without"} the header`).toBe(413);
  }
});
