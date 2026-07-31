"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdminWrite } from "@/lib/admin";
import { saveFxSettings } from "@/lib/fx";
import { envFxRate, isFxMode, isPlausibleRate, parseRate } from "@/lib/fxRate";
import { isLocale, type Locale } from "@/lib/i18n";

/**
 * Every action in this file redirects to `/${locale}/admin`, so the posted
 * value reaches `redirect()` unchanged. A `locale` of `/evil.com` would make
 * that `//evil.com/admin` — a protocol-relative URL, and an open redirect.
 * Anything unrecognised falls back to English.
 */
function safeLocale(formData: FormData): Locale {
  const raw = String(formData.get("locale") ?? "");
  return isLocale(raw) ? raw : "en";
}

export async function saveFxAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = safeLocale(formData);
  const rawMode = String(formData.get("mode") ?? "auto");
  const mode = isFxMode(rawMode) ? rawMode : "auto";

  let manualRate: number | null = null;
  if (mode === "manual") {
    const parsed = parseRate(String(formData.get("rate") ?? ""));
    if (parsed === null) redirect(`/${locale}/admin?fx=invalid`);
    if (!isPlausibleRate(parsed, envFxRate())) {
      redirect(`/${locale}/admin?fx=range`);
    }
    manualRate = parsed;
  }

  await saveFxSettings(mode, manualRate);
  // The catalog is statically rendered with revalidate = 3600, so without this
  // a rate change would take up to an hour to reach the pages that show it.
  revalidatePath("/", "layout");
  redirect(`/${locale}/admin?fx=saved`);
}
