"use server";

import { redirect } from "next/navigation";
import { safeLocale, isLocale, type Locale } from "@/lib/i18n";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import {
  setSessionCookie,
  clearSessionCookie,
  currentUserId,
  currentUser,
} from "@/lib/session";
import {
  createUser,
  findUserByEmail,
  touchLastLogin,
  updateProfile,
  setPassword,
  getPasswordHash,
} from "@/db/userQueries";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";

/**
 * None of these actions revalidate, deliberately.
 *
 * Nothing that is cached renders who you are: the masthead links to /account
 * unconditionally rather than reading the session, so that catalog pages can
 * stay static, and /account and its children are rendered on demand. Signing
 * in changes only the cookie, and the cookie is read per request.
 *
 * These each ended in `revalidatePath("/", "layout")`, which threw away every
 * prerendered page in the app on each sign-in, sign-out and profile save. The
 * request that followed had to rebuild them, and that was the hang: /admin was
 * unaffected only because admin sign-in touches neither the cache nor the
 * database.
 */
export async function signUpAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const limit = await consumeRateLimit("account:sign-up", RATE_LIMITS.accountSignUp);
  if (!limit.allowed) redirect(`/${locale}/account/signup?error=rate-limit`);

  const email = boundedString(formData.get("email"), REQUEST_LIMITS.emailChars)?.toLowerCase();
  const password = boundedString(formData.get("password"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });
  const confirm = boundedString(formData.get("passwordConfirm"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });
  const company = boundedString(formData.get("company"), REQUEST_LIMITS.companyChars);
  const contactName = boundedString(
    formData.get("contactName"),
    REQUEST_LIMITS.contactNameChars,
  );
  const phone = boundedString(formData.get("phone"), REQUEST_LIMITS.phoneChars);

  if (!email || !password || !confirm || !company || !contactName || !phone) {
    redirect(`/${locale}/account/signup?error=incomplete`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect(`/${locale}/account/signup?error=invalid`);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    redirect(`/${locale}/account/signup?error=short`);
  }
  if (password !== confirm) {
    redirect(`/${locale}/account/signup?error=mismatch`);
  }

  const created = await createUser({
    email,
    passwordHash: await hashPassword(password),
    company,
    contactName,
    phone,
    locale,
  });
  if (created === "email-taken") {
    redirect(`/${locale}/account/signup?error=taken`);
  }

  await setSessionCookie(created.id);
  redirect(`/${locale}/account`);
}

/**
 * One failure message and one code path for "no such account" and "wrong
 * password" alike.
 *
 * Distinguishing them turns this form into an oracle for which addresses have
 * accounts — worth something on its own, and worth more when the same
 * addresses appear in a credential dump from somewhere else. The dummy verify
 * against a fixed hash keeps the timing of the two cases comparable, which is
 * the other half of the same leak: without it, an unknown address returns
 * noticeably faster than a known one.
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function signInAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const limit = await consumeRateLimit("account:sign-in", RATE_LIMITS.accountSignIn);
  if (!limit.allowed) redirect(`/${locale}/account/signin?error=rate-limit`);

  const email = boundedString(formData.get("email"), REQUEST_LIMITS.emailChars)?.toLowerCase();
  const password = boundedString(formData.get("password"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });

  const user = email ? await findUserByEmail(email) : null;
  const ok = await verifyPassword(password ?? "", user ? user.passwordHash : DUMMY_HASH);

  if (!user || !ok) {
    redirect(`/${locale}/account/signin?error=failed`);
  }

  await setSessionCookie(user.id);
  await touchLastLogin(user.id);
  // The stored preference decides where you land, and only that. Every page
  // still reads its language from the URL, so a link someone shares opens in
  // the language they meant rather than the language the recipient prefers.
  redirect(`/${isLocale(user.locale) ? user.locale : locale}/account`);
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  await clearSessionCookie();
  redirect(`/${locale}`);
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const id = await currentUserId();
  if (!id) redirect(`/${locale}/account/signin`);
  const limit = await consumeRateLimit("account:write", RATE_LIMITS.accountWrite, {
    accountId: id,
  });
  if (!limit.allowed) redirect(`/${locale}/account?error=rate-limit#profile`);

  // The preference comes from its own field, not from the page's locale.
  // Taking it from the URL meant saving the profile from an English page
  // silently reset a Persian preference, and vice versa — the setting could
  // never survive being edited from the "wrong" side of the site.
  const preferred = String(formData.get("preferredLocale") ?? "");

  const company = boundedString(formData.get("company"), REQUEST_LIMITS.companyChars, {
    allowEmpty: true,
  });
  const contactName = boundedString(
    formData.get("contactName"),
    REQUEST_LIMITS.contactNameChars,
    { allowEmpty: true },
  );
  const phone = boundedString(formData.get("phone"), REQUEST_LIMITS.phoneChars, {
    allowEmpty: true,
  });
  const defaultPoNumber = boundedString(
    formData.get("defaultPoNumber"),
    REQUEST_LIMITS.poNumberChars,
    { allowEmpty: true },
  );
  if ([company, contactName, phone, defaultPoNumber].some((value) => value === null)) {
    redirect(`/${locale}/account?error=invalid#profile`);
  }

  await updateProfile(id, {
    company: company!,
    contactName: contactName!,
    phone: phone!,
    defaultPoNumber: defaultPoNumber!,
    locale: isLocale(preferred) ? (preferred as Locale) : locale,
  });
  redirect(`/${locale}/account?ok=profile#profile`);
}

/**
 * Changing your own password, which is why it demands the current one.
 *
 * A signed-in session is not on its own proof of identity here: a borrowed or
 * unattended browser is exactly the case where someone would change a password
 * to lock the owner out. Re-entering the current one costs the real user a few
 * seconds and stops that.
 *
 * Known gap, shared with the staff reset: this does not end the account's other
 * sessions, because the signed cookie commits only to a user id and an expiry.
 */
export async function changePasswordAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const user = await currentUser();
  if (!user) redirect(`/${locale}/account/signin`);
  const limit = await consumeRateLimit("account:write", RATE_LIMITS.accountWrite, {
    accountId: user.id,
  });
  if (!limit.allowed) redirect(`/${locale}/account?error=rate-limit#profile`);

  const current = boundedString(formData.get("currentPassword"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });
  const next = boundedString(formData.get("newPassword"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });
  const confirm = boundedString(
    formData.get("newPasswordConfirm"),
    REQUEST_LIMITS.passwordChars,
    { trim: false },
  );
  if (!current || !next || !confirm) {
    redirect(`/${locale}/account?error=invalid#profile`);
  }

  const hash = await getPasswordHash(user.id);
  if (!hash || !(await verifyPassword(current, hash))) {
    redirect(`/${locale}/account?error=current-password#profile`);
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    redirect(`/${locale}/account?error=short#profile`);
  }
  if (next !== confirm) {
    redirect(`/${locale}/account?error=mismatch#profile`);
  }

  await setPassword(user.id, await hashPassword(next));
  redirect(`/${locale}/account?ok=password#profile`);
}
