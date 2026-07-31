"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdminWrite } from "@/lib/admin";
import { saveFxSettings } from "@/lib/fx";
import { envFxRate, isFxMode, isPlausibleRate, parseRate } from "@/lib/fxRate";

export async function saveFxAction(formData: FormData): Promise<void> {
  await assertAdminWrite();

  const locale = String(formData.get("locale") || "en");
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
