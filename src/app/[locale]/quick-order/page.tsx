import { notFound } from "next/navigation";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { QuickOrderForm } from "@/components/QuickOrderForm";

export default async function QuickOrderPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  return (
    <main className="mx-auto max-w-[760px] px-3 pt-3">
      <h1 className="mb-2 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.quickOrder}
      </h1>
      <p className="mb-3 text-[12px] text-[var(--color-ink-muted)]">{t.quickOrderHelp}</p>
      <QuickOrderForm locale={l} />
    </main>
  );
}
