import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { loadRepSummary } from "@/lib/repDashboard";
import { listInProgressForRep, listPayouts } from "@/db/repMoney";
import { getFxRate } from "@/lib/fx";
import { CommissionReport } from "@/components/CommissionReport";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

export default async function RepCommissionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const rep = await requireRep(l);
  const liveRate = await getFxRate();
  const [summary, payouts, inProgress] = await Promise.all([
    loadRepSummary(rep.id),
    listPayouts(rep.id),
    listInProgressForRep(rep.id, liveRate),
  ]);

  return (
    <>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.commission}
      </h1>
      <CommissionReport locale={l} summary={summary} payouts={payouts} inProgress={inProgress} />
    </>
  );
}
