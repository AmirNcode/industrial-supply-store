"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { safeLocale } from "@/lib/i18n";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { setSessionCookie, clearSessionCookie, currentUserId } from "@/lib/session";
import {
  createUser,
  findUserByEmail,
  touchLastLogin,
  updateProfile,
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
  redirect(`/${locale}/account`);
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

  await updateProfile(id, {
    company: String(formData.get("company") ?? "").trim(),
    contactName: String(formData.get("contactName") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    defaultPoNumber: String(formData.get("defaultPoNumber") ?? "").trim(),
    locale,
  });
  revalidatePath("/", "layout");
  redirect(`/${locale}/account?ok=profile`);
}
