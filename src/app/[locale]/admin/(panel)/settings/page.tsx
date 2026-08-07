import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/demo";
import { getFxSettings, getFxRate } from "@/lib/fx";
import { envFxRate } from "@/lib/fxRate";
import { FxRatePanel } from "@/components/FxRatePanel";
import { saveFxAction } from "../../actions";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";

/**
 * Settings. Today that is the exchange rate and nothing else.
 *
 * It has its own page rather than a strip above the order queue because it is
 * consulted rarely and changes every price on the site when it is — sitting
 * above a list staff scan all day is the wrong place for a control with that
 * blast radius.
 */
export default async function AdminSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ fx?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { fx } = await searchParams;

  const [fxSettings, rate] = await Promise.all([getFxSettings(), getFxRate()]);

  return (
    <>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.settings}
      </h1>

      {/* The panel's Apply button lives outside its own <form> so the two-step
          confirmation can sit next to the fields; this is the form it posts. */}
      <form action={saveFxAction} id="fx-save" className="hidden">
        <input type="hidden" name="locale" value={l} />
      </form>

      {fx === "saved" && (
        <p className="mb-2 border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-[12px] text-[var(--color-ok)]">
          {t.exchangeRate}: {formatInt(rate, l)} {t.fxPerUsd}
        </p>
      )}
      {fx === "range" && <ErrorBanner>{t.fxOutOfRange}</ErrorBanner>}
      {fx === "invalid" && <ErrorBanner>{t.fxInvalid}</ErrorBanner>}

      <FxRatePanel
        locale={l}
        mode={fxSettings.mode}
        manualRate={fxSettings.manualRate}
        envRate={envFxRate()}
        effectiveRate={rate}
        disabled={DEMO_MODE}
      />
    </>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 border border-[var(--color-danger)] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
      {children}
    </p>
  );
}
