import "server-only";
import { cookies } from "next/headers";

const COOKIE = "isupply_shown_once";

export type ShownOnce = {
  kind: "rep" | "customer";
  subjectId: string;
  login: string;
  password: string;
};

/**
 * A new credential handed back exactly once, in a 30-second cookie rather than
 * the URL: query strings land in address bars, history and every proxy's
 * access log, which outlive "shown once" by their retention. The same reasoning
 * as the admin's existing customer reset. Base64 so the JSON's quotes and
 * commas never meet cookie syntax.
 */
export async function setShownOnce(value: ShownOnce): Promise<void> {
  (await cookies()).set(COOKIE, Buffer.from(JSON.stringify(value)).toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30,
  });
}

/** Only the credential minted for this subject; anything else reads as absent. */
export async function readShownOnce(
  kind: ShownOnce["kind"],
  subjectId: string,
): Promise<ShownOnce | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ShownOnce;
    return value.kind === kind &&
      value.subjectId === subjectId &&
      typeof value.login === "string" &&
      typeof value.password === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * Called by the page once the credential is on screen (review L-24). Until
 * then the plaintext password sat in the browser and rode on every request for
 * the cookie's 30 seconds. Not a Server Action: deleting a cookie in one makes
 * Next re-render the page, which would take the credential off the screen the
 * moment it appeared.
 */
export async function clearShownOnce(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
