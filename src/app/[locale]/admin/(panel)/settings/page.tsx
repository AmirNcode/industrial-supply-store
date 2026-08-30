import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/demo";
import { getFxSettings, getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { envFxRate } from "@/lib/fxRate";
import { FxRatePanel } from "@/components/FxRatePanel";
import { getSiteContact } from "@/lib/siteContact";
import {
  saveFxAction,
  savePriceDisplayModeAction,
  saveSiteContactAction,
} from "../../actions";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";

/** Settings that staff change occasionally, away from the daily order queue. */
export default async function AdminSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ fx?: string; contact?: string; currency?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { fx, contact: contactStatus, currency: currencyStatus } = await searchParams;

  const [fxSettings, rate, priceDisplayMode, contact] = await Promise.all([
    getFxSettings(),
    getFxRate(),
    getPriceDisplayMode(),
    getSiteContact(),
  ]);

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

      <section className="mb-4 border border-[var(--color-rule)] p-3">
        <h2 className="mb-1 text-[13px] font-bold">{t.siteContact}</h2>
        <p className="mb-3 text-[11px] text-[var(--color-ink-muted)]">
          {t.siteContactHint}
        </p>

        {contactStatus === "saved" && (
          <SuccessBanner>{t.siteContactSaved}</SuccessBanner>
        )}
        {contactStatus === "invalid-email" && (
          <ErrorBanner>{t.siteContactInvalidEmail}</ErrorBanner>
        )}
        {contactStatus === "invalid-phone" && (
          <ErrorBanner>{t.siteContactInvalidPhone}</ErrorBanner>
        )}

        <form
          action={saveSiteContactAction}
          className="grid max-w-[680px] gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="locale" value={l} />
          <label className="grid gap-0.5 text-[11px] font-semibold">
            {t.email}
            <input
              type="email"
              name="email"
              dir="ltr"
              defaultValue={contact.email}
              autoComplete="off"
              disabled={DEMO_MODE}
              required
            />
          </label>
          <label className="grid gap-0.5 text-[11px] font-semibold">
            {t.phone}
            <input
              type="tel"
              name="phone"
              dir="ltr"
              defaultValue={contact.phone}
              autoComplete="off"
              disabled={DEMO_MODE}
              required
            />
          </label>
          <button
            type="submit"
            className="btn-small justify-self-start sm:col-span-2"
            disabled={DEMO_MODE}
          >
            {t.siteContactSave}
          </button>
        </form>
      </section>

      <section className="mb-4 border border-[var(--color-rule)] p-3">
        <h2 className="mb-1 text-[13px] font-bold">{t.customerCurrencyDisplay}</h2>
        <p className="mb-3 max-w-[680px] text-[11px] text-[var(--color-ink-muted)]">
          {t.customerCurrencyDisplayHint}
        </p>

        {currencyStatus === "saved" && (
          <SuccessBanner>{t.customerCurrencyDisplaySaved}</SuccessBanner>
        )}
        {currencyStatus === "invalid" && (
          <ErrorBanner>{t.customerCurrencyDisplayInvalid}</ErrorBanner>
        )}

        <form action={savePriceDisplayModeAction} className="grid gap-3">
          <input type="hidden" name="locale" value={l} />
          <fieldset className="grid gap-2 text-[12px]">
            <legend className="sr-only">{t.customerCurrencyDisplay}</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="priceDisplayMode"
                value="usd"
                defaultChecked={priceDisplayMode === "usd"}
                disabled={DEMO_MODE}
              />
              <span>
                <strong>{t.currencyUsdOnly}</strong>
                <span className="block text-[11px] text-[var(--color-ink-muted)]">
                  {t.currencyUsdOnlyHint}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="priceDisplayMode"
                value="irr"
                defaultChecked={priceDisplayMode === "irr"}
                disabled={DEMO_MODE}
              />
              <span>
                <strong>{t.currencyIrrOnly}</strong>
                <span className="block text-[11px] text-[var(--color-ink-muted)]">
                  {t.currencyIrrOnlyHint}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="priceDisplayMode"
                value="both"
                defaultChecked={priceDisplayMode === "both"}
                disabled={DEMO_MODE}
              />
              <span>
                <strong>{t.currencyBoth}</strong>
                <span className="block text-[11px] text-[var(--color-ink-muted)]">
                  {t.currencyBothHint}
                </span>
              </span>
            </label>
          </fieldset>
          <button
            type="submit"
            className="btn-small justify-self-start"
            disabled={DEMO_MODE}
          >
            {t.customerCurrencyDisplaySave}
          </button>
        </form>
      </section>

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

function SuccessBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-[12px] text-[var(--color-ok)]">
      {children}
    </p>
  );
}
