"use server";

import { redirect } from "next/navigation";
import { assertAdminWrite } from "@/lib/admin";
import { safeLocale } from "@/lib/i18n";
import { boundedString } from "@/lib/requestLimits";
import { hashPassword } from "@/lib/password";
import { generateTempPassword } from "@/lib/tempPassword";
import { isUuid, postedUuid } from "@/lib/ids";
import { FOLLOW_UP_DAYS } from "@/lib/repAccount";
import { tehranDatePlusDays } from "@/lib/persianCalendar";
import { setShownOnce } from "@/lib/shownOnce";
import { redirectFresh } from "@/lib/redirectFresh";
import {
  assignCustomer,
  resetCustomerPasswordAdmin,
  setFollowUpAdmin,
} from "@/db/customerQueries";
import { addNoteAdmin } from "@/db/noteQueries";

function postedCustomerId(formData: FormData): string | null {
  return postedUuid(formData, "customerId");
}

/*
 * No action in this file revalidates: nothing cached renders a customer, and
 * a whole-site purge is how production hung on 2026-08-15.
 */

/**
 * Changing a customer's rep, and whether that rep earns commission on them.
 * The checkbox arrives as "on" or not at all, so its absence is a deliberate
 * "off" — the form always renders it with the current value.
 */
export async function assignCustomerAction(formData: FormData): Promise<void> {
  await assertAdminWrite();
  const locale = safeLocale(formData);
  const id = postedCustomerId(formData);
  if (!id) redirect(`/${locale}/admin/customers`);
  const raw = String(formData.get("repId") ?? "");
  const repId = raw === "" ? null : raw;
  if (repId !== null && !isUuid(repId)) redirect(`/${locale}/admin/customers/${id}?error=rep`);
  const earns = formData.get("earnsCommission") === "on";
  const result = await assignCustomer(id, repId, earns);
  if (result === "not-found") redirect(`/${locale}/admin/customers`);
  redirect(`/${locale}/admin/customers/${id}?${result === "bad-rep" ? "error=rep" : "ok=assigned"}`);
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
