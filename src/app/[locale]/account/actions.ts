"use server";

import { redirect } from "next/navigation";
import { safeLocale, isLocale, type Locale } from "@/lib/i18n";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword, MIN_PASSWORD_LENGTH, needsRehash } from "@/lib/password";
import {
  setSessionCookie,
  clearSessionCookie,
  currentUserId,
  currentUser,
} from "@/lib/session";
import {
  createUser,
  findUserForSignIn,
  touchLastLogin,
  updateProfile,
  setPassword,
  getPasswordHash,
  upgradePasswordHash,
} from "@/db/userQueries";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { recordSignInFailure, rememberSignInDevice, signInLocked } from "@/lib/signInGuard";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";
import { parseLogin } from "@/lib/customerCode";
import { clearReferralCookie, readReferralCode } from "@/lib/referral";
import { getActiveRepByReferralCode } from "@/db/repQueries";
import { getOrderForUser } from "@/db/accountQueries";
import { acceptsPaymentProof } from "@/lib/orders";
import { receivePaymentProof, type ProofUploadResult } from "@/lib/paymentProofUpload";

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

  // A referral link opened in the last 30 days makes this the rep's customer,
  // commission on — the rep brought them in. Re-checked here: a rep deactivated
  // since the link was opened credits nobody.
  const referralCode = await readReferralCode();
  const referrer = referralCode ? await getActiveRepByReferralCode(referralCode) : null;

  const created = await createUser({
    email,
    passwordHash: await hashPassword(password),
    company,
    contactName,
    phone,
    locale,
    origin: referrer ? "referral" : "self",
    repId: referrer?.id ?? null,
  });
  if (created === "email-taken") {
    redirect(`/${locale}/account/signup?error=taken`);
  }
  if (referralCode) await clearReferralCookie();

  await setSessionCookie(created.id);
  redirect(`/${locale}/account`);
}

/**
 * One failure message and one code path for "no such account" and "wrong
 * password" alike — whether the account was named by email or customer ID.
 *
 * Distinguishing them turns this form into an oracle for which addresses have
 * accounts — worth something on its own, and worth more when the same
 * addresses appear in a credential dump from somewhere else. The dummy verify
 * against a fixed hash keeps the timing of the two cases comparable, which is
 * the other half of the same leak: without it, an unknown address returns
 * noticeably faster than a known one.
 */

export async function signInAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const limit = await consumeRateLimit("account:sign-in", RATE_LIMITS.accountSignIn);
  if (!limit.allowed) redirect(`/${locale}/account/signin?error=rate-limit`);

  const raw = boundedString(formData.get("login"), REQUEST_LIMITS.emailChars);
  const password = boundedString(formData.get("password"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });

  const login = raw ? parseLogin(raw) : null;
  // The login as typed, normalised — not the user id — so an unknown login
  // is counted and refused exactly like a real one (lib/signInGuard.ts).
  const loginKey = login ? (login.kind === "code" ? `code:${login.code}` : `email:${login.email}`) : null;
  if (loginKey && (await signInLocked("customer", loginKey))) {
    redirect(`/${locale}/account/signin?error=rate-limit`);
  }
  const user = login ? await findUserForSignIn(login) : null;
  const ok = await verifyPassword(password ?? "", user ? user.passwordHash : DUMMY_PASSWORD_HASH);

  if (!user || !ok) {
    if (loginKey) await recordSignInFailure("customer", loginKey);
    redirect(`/${locale}/account/signin?error=failed`);
  }
  if (loginKey) await rememberSignInDevice("customer", loginKey);
  if (needsRehash(user.passwordHash)) {
    await upgradePasswordHash(user.id, user.passwordHash, await hashPassword(password ?? ""));
  }

  await setSessionCookie(user.id);
  await touchLastLogin(user.id);
  // The stored preference decides where you land, and only that. Every page
  // still reads its language from the URL, so a link someone shares opens in
  // the language they meant rather than the language the recipient prefers.
  const landing = isLocale(user.locale) ? user.locale : locale;
  redirect(user.mustChangePassword ? `/${landing}/account/password` : `/${landing}/account`);
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
  const address = boundedString(formData.get("address"), REQUEST_LIMITS.addressChars, {
    allowEmpty: true,
  });
  const city = boundedString(formData.get("city"), REQUEST_LIMITS.cityChars, {
    allowEmpty: true,
  });
  if (
    [company, contactName, phone, defaultPoNumber, address, city].some((value) => value === null)
  ) {
    redirect(`/${locale}/account?error=invalid#profile`);
  }

  await updateProfile(id, {
    company: company!,
    contactName: contactName!,
    phone: phone!,
    defaultPoNumber: defaultPoNumber!,
    locale: isLocale(preferred) ? (preferred as Locale) : locale,
    address: address!,
    city: city!,
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
 * It ends every other session on the account (the cookie carries
 * `session_version`, which `setPassword` bumps); this one is reissued.
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

  await setPassword(user.id, await hashPassword(next), false);
  // The change ended every session, this one too; reissue this one.
  await setSessionCookie(user.id);
  redirect(`/${locale}/account?ok=password#profile`);
}

/**
 * The first password a customer chooses after a rep or admin set one for them.
 *
 * The temporary password is asked for again. The reset ended every session
 * opened before it, but anyone who learnt the temporary password could have
 * signed in since, and without this could choose the password first and lock
 * the customer out for good. Refused for
 * anyone not flagged, so it cannot become a way around the ordinary form.
 */
export async function setInitialPasswordAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const user = await currentUser();
  if (!user) redirect(`/${locale}/account/signin`);
  if (!user.mustChangePassword) redirect(`/${locale}/account`);
  const back = `/${locale}/account/password`;
  const limit = await consumeRateLimit("account:write", RATE_LIMITS.accountWrite, {
    accountId: user.id,
  });
  if (!limit.allowed) redirect(`${back}?error=rate-limit`);

  const current = boundedString(formData.get("currentPassword"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });
  const next = boundedString(formData.get("newPassword"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });
  const confirm = boundedString(formData.get("passwordAgain"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });
  if (!current || !next || !confirm) redirect(`${back}?error=invalid`);
  const hash = await getPasswordHash(user.id);
  if (!hash || !(await verifyPassword(current, hash))) redirect(`${back}?error=current-password`);
  if (next.length < MIN_PASSWORD_LENGTH) redirect(`${back}?error=short`);
  if (next !== confirm) redirect(`${back}?error=mismatch`);

  await setPassword(user.id, await hashPassword(next), false);
  // The change ended every session, this one too; reissue this one.
  await setSessionCookie(user.id);
  redirect(`/${locale}/account?ok=password#profile`);
}

/**
 * A receipt for one of the signed-in customer's own orders. Ownership is in
 * the query (`getOrderForUser`), so a reference that is someone else's
 * matches nothing and reads the same as a closed order.
 */
export async function uploadPaymentProofAction(
  ref: string,
  formData: FormData,
): Promise<ProofUploadResult> {
  const user = await currentUser();
  if (!user) return { ok: false, problem: "closed" };
  const limit = await consumeRateLimit("account:write", RATE_LIMITS.accountWrite, {
    accountId: user.id,
  });
  if (!limit.allowed) return { ok: false, problem: "rate-limited" };
  const found = typeof ref === "string" ? await getOrderForUser(user.id, ref.slice(0, 20)) : null;
  if (!found || !acceptsPaymentProof(found.order.status)) return { ok: false, problem: "closed" };
  return receivePaymentProof(found.order.id, formData.get("file"), { kind: "customer" });
}
