"use client";

import { useState } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { parseRate, type FxMode } from "@/lib/fxRate";
import { tehranStamp, type MarketSummary, type RefusalReason } from "@/lib/fxMarket";

/**
 * Two-step Apply.
 *
 * Typing a rate and moving the toggle change nothing on their own. One
 * keystroke slip here reprices every Rial figure on the site, and nothing
 * about the result looks wrong until a customer says so — cheap to guard,
 * expensive to notice afterwards.
 */
export function FxRatePanel({
  locale,
  mode,
  manualRate,
  autoRate,
  market,
  effectiveRate,
  disabled,
}: {
  locale: Locale;
  mode: FxMode;
  manualRate: number | null;
  /** What automatic mode prices at: the market rate, or the fallback. */
  autoRate: number;
  market: MarketSummary;
  effectiveRate: number;
  /** True in demo mode, where the page is public and must stay read-only. */
  disabled?: boolean;
}) {
  const t = getDict(locale);
  const [draftMode, setDraftMode] = useState<FxMode>(mode);
  const [draftRate, setDraftRate] = useState(String(manualRate ?? autoRate));
  const [confirming, setConfirming] = useState(false);

  // Parsed with the same function the Server Action will use, not a lookalike.
  // A near-copy that missed the Persian thousands separators would show the
  // admin "→ NaN" while the server saved a perfectly good number — the one
  // thing a confirmation dialog must never do is name a different value from
  // the one about to be applied.
  const parsedDraft = parseRate(draftRate);
  const nextRate = draftMode === "manual" ? parsedDraft : autoRate;
  const changed =
    draftMode !== mode ||
    (draftMode === "manual" && parsedDraft !== null && parsedDraft !== manualRate);

  return (
    <section className="mb-4 border border-[var(--color-rule)] p-3">
      <h2 className="mb-2 text-[13px] font-bold">{t.exchangeRate}</h2>

      {/* Not a <form>. The real submission is the page's #fx-save form; these
          controls only build a draft, and the two hidden inputs below mirror it
          across using the HTML `form` attribute. A wrapping form here would
          give the browser something to submit on Enter. */}
      <div>
        <input type="hidden" form="fx-save" name="mode" value={draftMode} />
        <input type="hidden" form="fx-save" name="rate" value={draftRate} />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="mode"
              value="auto"
              checked={draftMode === "auto"}
              onChange={() => {
                setDraftMode("auto");
                setConfirming(false);
              }}
              disabled={disabled}
            />
            {t.fxAutomatic} —{" "}
            <span className="tech">{formatInt(autoRate, locale)}</span> {t.fxPerUsd}{" "}
            <span className="text-[var(--color-ink-faint)]">
              (
              {market.rate !== null && market.updatedAt !== null
                ? t.fxMarketUpdatedAt.replace("{when}", isolate(tehranStamp(market.updatedAt)))
                : t.fxNoMarketYet}
              )
            </span>
          </label>

          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="mode"
              value="manual"
              checked={draftMode === "manual"}
              onChange={() => {
                setDraftMode("manual");
                setConfirming(false);
              }}
              disabled={disabled}
            />
            {t.fxManual}
            <input
              type="text"
              inputMode="numeric"
              name="rate"
              dir="ltr"
              value={draftRate}
              onChange={(e) => {
                setDraftRate(e.target.value);
                setConfirming(false);
              }}
              disabled={disabled || draftMode !== "manual"}
              className="w-24 text-center"
              aria-label={t.fxPerUsd}
            />
            {t.fxPerUsd}
          </label>
        </div>

        <MarketDetail locale={locale} market={market} disabled={disabled} />

        <p className="mt-2 text-[11px] text-[var(--color-ink-muted)]">{t.fxAppliesTo}</p>

        {!disabled && changed && (
          <div className="mt-2 flex items-center gap-2 text-[12px]">
            {confirming ? (
              <>
                <span>
                  {t.fxConfirmPrompt}{" "}
                  <span className="tech">{formatInt(effectiveRate, locale)}</span> →{" "}
                  <strong className="tech">{nextRate === null ? "—" : formatInt(nextRate, locale)}</strong>
                </span>
                <button type="submit" form="fx-save" className="btn-small">
                  {t.fxConfirm}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-[11px] underline"
                >
                  {t.fxCancel}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="btn-small"
              >
                {t.fxApply}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * A date or time spliced into a translated sentence, kept left to right.
 *
 * Inside a Persian sentence the bidi algorithm lays "2026-09-26 21:10" out
 * as two runs and swaps them. The stamp is a string inside a string, so there
 * is no element to hang `.tech` on; the Unicode isolate marks do the same job.
 */
function isolate(text: string): string {
  return `\u2066${text}\u2069`;
}

function reasonText(reason: RefusalReason, t: ReturnType<typeof getDict>): string {
  switch (reason) {
    case "no-source":
      return t.fxReasonNoSource;
    case "needs-both":
      return t.fxReasonNeedsBoth;
    case "disagree":
      return t.fxReasonDisagree;
    case "jump":
      return t.fxReasonJump;
  }
}

/**
 * What the evening job last saw, and whether to worry.
 *
 * Shown whichever mode is set: in manual mode it is the number to compare the
 * typed rate against. The update button posts the page's `#fx-refresh` form,
 * the same arrangement as Apply and `#fx-save`.
 */
function MarketDetail({
  locale,
  market,
  disabled,
}: {
  locale: Locale;
  market: MarketSummary;
  disabled?: boolean;
}) {
  const t = getDict(locale);
  const { latest } = market;
  const price = (value: number | null) =>
    value === null ? "—" : formatInt(value, locale);

  return (
    <div className="mt-2 grid gap-1 text-[11px] text-[var(--color-ink-muted)]">
      {latest && (
        <p>
          {t.fxMarketLatest.replace("{date}", isolate(latest.date))}: {t.fxNobitex}{" "}
          <span className="tech">{price(latest.nobitex)}</span> · {t.fxWallex}{" "}
          <span className="tech">{price(latest.wallex)}</span> · {t.fxWeekAverage}{" "}
          <span className="tech">{price(market.average)}</span>
        </p>
      )}
      <p>{t.fxMarketRule}</p>

      {market.failedReason !== null && market.failedAt !== null && (
        <p role="status" className="text-[var(--color-danger)]">
          {t.fxLastFailed.replace("{when}", isolate(tehranStamp(market.failedAt)))}{" "}
          {reasonText(market.failedReason, t)} {t.fxKeptLastRate}
        </p>
      )}
      {market.stale && market.failedReason === null && (
        <p role="status" className="text-[var(--color-danger)]">
          {t.fxStale}
        </p>
      )}

      <div>
        <button type="submit" form="fx-refresh" className="btn-small" disabled={disabled}>
          {t.fxUpdateNow}
        </button>
      </div>
    </div>
  );
}
