import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { DEMO_MODE } from "@/lib/demo";
import { getFamiliesGrouped } from "@/db/importQueries";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { ImportPanel } from "./ImportPanel";

/**
 * Bulk product import.
 *
 * Readable under DEMO_MODE like the rest of /admin, but every write control is
 * disabled — and `assertAdminWrite` refuses the action regardless, so a
 * hand-made POST gets the same answer as a disabled button.
 */
export default async function ImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const signedIn = await isAdmin();
  const authorised = DEMO_MODE || signedIn;

  if (!authorised) redirect(`/${l}/admin/login`);

  const families = await getFamiliesGrouped();

  return (
    <main className="mx-auto max-w-[1100px] px-3 pt-3 pb-16">
      <div className="mb-1 flex flex-wrap items-center gap-3 border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">{t.importProducts}</h1>
        <Link href={`/${l}/admin`} className="text-[12px]">
          {t.admin}
        </Link>
      </div>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{t.importIntro}</p>

      {DEMO_MODE && (
        <p className="mb-4 border border-[var(--color-amber-line)] bg-[var(--color-amber-soft)] px-3 py-2 text-[12px]">
          {t.importReadOnly}
        </p>
      )}

      <ImportPanel families={families} locale={l} demo={DEMO_MODE} />
    </main>
  );
}
