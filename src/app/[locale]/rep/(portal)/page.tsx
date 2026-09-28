import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { listFollowUpsDue } from "@/db/customerQueries";
import { ErrorBanner, SuccessBanner } from "@/components/Banners";
import { formatPersianDay, tehranToday } from "@/lib/persianCalendar";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

export default async function RepHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { ok, error } = await searchParams;
  const rep = await requireRep(l);
  const today = tehranToday();
  const due = await listFollowUpsDue(rep.id, today);

  return (
    <>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.welcomeRep.replace("{name}", rep.name)}
      </h1>
      {ok === "password" && <SuccessBanner>{t.passwordChanged}</SuccessBanner>}
      {/* Every rep write that hits its rate limit lands here. */}
      {error === "rate-limit" && <ErrorBanner>{t.rateLimited}</ErrorBanner>}

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
