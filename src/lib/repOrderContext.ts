import "server-only";
import { cookies } from "next/headers";
import { isUuid } from "./ids";

const COOKIE = "isupply_rep_for";

/**
 * Which customer a rep is ordering for, carried from their customer page
 * through the catalog to checkout. It holds only an id; every reader
 * re-checks that the customer is still the signed-in rep's, so a stale or
 * edited cookie selects nothing.
 */
export async function setOrderingFor(customerId: string): Promise<void> {
  (await cookies()).set(COOKIE, customerId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
}

export async function clearOrderingFor(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function readOrderingFor(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE)?.value ?? "";
  return isUuid(value) ? value : null;
}
