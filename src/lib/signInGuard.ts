import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { AUTH_SECRET } from "./authSecret";
import { RATE_LIMITS, consumeAccountCounter, peekAccountCounter, type RateLimitPolicy } from "./rateLimit";

/**
 * Per-account protection for the customer, rep and admin sign-in forms.
 *
 * The per-address limit alone let a guesser spread over many addresses try
 * every account without end (review M-1). Counting every attempt against the
 * account instead let anyone lock a rep out by failing on purpose (M-14). So:
 * only *failures* count against the account, keyed on the login as typed
 * (normalised) so an unknown login costs the same as a real one; once an
 * account has had too many, further attempts are refused — except from a
 * browser that has signed in to that account before, which carries a mark
 * only a correct password could have earned. The owner keeps working; a
 * stranger waits out the window.
 *
 * The admin has no login to key on — one shared password — so its "account"
 * is the password itself (`adminSignInKey`): every failure from every address
 * counts together, and changing ADMIN_PASSWORD retires every admin mark.
 */
export type SignInKind = "customer" | "rep" | "admin";

const POLICY: Record<SignInKind, RateLimitPolicy> = {
  customer: RATE_LIMITS.signInFailures,
  rep: RATE_LIMITS.signInFailures,
  admin: RATE_LIMITS.adminLoginFailures,
};
const DEVICE_DAYS = 180;

function scope(kind: SignInKind): string {
  return `${kind}:sign-in-failures`;
}

function cookieName(kind: SignInKind): string {
  return `isupply_known_${kind}`;
}

function deviceMark(kind: SignInKind, loginKey: string): string {
  return createHmac("sha256", AUTH_SECRET).update(`known-device\0${kind}\0${loginKey}`).digest("base64url");
}

/** True when this account has failed too often and this browser is not one it signed in from. */
export async function signInLocked(kind: SignInKind, loginKey: string): Promise<boolean> {
  const policy = POLICY[kind];
  if ((await peekAccountCounter(scope(kind), policy, loginKey)) < policy.limit) return false;
  const mark = (await cookies()).get(cookieName(kind))?.value;
  if (!mark) return true;
  const a = Buffer.from(mark);
  const b = Buffer.from(deviceMark(kind, loginKey));
  return !(a.length === b.length && timingSafeEqual(a, b));
}

/**
 * Logged once when an account locks, because it means someone is guessing —
 * for the admin, that every browser that has not signed in before is now
 * refused until the window passes. The login itself is not logged.
 */
export async function recordSignInFailure(kind: SignInKind, loginKey: string): Promise<void> {
  const policy = POLICY[kind];
  const count = await consumeAccountCounter(scope(kind), policy, loginKey);
  if (count === policy.limit) {
    console.error(`sign-in lockout (${kind}): ${policy.limit} failures in ${policy.windowSeconds}s from all addresses`);
  }
}

/** After a correct password: this browser may sign in to this account through a lockout. */
export async function rememberSignInDevice(kind: SignInKind, loginKey: string): Promise<void> {
  (await cookies()).set(cookieName(kind), deviceMark(kind, loginKey), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_DAYS * 24 * 60 * 60,
  });
}
