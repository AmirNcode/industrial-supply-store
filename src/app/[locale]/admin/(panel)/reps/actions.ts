"use server";

import { redirect } from "next/navigation";
import { assertAdminWrite } from "@/lib/admin";
import { safeLocale } from "@/lib/i18n";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";
import { hashPassword } from "@/lib/password";
import { normalizeRepPassword } from "@/lib/repPassword";
import { generateTempPassword } from "@/lib/tempPassword";
import { isValidUsername, normalizeUsername, parseCommissionPercent } from "@/lib/repAccount";
import { isUuid } from "@/lib/ids";
import { setShownOnce } from "@/lib/shownOnce";
import { parseRialAmount } from "@/lib/money";
import { persianYearMonth } from "@/lib/persianCalendar";
import { addPayout, setTarget, voidPayout } from "@/db/repMoney";
import {
  createRep,
  deactivateRep,
  getRepById,
  reactivateRep,
  setRepPassword,
  updateRep,
  type RepInput,
} from "@/db/repQueries";

/*
 * No revalidation anywhere here: nothing cached renders a rep. Every action
 * starts with assertAdminWrite(), which also refuses under DEMO_MODE.
 */

type RepFormError = "incomplete" | "username" | "commission" | "invalid";

function parseRepForm(formData: FormData): { input: RepInput } | { error: RepFormError } {
  const name = boundedString(formData.get("name"), REQUEST_LIMITS.contactNameChars);
  const username = normalizeUsername(boundedString(formData.get("username"), 64) ?? "");
  const phone = boundedString(formData.get("phone"), REQUEST_LIMITS.phoneChars, { allowEmpty: true });
  const email = boundedString(formData.get("email"), REQUEST_LIMITS.emailChars, { allowEmpty: true });
  const commissionRateBp = parseCommissionPercent(String(formData.get("commission") ?? ""));
  if (!name) return { error: "incomplete" };
  if (!isValidUsername(username)) return { error: "username" };
  if (commissionRateBp === null) return { error: "commission" };
  if (phone === null || email === null) return { error: "invalid" };
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "invalid" };
  return { input: { name, username, phone, email: email.toLowerCase(), commissionRateBp } };
}

export async function createRepAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const parsed = parseRepForm(formData);
  if ("error" in parsed) redirect(`/${locale}/admin/reps?error=${parsed.error}`);
  // Parsed before anything is written, so a bad target creates no rep.
  const rawTarget = String(formData.get("target") ?? "").trim();
  const target = rawTarget === "" ? null : parseRialAmount(rawTarget);
  if (rawTarget !== "" && target === null) redirect(`/${locale}/admin/reps?error=amount`);

  const password = generateTempPassword();
  const created = await createRep({
    ...parsed.input,
    passwordHash: await hashPassword(normalizeRepPassword(password)),
  });
  if (created === "username-taken") redirect(`/${locale}/admin/reps?error=username-taken`);
  if (target !== null) await setTarget(created.id, persianYearMonth(new Date()), target);

  await setShownOnce({ kind: "rep", subjectId: created.id, login: created.username, password });
  redirect(`/${locale}/admin/reps/${created.id}?ok=created`);
}

export async function updateRepAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/admin/reps`);
  const back = `/${locale}/admin/reps/${id}`;
  const parsed = parseRepForm(formData);
  if ("error" in parsed) redirect(`${back}?error=${parsed.error}`);
  const result = await updateRep(id, parsed.input);
  if (result === "not-found") redirect(`/${locale}/admin/reps`);
  redirect(result === "username-taken" ? `${back}?error=username-taken` : `${back}?ok=saved`);
}

export async function resetRepPasswordAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  const rep = isUuid(id) ? await getRepById(id) : null;
  if (!rep) redirect(`/${locale}/admin/reps`);

  const password = generateTempPassword();
  await setRepPassword(rep.id, await hashPassword(normalizeRepPassword(password)), true);
  await setShownOnce({ kind: "rep", subjectId: rep.id, login: rep.username, password });
  redirect(`/${locale}/admin/reps/${rep.id}?ok=password`);
}

export async function deactivateRepAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/admin/reps`);
  const raw = String(formData.get("destination") ?? "");
  const destination = raw === "" ? null : raw;
  if (destination !== null && !isUuid(destination)) {
    redirect(`/${locale}/admin/reps/${id}?error=destination`);
  }
  // An explicit choice at move time, never the flag set for the previous rep.
  const earn = formData.get("movedEarnCommission") === "on";
  const result = await deactivateRep(id, destination, earn);
  if (result === "bad-destination") redirect(`/${locale}/admin/reps/${id}?error=destination`);
  redirect(`/${locale}/admin/reps/${id}?ok=deactivated`);
}

export async function reactivateRepAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/admin/reps`);
  await reactivateRep(id);
  redirect(`/${locale}/admin/reps/${id}?ok=reactivated`);
}

/** A payment made to the rep outside the site, recorded so "owed" stays true. */
export async function addPayoutAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/admin/reps`);
  const amount = parseRialAmount(String(formData.get("amount") ?? ""));
  const note = boundedString(formData.get("note"), 500, { allowEmpty: true });
  if (amount === null || amount <= 0 || note === null) {
    redirect(`/${locale}/admin/reps/${id}?error=amount#payouts`);
  }
  await addPayout(id, amount, note);
  redirect(`/${locale}/admin/reps/${id}?ok=payout#payouts`);
}

export async function voidPayoutAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  const payoutId = Number(formData.get("payoutId"));
  if (!isUuid(id) || !Number.isSafeInteger(payoutId)) redirect(`/${locale}/admin/reps`);
  await voidPayout(id, payoutId);
  redirect(`/${locale}/admin/reps/${id}?ok=payout-voided#payouts`);
}

/** A target from the current Persian month on, until changed. */
export async function setTargetAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = String(formData.get("repId") ?? "");
  if (!isUuid(id)) redirect(`/${locale}/admin/reps`);
  const amount = parseRialAmount(String(formData.get("target") ?? ""));
  if (amount === null) redirect(`/${locale}/admin/reps/${id}?error=amount#target`);
  await setTarget(id, persianYearMonth(new Date()), amount);
  redirect(`/${locale}/admin/reps/${id}?ok=target#target`);
}
