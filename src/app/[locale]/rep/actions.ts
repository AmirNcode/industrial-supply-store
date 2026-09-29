"use server";

import { redirect } from "next/navigation";
import { safeLocale, type Locale } from "@/lib/i18n";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { recordSignInFailure, rememberSignInDevice, signInLocked } from "@/lib/signInGuard";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "@/lib/password";
import { normalizeRepPassword, repPasswordProblems } from "@/lib/repPassword";
import { FOLLOW_UP_DAYS, isValidUsername, normalizeUsername } from "@/lib/repAccount";
import { latinDigits } from "@/lib/digits";
import { isUuid } from "@/lib/ids";
import { generateTempPassword } from "@/lib/tempPassword";
import { tehranDatePlusDays } from "@/lib/persianCalendar";
import { setShownOnce } from "@/lib/shownOnce";
import { redirectFresh } from "@/lib/redirectFresh";
import { setOrderingFor } from "@/lib/repOrderContext";
import { CartCapacityError, addLines } from "@/lib/cart";
import { getReorderLines, repCanSeeOrder } from "@/db/repOrderQueries";
import { getInvoiceDraft, issueInvoice } from "@/db/invoiceQueries";
import { acceptsPaymentProof, isOrderStatus } from "@/lib/orders";
import { receivePaymentProof, type ProofUploadResult } from "@/lib/paymentProofUpload";
import { getFxRate, getFxRateSource } from "@/lib/fx";
import { getVatRateBp } from "@/lib/vatSettings";
import { hasUnpricedLine, subtotalCents } from "@/lib/invoice";
import {
  findRepForSignIn,
  getRepPasswordHash,
  setRepPassword,
  touchRepLogin,
  type RepRow,
} from "@/db/repQueries";
import {
  createCustomerForRep,
  getCustomerForRep,
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
  // Per address on every attempt; per username on failures only, with a
  // browser the rep has signed in from let through (lib/signInGuard.ts).
  // Counting every attempt against the username let anyone lock a rep out.
  const limit = await consumeRateLimit("rep:sign-in", RATE_LIMITS.repSignIn);
  if (!limit.allowed) redirect(`/${locale}/rep/signin?error=rate-limit`);
  if (username && (await signInLocked("rep", username))) {
    redirect(`/${locale}/rep/signin?error=rate-limit`);
  }

  const rep = isValidUsername(username) ? await findRepForSignIn(username) : null;
  const ok = await verifyPassword(
    normalizeRepPassword(password ?? ""),
    rep ? rep.passwordHash : DUMMY_PASSWORD_HASH,
  );
  if (!rep || !ok || !rep.active) {
    if (username) await recordSignInFailure("rep", username);
    redirect(`/${locale}/rep/signin?error=failed`);
  }
  await rememberSignInDevice("rep", username);

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
  // Not theirs, not created by them, or already chosen by the customer: the
  // customer page 404s for the first and explains the rest.
  if (!customer) redirect(`/${locale}/rep/customers/${id}?error=reset-admin-only`);
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

export async function startOrderAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const id = postedCustomerId(formData);
  const customer = id ? await getCustomerForRep(rep.id, id) : null;
  if (!customer) redirect(`/${locale}/rep/customers`);
  await setOrderingFor(customer.id);
  // Quick order first: reps usually know the part numbers. The catalog is one
  // click away in the masthead, and the choice survives either route.
  redirect(`/${locale}/quick-order`);
}

/**
 * Repeat an order for the same customer: its lines go into the rep's cart,
 * the customer is remembered for checkout, and anything no longer sold is
 * named on the cart page rather than silently dropped.
 */
export async function reorderAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const ref = boundedString(formData.get("ref"), 20) ?? "";
  const found = await getReorderLines(rep.id, ref);
  if (!found) redirect(`/${locale}/rep/orders`);
  if (!found.customerId) redirect(`/${locale}/rep/orders/${ref}?error=not-yours`);
  try {
    await addLines(found.lines);
  } catch (error) {
    if (error instanceof CartCapacityError) redirect(`/${locale}/rep/orders/${ref}?error=cart-full`);
    throw error;
  }
  await setOrderingFor(found.customerId);
  // Part numbers are not sensitive, and the list is short: carried in the URL
  // so the cart can say what was left out.
  const skipped = found.missing.slice(0, 20).join(",");
  redirect(`/${locale}/cart${skipped ? `?skipped=${encodeURIComponent(skipped)}` : ""}`);
}

/**
 * Finalize the draft a rep has just checked: number the invoice and lock the
 * exchange rate and VAT rate, at the prices already on the order — a rep
 * never changes a price (`issueInvoice`).
 *
 * The draft posted the rate, VAT rate and subtotal it showed. If any has
 * moved since, the rep goes back to the draft, updated, rather than locking
 * figures they never saw.
 */
export async function issueInvoiceForRepAction(formData: FormData): Promise<void> {
  const { rep, locale } = await repForWrite(formData);
  const ref = boundedString(formData.get("ref"), 20) ?? "";
  // 404-shaped, like every other rep read: an order this rep may not see.
  if (!(await repCanSeeOrder(rep.id, ref))) redirect(`/${locale}/rep/orders`);
  const found = await getInvoiceDraft(ref);
  if (!found) redirect(`/${locale}/rep/orders`);
  const page = `/${locale}/rep/orders/${ref}`;
  if (found.order.status !== "received") redirect(`${page}?error=conflict`);
  if (hasUnpricedLine(found.items)) redirect(`${page}?error=unpriced`);
  // An invoice locks its rate for good; the placeholder is nobody's rate.
  if ((await getFxRateSource()) === "placeholder") redirect(`${page}?error=no-rate`);

  const [rate, vatRateBp] = await Promise.all([getFxRate(), getVatRateBp()]);
  if (
    Number(formData.get("rate")) !== rate ||
    Number(formData.get("vatRateBp")) !== vatRateBp ||
    Number(formData.get("subtotalCents")) !== subtotalCents(found.items)
  ) {
    redirect(`${page}/invoice?changed=1`);
  }

  const issued = await issueInvoice(found.order.id, { rate, vatRateBp });
  if (issued !== "issued") redirect(`${page}?error=${issued}`);
  redirect(`${page}?ok=invoiced`);
}

/**
 * A receipt the customer sent the rep — on WhatsApp, usually — uploaded on
 * their behalf and recorded as the rep's. Any order the rep may see.
 */
export async function uploadPaymentProofForRepAction(
  ref: string,
  formData: FormData,
): Promise<ProofUploadResult> {
  const locale = safeLocale(formData);
  const rep = await requireRep(locale);
  const limit = await consumeRateLimit("rep:write", RATE_LIMITS.repWrite, { accountId: rep.id });
  if (!limit.allowed) return { ok: false, problem: "rate-limited" };
  const safeRef = typeof ref === "string" ? ref.slice(0, 20) : "";
  if (!(await repCanSeeOrder(rep.id, safeRef))) return { ok: false, problem: "closed" };
  const found = await getInvoiceDraft(safeRef);
  if (!found || !isOrderStatus(found.order.status) || !acceptsPaymentProof(found.order.status)) {
    return { ok: false, problem: "closed" };
  }
  return receivePaymentProof(found.order.id, formData.get("file"), { kind: "rep", repId: rep.id });
}

