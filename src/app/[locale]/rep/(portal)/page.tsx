import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { listFollowUpsDue } from "@/db/customerQueries";
import { ErrorBanner, SuccessBanner } from "@/components/Banners";
import { ShareButton } from "@/components/ShareButton";
import { siteOrigin } from "@/lib/siteOrigin";
import { loadRepSummary } from "@/lib/repDashboard";
import { RepDashboard } from "@/components/RepDashboard";
import { formatPersianDay, tehranToday } from "@/lib/persianCalendar";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { fillMessage } from "@/lib/fillMessage";

export default async function RepHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string; error?: string; year?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { ok, error, year: yearParam } = await searchParams;
  const rep = await requireRep(l);
  const today = tehranToday();
  // Only a plausible Persian year picks the table's year; anything else is ignored.
  const year = typeof yearParam === "string" ? Number(yearParam) : NaN;
  const tableYear = Number.isInteger(year) && year >= 1300 && year <= 1600 ? year : undefined;
  const [due, origin, summary] = await Promise.all([
    listFollowUpsDue(rep.id, today),
    siteOrigin(),
    loadRepSummary(rep.id, tableYear),
  ]);
  const referralLink = `${origin}/${l}/r/${rep.referralCode}`;

  return (
    <>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.welcomeRep.replace("{name}", rep.name)}
      </h1>
      {ok === "password" && <SuccessBanner>{t.passwordChanged}</SuccessBanner>}
      {/* Every rep write that hits its rate limit lands here. */}
      {error === "rate-limit" && <ErrorBanner>{t.rateLimited}</ErrorBanner>}

      <RepDashboard locale={l} summary={summary} yearHref={(y) => `/${l}/rep?year=${y}`} />

      <section className="mb-4 border border-[var(--color-rule)] p-3">
        <h2 className="mb-1 text-[13px] font-bold">{t.referralLink}</h2>
        <p className="mb-2 text-[11px] text-[var(--color-ink-muted)]">{t.referralHint}</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="tech break-all text-[12px]" dir="ltr" data-testid="referral-link">
            {referralLink}
          </span>
          <ShareButton
            text={fillMessage(t.referralMessage, { url: referralLink })}
            label={t.share}
            copiedLabel={t.copied}
          />
        </div>
      </section>

      <section className="mb-4 border border-[var(--color-rule)] p-3">
        <h2 className="mb-2 text-[13px] font-bold">{t.followUpsDue}</h2>
        {due.length === 0 ? (
          <p className="text-[12px] text-[var(--color-ink-muted)]">{t.followUpsNoneDue}</p>
        ) : (
          <ul className="grid gap-1 text-[12px]">
            {due.map((customer) => {
              const overdue = customer.nextFollowUpOn !== null && customer.nextFollowUpOn < today;
              return (
                <li key={customer.id} className="flex flex-wrap items-baseline gap-3">
                  <Link href={`/${l}/rep/customers/${customer.id}#follow-up`}>{customer.company}</Link>
                  <span className="tech text-[var(--color-ink-muted)]" dir="ltr">
                    {customer.customerCode}
                  </span>
                  <span className={overdue ? "font-bold text-[var(--color-danger)]" : "font-bold"}>
                    {customer.nextFollowUpOn && formatPersianDay(customer.nextFollowUpOn, l)} —{" "}
                    {overdue ? t.overdue : t.followUpDueToday}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
