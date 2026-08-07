"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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

export async function signUpAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("passwordConfirm") ?? "");
  const company = String(formData.get("company") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!email || !company || !contactName || !phone) {
    redirect(`/${locale}/account/signup?error=incomplete`);
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
  revalidatePath("/", "layout");
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
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const user = await findUserByEmail(email);
  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);

  if (!user || !ok) {
    redirect(`/${locale}/account/signin?error=failed`);
  }

  await setSessionCookie(user.id);
  await touchLastLogin(user.id);
  revalidatePath("/", "layout");
  // The stored preference decides where you land, and only that. Every page
  // still reads its language from the URL, so a link someone shares opens in
  // the language they meant rather than the language the recipient prefers.
  redirect(`/${isLocale(user.locale) ? user.locale : locale}/account`);
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  await clearSessionCookie();
  revalidatePath("/", "layout");
  redirect(`/${locale}`);
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const id = await currentUserId();
  if (!id) redirect(`/${locale}/account/signin`);

  // The preference comes from its own field, not from the page's locale.
  // Taking it from the URL meant saving the profile from an English page
  // silently reset a Persian preference, and vice versa — the setting could
  // never survive being edited from the "wrong" side of the site.
  const preferred = String(formData.get("preferredLocale") ?? "");

  await updateProfile(id, {
    company: String(formData.get("company") ?? "").trim(),
    contactName: String(formData.get("contactName") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    defaultPoNumber: String(formData.get("defaultPoNumber") ?? "").trim(),
    locale: isLocale(preferred) ? (preferred as Locale) : locale,
  });
  revalidatePath("/", "layout");
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

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("newPasswordConfirm") ?? "");

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
