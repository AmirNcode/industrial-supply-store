"use server";

import { redirect } from "next/navigation";
import { assertAdminWrite } from "@/lib/admin";
import { safeLocale } from "@/lib/i18n";
import { boundedString } from "@/lib/requestLimits";
import { hashPassword } from "@/lib/password";
import { generateTempPassword } from "@/lib/tempPassword";
import { isUuid, postedUuid } from "@/lib/ids";
import { FOLLOW_UP_DAYS, parseCommissionPercent } from "@/lib/repAccount";
import { MAX_ACCOUNT_REPS, parseSharePercent, type SplitRow } from "@/lib/commissionSplit";
import { tehranDatePlusDays } from "@/lib/persianCalendar";
import { setShownOnce } from "@/lib/shownOnce";
import { redirectFresh } from "@/lib/redirectFresh";
import { setAccountReps } from "@/db/accountRepQueries";
import { resetCustomerPasswordAdmin, setFollowUpAdmin } from "@/db/customerQueries";
import { addNoteAdmin } from "@/db/noteQueries";

function postedCustomerId(formData: FormData): string | null {
  return postedUuid(formData, "customerId");
}

/*
 * No action in this file revalidates: nothing cached renders a customer, and
 * a whole-site purge is how production hung on 2026-08-15.
 */

/**
 * Saves the account's reps, shares and commission rate in one write. The form
 * posts parallel `repId` / `share` fields, one pair per row; a row with no rep
 * chosen is an empty line and is dropped. An empty list is allowed: it
 * unassigns the customer. The client shows a running total, but only the
 * checks here and in `setAccountReps` count.
 */
export async function setAccountRepsAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/admin/customers`);
  const back = `/${locale}/admin/customers/${id}`;

  const repIds = formData.getAll("repId").map(String);
  const shares = formData.getAll("share").map(String);
  // Bounded before looping: a hand-built post could carry any number of rows.
  if (repIds.length > 2 * MAX_ACCOUNT_REPS || shares.length > repIds.length) redirect(`${back}?error=too-many`);
  const rows: SplitRow[] = [];
  for (const [i, repId] of repIds.entries()) {
    if (repId === "") continue;
    if (!isUuid(repId)) redirect(`${back}?error=rep`);
    const share = parseSharePercent((shares[i] ?? "").slice(0, 12));
    if (share === "invalid") redirect(`${back}?error=invalid`);
    rows.push({ repId, shareBp: share });
  }

  // The rate is range-checked here: the database CHECK would otherwise turn a
  // bad value into a thrown error. Blank follows the lead rep's rate.
  const rateText = String(formData.get("rate") ?? "").slice(0, 20).trim();
  const rate = rateText === "" ? null : parseCommissionPercent(rateText);
  if (rateText !== "" && rate === null) redirect(`${back}?error=invalid`);

  const result = await setAccountReps(id, rows, rate);
  if (result === "not-found") redirect(`/${locale}/admin/customers`);
  if (result === "ok") redirect(`${back}?ok=assigned`);
  const error = { empty: "invalid", "bad-rep": "rep", "too-many": "too-many", duplicate: "duplicate", mixed: "mixed", total: "total" }[result];
  redirect(`${back}?error=${error}`);
}

export async function resetCustomerPasswordAdminAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/admin/customers`);
  const password = generateTempPassword();
  const customer = await resetCustomerPasswordAdmin(id, await hashPassword(password));
  if (!customer) redirect(`/${locale}/admin/customers`);
  await setShownOnce({ kind: "customer", subjectId: customer.id, login: customer.customerCode, password });
  redirect(`/${locale}/admin/customers/${customer.id}?ok=password`);
}

export async function addCustomerNoteAdminAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/admin/customers`);
  const body = boundedString(formData.get("body"), 2000);
  if (!body) redirect(`/${locale}/admin/customers/${id}?error=invalid#notes`);
  await addNoteAdmin(id, body);
  redirect(`/${locale}/admin/customers/${id}?ok=note#notes`);
}

export async function setFollowUpAdminAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/admin/customers`);
  const choice = String(formData.get("days") ?? "");
  const days = Number(choice);
  const date =
    choice === "clear"
      ? null
      : (FOLLOW_UP_DAYS as readonly number[]).includes(days)
        ? tehranDatePlusDays(days)
        : undefined;
  if (date === undefined) redirect(`/${locale}/admin/customers/${id}?error=invalid#follow-up`);
  await setFollowUpAdmin(id, date);
  redirectFresh(`/${locale}/admin/customers/${id}#follow-up`);
}
