"use server";

import { redirect } from "next/navigation";
import { safeLocale } from "@/lib/i18n";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "@/lib/password";
import { normalizeRepPassword, repPasswordProblems } from "@/lib/repPassword";
import { isValidUsername, normalizeUsername } from "@/lib/repAccount";
import {
  findRepForSignIn,
  getRepPasswordHash,
  setRepPassword,
  touchRepLogin,
} from "@/db/repQueries";
import { clearRepSessionCookie, requireRepSession, setRepSessionCookie } from "@/lib/repSession";

/*
 * No action in this file revalidates. Nothing cached renders a rep, a customer
 * record, a note or an order, and a whole-site purge is how production hung on
 * 2026-08-15 (docs/ARCHITECTURE.md). Every write takes the rep from the
 * session, never from the form.
 */

/**
 * One failure message for an unknown username, a wrong password and a
 * deactivated rep, verified against a dummy hash when there is no account —
 * the same reasoning as the customer sign-in: otherwise the form tells an
 * attacker which usernames exist.
 */
export async function repSignInAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const username = normalizeUsername(boundedString(formData.get("username"), 64) ?? "");
  const password = boundedString(formData.get("password"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });
  const limit = await consumeRateLimit("rep:sign-in", RATE_LIMITS.repSignIn, {
    accountId: username || null,
  });
  if (!limit.allowed) redirect(`/${locale}/rep/signin?error=rate-limit`);

  const rep = isValidUsername(username) ? await findRepForSignIn(username) : null;
  const ok = await verifyPassword(
    normalizeRepPassword(password ?? ""),
    rep ? rep.passwordHash : DUMMY_PASSWORD_HASH,
  );
  if (!rep || !ok || !rep.active) redirect(`/${locale}/rep/signin?error=failed`);

  await setRepSessionCookie(rep);
  await touchRepLogin(rep.id);
  redirect(rep.mustChangePassword ? `/${locale}/rep/password` : `/${locale}/rep`);
}

export async function repSignOutAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  await clearRepSessionCookie();
  redirect(`/${locale}/rep/signin`);
}

/**
 * Both the forced change after a temporary password and a voluntary one.
 *
 * A forced change asks only for the new password: the session was opened with
 * the temporary one moments ago. A voluntary change asks for the current one
 * too, because an unattended signed-in phone is exactly when someone would
 * change it to lock the owner out.
 */
export async function repChangePasswordAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const rep = await requireRepSession(locale);
  const back = `/${locale}/rep/password`;
  const limit = await consumeRateLimit("rep:write", RATE_LIMITS.repWrite, { accountId: rep.id });
  if (!limit.allowed) redirect(`${back}?error=rate-limit`);

  const next = boundedString(formData.get("newPassword"), REQUEST_LIMITS.passwordChars, { trim: false });
  const confirm = boundedString(formData.get("passwordAgain"), REQUEST_LIMITS.passwordChars, { trim: false });
  if (!next || !confirm) redirect(`${back}?error=invalid`);

  if (!rep.mustChangePassword) {
    const current = boundedString(formData.get("currentPassword"), REQUEST_LIMITS.passwordChars, {
      trim: false,
    });
    const hash = await getRepPasswordHash(rep.id);
    if (!current || !hash || !(await verifyPassword(normalizeRepPassword(current), hash))) {
      redirect(`${back}?error=current-password`);
    }
  }
  if (repPasswordProblems(next).length > 0) redirect(`${back}?error=policy`);
  if (normalizeRepPassword(next) !== normalizeRepPassword(confirm)) redirect(`${back}?error=mismatch`);

  const version = await setRepPassword(rep.id, await hashPassword(normalizeRepPassword(next)), false);
  if (version === null) redirect(`/${locale}/rep/signin`);
  // Every other session just ended with the version bump; this one is re-issued.
  await setRepSessionCookie({ id: rep.id, sessionVersion: version });
  redirect(`/${locale}/rep?ok=password`);
}
