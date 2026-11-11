import "server-only";
import { cookies } from "next/headers";

/**
 * The identifier typed at step one of sign-in, carried to step two.
 *
 * A cookie rather than a query parameter: an email address in a URL lands in
 * browser history, proxy logs and the Referer of whatever the next page
 * loads. httpOnly, short-lived, and holding nothing but what the visitor just
 * typed — it grants nothing; the password or the emailed code does that.
 */
const COOKIE = "isupply_signin";
const MAX_AGE_SECONDS = 20 * 60;

export async function rememberSignInLogin(login: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, login.slice(0, 254), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readSignInLogin(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  return value ? value.slice(0, 254) : null;
}

export async function forgetSignInLogin(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/**
 * "Sign in, then back to checkout" — set at step one when the visitor came
 * from the checkout page, read once where sign-in finishes. A fixed flag, not
 * a return URL: a URL taken from the request is an open redirect.
 */
const THEN_COOKIE = "isupply_signin_then";

export async function rememberReturnToCheckout(on: boolean): Promise<void> {
  const jar = await cookies();
  if (!on) {
    jar.delete(THEN_COOKIE);
    return;
  }
  jar.set(THEN_COOKIE, "checkout", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** True once if sign-in should end at checkout; clears the flag either way. */
export async function takeReturnToCheckout(): Promise<boolean> {
  const jar = await cookies();
  const on = jar.get(THEN_COOKIE)?.value === "checkout";
  if (on) jar.delete(THEN_COOKIE);
  return on;
}
