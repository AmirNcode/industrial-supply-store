"use client";

import { useState } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { parseRate, type FxMode } from "@/lib/fxRate";

/**
 * Two-step Apply.
 *
 * Typing a rate and moving the toggle change nothing on their own. One
 * keystroke slip here reprices every Toman figure on the site, and nothing
 * about the result looks wrong until a customer says so — cheap to guard,
 * expensive to notice afterwards.
 */
export function FxRatePanel({
  locale,
  mode,
  manualRate,
  envRate,
  effectiveRate,
  disabled,
}: {
  locale: Locale;
  mode: FxMode;
  manualRate: number | null;
  envRate: number;
  effectiveRate: number;
  /** True in demo mode, where the page is public and must stay read-only. */
  disabled?: boolean;
}) {
  const t = getDict(locale);
  const [draftMode, setDraftMode] = useState<FxMode>(mode);
  const [draftRate, setDraftRate] = useState(String(manualRate ?? envRate));
  const [confirming, setConfirming] = useState(false);

  // Parsed with the same function the Server Action will use, not a lookalike.
  // A near-copy that missed the Persian thousands separators would show the
  // admin "→ NaN" while the server saved a perfectly good number — the one
  // thing a confirmation dialog must never do is name a different value from
  // the one about to be applied.
  const parsedDraft = parseRate(draftRate);
  const nextRate = draftMode === "manual" ? parsedDraft : envRate;
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
            <span className="tech">{formatInt(envRate, locale)}</span> {t.fxPerUsd}{" "}
            <span className="text-[var(--color-ink-faint)]">({t.fxFromEnv})</span>
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
