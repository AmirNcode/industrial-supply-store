"use server";

import { redirect } from "next/navigation";
import { safeLocale, type Locale } from "@/lib/i18n";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "@/lib/password";
import { normalizeRepPassword, repPasswordProblems } from "@/lib/repPassword";
import { FOLLOW_UP_DAYS, isValidUsername, normalizeUsername } from "@/lib/repAccount";
import { latinDigits } from "@/lib/digits";
import { isUuid } from "@/lib/ids";
import { generateTempPassword } from "@/lib/tempPassword";
import { tehranDatePlusDays } from "@/lib/persianCalendar";
import { setShownOnce } from "@/lib/shownOnce";
import { redirectFresh } from "@/lib/redirectFresh";
import {
  findRepForSignIn,
  getRepPasswordHash,
  setRepPassword,
  touchRepLogin,
  type RepRow,
} from "@/db/repQueries";
import {
  createCustomerForRep,
  resetCustomerPasswordForRep,
  setFollowUpForRep,
  updateCustomerForRep,
  type CustomerInput,
} from "@/db/customerQueries";
import { addNoteForRep } from "@/db/noteQueries";
import {
  clearRepSessionCookie,
  requireRep,
  requireRepSession,
  setRepSessionCookie,
} from "@/lib/repSession";

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

/** Every rep write: a current session, past any forced change, within the write limit. */
async function repForWrite(formData: FormData): Promise<{ rep: RepRow; locale: Locale }> {
  const locale = safeLocale(formData);
  const rep = await requireRep(locale);
  const limit = await consumeRateLimit("rep:write", RATE_LIMITS.repWrite, { accountId: rep.id });
  if (!limit.allowed) redirect(`/${locale}/rep?error=rate-limit`);
  return { rep, locale };
}

function postedCustomerId(formData: FormData): string | null {
  const id = String(formData.get("customerId") ?? "");
  return isUuid(id) ? id : null;
}

function parseCustomerForm(
  formData: FormData,
): { input: CustomerInput } | { error: "incomplete" | "invalid" } {
  const company = boundedString(formData.get("company"), REQUEST_LIMITS.companyChars);
  const contactName = boundedString(formData.get("contactName"), REQUEST_LIMITS.contactNameChars);
  const phone = boundedString(formData.get("phone"), REQUEST_LIMITS.phoneChars);
  const email = boundedString(formData.get("email"), REQUEST_LIMITS.emailChars, { allowEmpty: true });
  const address = boundedString(formData.get("address"), REQUEST_LIMITS.addressChars, { allowEmpty: true });
  const city = boundedString(formData.get("city"), REQUEST_LIMITS.cityChars, { allowEmpty: true });
  if (!company || !contactName || !phone) return { error: "incomplete" };
  if (email === null || address === null || city === null) return { error: "invalid" };
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "invalid" };
  return {
    input: {
      company,
      contactName,
      // Stored with ASCII digits so search, IDs and tel: links agree.
      phone: latinDigits(phone),
      email: email === "" ? null : email.toLowerCase(),
      address,
      city,
    },
  };
}

export async function createCustomerAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const back = `/${locale}/rep/customers/new`;
  const parsed = parseCustomerForm(formData);
  if ("error" in parsed) redirect(`${back}?error=${parsed.error}`);
  const codeChoice = formData.get("codeChoice") === "random" ? "random" : "phone";

  const password = generateTempPassword();
  const result = await createCustomerForRep(rep.id, {
    ...parsed.input,
    codeChoice,
    passwordHash: await hashPassword(password),
    locale,
  });
  if (result.kind !== "created") redirect(`${back}?error=${result.kind}`);

  await setShownOnce({ kind: "customer", subjectId: result.id, login: result.customerCode, password });
  redirect(`/${locale}/rep/customers/${result.id}?ok=created`);
}

export async function updateCustomerAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/rep/customers`);
  const back = `/${locale}/rep/customers/${id}`;
  const parsed = parseCustomerForm(formData);
  if ("error" in parsed) redirect(`${back}?error=${parsed.error}`);
  const result = await updateCustomerForRep(rep.id, id, parsed.input);
  if (result === "not-found") redirect(`/${locale}/rep/customers`);
  redirect(result === "email-taken" ? `${back}?error=email-taken` : `${back}?ok=saved`);
}

export async function resetCustomerPasswordAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/rep/customers`);
  const password = generateTempPassword();
  const customer = await resetCustomerPasswordForRep(rep.id, id, await hashPassword(password));
  if (!customer) redirect(`/${locale}/rep/customers`);
  await setShownOnce({ kind: "customer", subjectId: customer.id, login: customer.customerCode, password });
  redirect(`/${locale}/rep/customers/${customer.id}?ok=password`);
}

export async function addCustomerNoteAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/rep/customers`);
  const body = boundedString(formData.get("body"), 2000);
  if (!body) redirect(`/${locale}/rep/customers/${id}?error=invalid#notes`);
  if (!(await addNoteForRep(rep.id, id, body))) redirect(`/${locale}/rep/customers`);
  redirect(`/${locale}/rep/customers/${id}?ok=note#notes`);
}

export async function setFollowUpAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/rep/customers`);
  const choice = String(formData.get("days") ?? "");
  const days = Number(choice);
  const date =
    choice === "clear"
      ? null
      : (FOLLOW_UP_DAYS as readonly number[]).includes(days)
        ? tehranDatePlusDays(days)
        : undefined;
  if (date === undefined) redirect(`/${locale}/rep/customers/${id}?error=invalid#follow-up`);
  if (!(await setFollowUpForRep(rep.id, id, date))) redirect(`/${locale}/rep/customers`);
  redirectFresh(`/${locale}/rep/customers/${id}#follow-up`);
}
