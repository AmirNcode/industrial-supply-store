"use server";

import { redirect } from "next/navigation";
import { safeLocale, isLocale, type Locale } from "@/lib/i18n";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
  MIN_PASSWORD_LENGTH,
  needsRehash,
  unusablePasswordHash,
} from "@/lib/password";
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
  requireNewPassword,
} from "@/db/userQueries";
import { issueLoginCode, redeemLoginCode } from "@/db/loginCodeQueries";
import { LOGIN_CODE_TTL_MINUTES, normalizeLoginCode } from "@/lib/loginCode";
import { loginCodeEmail } from "@/lib/emailTemplates";
import { sendEmail } from "@/lib/email";
import { forgetSignInLogin, readSignInLogin, rememberSignInLogin } from "@/lib/signInLogin";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { digitsField, parseDelivery } from "@/lib/quoteContact";
import { addAddress, deleteAddress, setDefaultAddress, updateAddress } from "@/db/addressQueries";
import { isUuid } from "@/lib/ids";
import { CartCapacityError, addLines } from "@/lib/cart";
import { getReorderLinesForUser } from "@/db/accountQueries";
import { acceptQuote } from "@/lib/orderFlow";
import { recordSignInFailure, rememberSignInDevice, signInLocked } from "@/lib/signInGuard";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";
import { parseLogin, type LoginIdentifier } from "@/lib/customerCode";
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

/** Emails the account a fresh code. The caller has already rate-limited. */
async function sendLoginCode(user: { id: string; email: string | null }, locale: Locale): Promise<void> {
  if (!user.email) return;
  const code = await issueLoginCode(user.id);
  const mail = loginCodeEmail({ locale, code, minutes: LOGIN_CODE_TTL_MINUTES });
  await sendEmail({ kind: "login-code", to: user.email, secret: true, ...mail });
}

/**
 * Sign-up asks for no password. The account is created with one nobody
 * knows, a code goes to the address, and the first password is chosen after
 * the code proves the inbox (`setFirstPasswordAction`). So registering
 * someone else's address gains nothing — the old form let anyone do that and
 * hold the account (review M-13).
 *
 * An address that already has an account is not an error to show: the same
 * code page follows, and the code goes to the existing account's owner.
 * Saying "taken" would tell a stranger which addresses are customers.
 */
export async function signUpAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const limit = await consumeRateLimit("account:sign-up", RATE_LIMITS.accountSignUp);
  if (!limit.allowed) redirect(`/${locale}/account/signup?error=rate-limit`);

  const email = boundedString(formData.get("email"), REQUEST_LIMITS.emailChars)?.toLowerCase();
  const company = boundedString(formData.get("company"), REQUEST_LIMITS.companyChars);
  const contactName = boundedString(
    formData.get("contactName"),
    REQUEST_LIMITS.contactNameChars,
  );
  const phone = boundedString(formData.get("phone"), REQUEST_LIMITS.phoneChars);

  if (!email || !company || !contactName || !phone) {
    redirect(`/${locale}/account/signup?error=incomplete`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect(`/${locale}/account/signup?error=invalid`);
  }

  // A referral link opened in the last 30 days makes this the rep's customer,
  // commission on — the rep brought them in. Re-checked here: a rep deactivated
  // since the link was opened credits nobody.
  const referralCode = await readReferralCode();
  const referrer = referralCode ? await getActiveRepByReferralCode(referralCode) : null;

  const created = await createUser({
    email,
    passwordHash: await unusablePasswordHash(),
    company,
    contactName,
    phone,
    locale,
    origin: referrer ? "referral" : "self",
    repId: referrer?.id ?? null,
    accountNumber: formData.get("accountNumber") === "assigned" ? "assigned" : "phone",
  });
  if (referralCode && created !== "email-taken") await clearReferralCookie();

  const sendLimit = await consumeRateLimit("account:code-send", RATE_LIMITS.loginCodeSend, {
    accountId: `email:${email}`,
  });
  if (sendLimit.allowed) {
    const user = created === "email-taken" ? await findUserForSignIn({ kind: "email", email }) : created;
    if (user?.codeSignIn) await sendLoginCode(user, locale);
  }
  await rememberSignInLogin(email);
  redirect(`/${locale}/account/signin/code`);
}

function loginKeyOf(login: LoginIdentifier): string {
  return login.kind === "code" ? `code:${login.code}` : `email:${login.email}`;
}

/**
 * Step one of sign-in: who are you. The identifier is remembered in a
 * short-lived httpOnly cookie rather than carried in the URL, where an email
 * address would end up in history and logs.
 *
 * An account that has never chosen a password (made at checkout or sign-up)
 * has nothing to type at a password prompt, so it is sent a code instead.
 * Everything else — including an identifier with no account — goes to the
 * password step, so this form tells a stranger nothing about who has an
 * account beyond what an inbox they control already would.
 */
export async function signInStartAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const limit = await consumeRateLimit("account:sign-in", RATE_LIMITS.accountSignIn);
  if (!limit.allowed) redirect(`/${locale}/account/signin?error=rate-limit`);

  const raw = boundedString(formData.get("login"), REQUEST_LIMITS.emailChars);
  const login = raw ? parseLogin(raw) : null;
  if (!login) redirect(`/${locale}/account/signin?error=failed`);
  await rememberSignInLogin(login.kind === "code" ? login.code : login.email);

  const user = await findUserForSignIn(login);
  if (user?.codeSignIn && user.needsPassword) {
    const sendLimit = await consumeRateLimit("account:code-send", RATE_LIMITS.loginCodeSend, {
      accountId: loginKeyOf(login),
    });
    if (sendLimit.allowed) await sendLoginCode(user, locale);
    redirect(`/${locale}/account/signin/code`);
  }
  redirect(`/${locale}/account/signin?step=password`);
}

/**
 * "Email me a code instead", from the password step — also the answer to a
 * forgotten password. The code page follows whether or not the identifier
 * has an account that can be sent one, for the reason above.
 */
export async function signInCodeStartAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const remembered = await readSignInLogin();
  const login = remembered ? parseLogin(remembered) : null;
  if (!login) redirect(`/${locale}/account/signin`);
  const limit = await consumeRateLimit("account:code-send", RATE_LIMITS.loginCodeSend, {
    accountId: loginKeyOf(login),
  });
  if (!limit.allowed) redirect(`/${locale}/account/signin/code?error=rate-limit`);
  const user = await findUserForSignIn(login);
  if (user?.codeSignIn) await sendLoginCode(user, locale);
  redirect(`/${locale}/account/signin/code?sent=1`);
}

/**
 * Step two, by code. A correct code proves the inbox, which is more than a
 * password proves, so it signs the browser in — and then the stored password
 * is no longer trusted (`requireNewPassword`): the next page is the one that
 * chooses a new one, and until it is chosen the account pages lead nowhere
 * else. That one rule covers a first sign-in, a forgotten password, and an
 * account someone else registered with this address.
 */
export async function verifyLoginCodeAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const limit = await consumeRateLimit("account:code-check", RATE_LIMITS.loginCodeCheck);
  if (!limit.allowed) redirect(`/${locale}/account/signin/code?error=rate-limit`);

  const remembered = await readSignInLogin();
  const login = remembered ? parseLogin(remembered) : null;
  if (!login) redirect(`/${locale}/account/signin`);
  const code = normalizeLoginCode(String(formData.get("code") ?? "").slice(0, 40));
  const user = await findUserForSignIn(login);
  if (!code || !user || !user.codeSignIn) redirect(`/${locale}/account/signin/code?error=wrong`);

  const checked = await redeemLoginCode(user.id, code);
  if (checked !== "ok") redirect(`/${locale}/account/signin/code?error=${checked}`);

  await requireNewPassword(user.id);
  await setSessionCookie(user.id);
  await touchLastLogin(user.id);
  await forgetSignInLogin();
  const landing = isLocale(user.locale) ? user.locale : locale;
  redirect(`/${landing}/account/password/new`);
}

/**
 * The first password of an account that has none it can use (`needsPassword`).
 * No current password is asked for: there is none the customer knows, and
 * this session exists only because a code sent to their inbox was entered.
 * Refused for anyone not flagged, so it cannot become a way around the
 * ordinary change-password form, which does ask.
 */
export async function setFirstPasswordAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const user = await currentUser();
  if (!user) redirect(`/${locale}/account/signin`);
  if (!user.needsPassword) redirect(`/${locale}/account`);
  const back = `/${locale}/account/password/new`;
  const limit = await consumeRateLimit("account:write", RATE_LIMITS.accountWrite, {
    accountId: user.id,
  });
  if (!limit.allowed) redirect(`${back}?error=rate-limit`);

  const next = boundedString(formData.get("newPassword"), REQUEST_LIMITS.passwordChars, { trim: false });
  const confirm = boundedString(formData.get("passwordAgain"), REQUEST_LIMITS.passwordChars, { trim: false });
  if (!next || !confirm) redirect(`${back}?error=invalid`);
  if (next.length < MIN_PASSWORD_LENGTH) redirect(`${back}?error=short`);
  if (next !== confirm) redirect(`${back}?error=mismatch`);

  await setPassword(user.id, await hashPassword(next), false);
  // The change ended every session, this one too; reissue this one.
  await setSessionCookie(user.id);
  redirect(`/${locale}/account?ok=password`);
}

/**
 * Step two, by password. One failure message and one code path for "no such
 * account" and "wrong password" alike — whether the account was named by
 * email or customer ID.
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

  // The identifier from step one; a posted `login` still works, so a password
  // manager that fills both fields into one form is not turned away.
  const raw =
    boundedString(formData.get("login"), REQUEST_LIMITS.emailChars) ?? (await readSignInLogin());
  const password = boundedString(formData.get("password"), REQUEST_LIMITS.passwordChars, {
    trim: false,
  });

  const login = raw ? parseLogin(raw) : null;
  // The login as typed, normalised — not the user id — so an unknown login
  // is counted and refused exactly like a real one (lib/signInGuard.ts).
  const loginKey = login ? loginKeyOf(login) : null;
  const user = login ? await findUserForSignIn(login) : null;
  if (loginKey && (await signInLocked("customer", loginKey, user?.sessionVersion ?? null))) {
    redirect(`/${locale}/account/signin?error=rate-limit`);
  }
  const ok = await verifyPassword(password ?? "", user ? user.passwordHash : DUMMY_PASSWORD_HASH);

  if (!user || !ok) {
    if (loginKey) await recordSignInFailure("customer", loginKey);
    redirect(`/${locale}/account/signin?step=password&error=failed`);
  }
  if (loginKey) await rememberSignInDevice("customer", loginKey, user.sessionVersion);
  if (needsRehash(user.passwordHash)) {
    await upgradePasswordHash(user.id, user.passwordHash, await hashPassword(password ?? ""));
  }

  await setSessionCookie(user.id);
  await touchLastLogin(user.id);
  await forgetSignInLogin();
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
  const nationalId = digitsField(formData.get("nationalId"), REQUEST_LIMITS.taxIdChars);
  const economicCode = digitsField(formData.get("economicCode"), REQUEST_LIMITS.taxIdChars);
  if (
    [company, contactName, phone, defaultPoNumber, nationalId, economicCode].some((value) => value === null)
  ) {
    redirect(`/${locale}/account?error=invalid#profile`);
  }

  await updateProfile(id, {
    company: company!,
    contactName: contactName!,
    phone: phone!,
    defaultPoNumber: defaultPoNumber!,
    locale: isLocale(preferred) ? (preferred as Locale) : locale,
    nationalId: nationalId!,
    economicCode: economicCode!,
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

/** The label, recipient and phone of a saved address — all optional. */
function addressExtras(formData: FormData): { label: string; recipient: string; phone: string } | null {
  const label = boundedString(formData.get("label"), REQUEST_LIMITS.addressLabelChars, { allowEmpty: true });
  const recipient = boundedString(formData.get("recipient"), REQUEST_LIMITS.contactNameChars, { allowEmpty: true });
  const phone = boundedString(formData.get("addressPhone"), REQUEST_LIMITS.phoneChars, { allowEmpty: true });
  return label === null || recipient === null || phone === null ? null : { label, recipient, phone };
}

/**
 * Add, or edit when `addressId` is posted. Saved addresses are the signed-in
 * customer's alone: every write carries the session's user id into the query,
 * so an id belonging to someone else matches nothing.
 */
export async function saveAddressAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const user = await currentUser();
  if (!user) redirect(`/${locale}/account/signin`);
  const back = `/${locale}/account`;
  const limit = await consumeRateLimit("account:write", RATE_LIMITS.accountWrite, { accountId: user.id });
  if (!limit.allowed) redirect(`${back}?error=rate-limit#addresses`);

  const delivery = parseDelivery(formData);
  const extras = addressExtras(formData);
  if ("error" in delivery || !extras) redirect(`${back}?error=address#addresses`);
  const input = { ...extras, ...delivery };

  const id = String(formData.get("addressId") ?? "");
  if (id !== "") {
    if (!isUuid(id) || !(await updateAddress(user.id, id, input))) redirect(`${back}?error=address#addresses`);
  } else if ((await addAddress(user.id, input, formData.get("makeDefault") === "on")) === "full") {
    redirect(`${back}?error=address-full#addresses`);
  }
  redirect(`${back}?ok=address#addresses`);
}

export async function setDefaultAddressAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const user = await currentUser();
  if (!user) redirect(`/${locale}/account/signin`);
  const limit = await consumeRateLimit("account:write", RATE_LIMITS.accountWrite, { accountId: user.id });
  if (!limit.allowed) redirect(`/${locale}/account?error=rate-limit#addresses`);
  const id = String(formData.get("addressId") ?? "");
  if (isUuid(id)) await setDefaultAddress(user.id, id);
  redirect(`/${locale}/account?ok=address#addresses`);
}

export async function deleteAddressAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const user = await currentUser();
  if (!user) redirect(`/${locale}/account/signin`);
  const limit = await consumeRateLimit("account:write", RATE_LIMITS.accountWrite, { accountId: user.id });
  if (!limit.allowed) redirect(`/${locale}/account?error=rate-limit#addresses`);
  const id = String(formData.get("addressId") ?? "");
  if (isUuid(id)) await deleteAddress(user.id, id);
  redirect(`/${locale}/account?ok=address#addresses`);
}

/**
 * Put a past order's lines back in the cart. Anything no longer sold is named
 * on the cart page rather than silently dropped; quantities are what was
 * ordered, and today's stock and prices apply at checkout like any cart.
 */
export async function reorderAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const user = await currentUser();
  if (!user) redirect(`/${locale}/account/signin`);
  const limit = await consumeRateLimit("account:write", RATE_LIMITS.accountWrite, { accountId: user.id });
  if (!limit.allowed) redirect(`/${locale}/account?error=rate-limit`);
  const ref = boundedString(formData.get("ref"), 20) ?? "";
  const found = await getReorderLinesForUser(user.id, ref);
  if (!found) redirect(`/${locale}/account`);
  try {
    await addLines(found.lines);
  } catch (error) {
    if (error instanceof CartCapacityError) redirect(`/${locale}/account/orders/${ref}?error=cart-full`);
    throw error;
  }
  const skipped = found.missing.slice(0, 20).join(",");
  redirect(`/${locale}/cart${skipped ? `?skipped=${encodeURIComponent(skipped)}` : ""}`);
}

/**
 * Accept a quote on one of the signed-in customer's own orders: the
 * pish-factor is issued at today's rate and the 24 hours start.
 */
export async function acceptQuoteAction(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  const user = await currentUser();
  if (!user) redirect(`/${locale}/account/signin`);
  const ref = (boundedString(formData.get("ref"), 20) ?? "").slice(0, 20);
  const back = `/${locale}/account/orders/${ref}`;
  const limit = await consumeRateLimit("account:write", RATE_LIMITS.accountWrite, { accountId: user.id });
  if (!limit.allowed) redirect(`${back}?error=rate-limit`);
  const found = await getOrderForUser(user.id, ref);
  if (!found || found.order.status !== "quoted") redirect(back);
  const outcome = await acceptQuote(found.order.id, { kind: "customer", id: user.id });
  redirect(outcome === "issued" ? `${back}?ok=accepted` : `${back}?error=accept`);
}
