import { test, expect, type APIRequestContext } from "@playwright/test";
import { CLIENT_ADDRESS_HEADER } from "./clientAddress";

/**
 * Attempts one address has already had refused do not count against every
 * admin (fix review, 2026-09-30).
 *
 * The admin sign-in had a ceiling across all addresses that counted every
 * attempt, refused ones included, so a single address sending junk past its
 * own limit reached it and locked every admin out. Now only failures that the
 * per-address limit let through count there (`lib/signInGuard.ts`).
 *
 * Each run records 8 failures against the shared admin count (60 per 15
 * minutes), so clear `request_rate_limits` before rerunning the suite many
 * times in a row.
 */
function randomAddress(): string {
  const octet = () => 1 + Math.floor(Math.random() * 250);
  return `10.${octet()}.${octet()}.${octet()}`;
}

async function signIn(request: APIRequestContext, form: Record<string, string>, address: string) {
  const response = await request.post("/en/admin/login", {
    multipart: form,
    headers: { [CLIENT_ADDRESS_HEADER]: address },
    maxRedirects: 0,
  });
  return response.headers()["location"] ?? "";
}

test("one address sending junk cannot lock the other admins out", async ({ request, isMobile }) => {
  test.skip(isMobile, "The response does not depend on the device.");

  const html = await (await request.get("/en/admin/login")).text();
  const actionField = html.match(/\$ACTION_ID_[0-9a-f]+/)?.[0];
  expect(actionField, "the sign-in form's action field").toBeTruthy();
  const form = (password: string) => ({ [actionField!]: "", locale: "en", password });

  const attacker = randomAddress();
  const outcomes = { wrong: 0, refused: 0 };
  for (let i = 0; i < 70; i++) {
    const location = await signIn(request, form(`wrong-${i}`), attacker);
    if (location.includes("error=rate-limit")) outcomes.refused++;
    else if (location.includes("error=1")) outcomes.wrong++;
  }
  // The per-address limit checks 8 and refuses the rest.
  expect(outcomes).toEqual({ wrong: 8, refused: 62 });

  const password = process.env.E2E_ADMIN_PASSWORD ?? "ci-admin-password";
  expect(await signIn(request, form(password), randomAddress())).toMatch(/\/en\/admin$/);
});
