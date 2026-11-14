import Link from "next/link";
import { getDict, type Locale } from "@/lib/i18n";
import { formatAmount, formatInt, formatPrice, type Currency } from "@/lib/money";
import { invoiceAmounts, roundedForDisplay } from "@/lib/invoice";
import { formatVatPercent } from "@/lib/vat";
import type { CartSplit, LineSplit } from "@/lib/checkoutSplit";
import type { SavedAddress } from "@/db/addressQueries";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

/**
 * The pieces the customer checkout and the rep's checkout share: both post to
 * the same action, so they must ask for the same fields and draw the same
 * split. Server components only; nothing here needs JavaScript.
 */

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
      {children}
    </p>
  );
}

export function Field({
  name,
  label,
  type = "text",
  required,
  optional,
  defaultValue,
  maxLength,
  ltr,
  inputMode,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  optional?: string;
  defaultValue?: string;
  maxLength: number;
  /** Latin-entry field (digits, codes) even in the Persian UI. */
  ltr?: boolean;
  inputMode?: "numeric";
}) {
  return (
    <label className="block text-[12px]">
      <span className="mb-0.5 block font-bold">
        {label}
        {required ? (
          <span className="text-[#a3312a]"> *</span>
        ) : optional ? (
          <span className="font-normal text-[var(--color-ink-faint)]"> ({optional})</span>
        ) : null}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        inputMode={inputMode}
        // "auto" lets the text set its own direction from its first letter, so
        // a company name typed in English on the Persian site runs left to
        // right instead of being reordered into an RTL box (and vice versa).
        dir={ltr || type === "email" || type === "tel" ? "ltr" : "auto"}
        className="w-full"
      />
    </label>
  );
}

/**
 * The delivery block. With saved addresses the typed fields belong to the
 * "new" radio and are never `required`: a browser would otherwise refuse to
 * submit a saved choice because the unused boxes are empty, and there is no
 * script to switch the attribute. The server validates whichever was chosen.
 */
export function DeliveryFields({
  locale,
  defaults,
  saved = [],
  canSave = false,
}: {
  locale: Locale;
  defaults?: { address: string; city: string; postalCode?: string };
  saved?: SavedAddress[];
  canSave?: boolean;
}) {
  const t = getDict(locale);
  const hasSaved = saved.length > 0;
  const checkedId = (saved.find((a) => a.isDefault) ?? saved[0])?.id;
  const need = hasSaved ? undefined : true;
  return (
    <fieldset className="col-span-full m-0 grid gap-3 border-0 p-0 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      <legend className="mb-1 border-b border-[var(--color-rule)] pb-0.5 text-[12px] font-bold">
        {t.deliveryHeading}
      </legend>
      {hasSaved && (
        <div className="col-span-full grid gap-1.5 text-[12px]">
          {saved.map((a) => (
            <label key={a.id} className="flex items-start gap-2">
              <input
                type="radio"
                name="addressChoice"
                value={a.id}
                defaultChecked={a.id === checkedId}
                className="mt-0.5"
              />
              <span>
                {a.label ? <strong>{a.label}</strong> : null}
                {a.label ? " — " : ""}
                <bdi>
                  {a.city}، {a.address}
                </bdi>
              </span>
            </label>
          ))}
          <label className="flex items-start gap-2">
            <input type="radio" name="addressChoice" value="new" className="mt-0.5" />
            <span>{t.addressChoiceNew}</span>
          </label>
        </div>
      )}
      <label className="col-span-full block text-[12px]">
        <span className="mb-0.5 block font-bold">
          {t.address}
          {need && <span className="text-[#a3312a]"> *</span>}
        </span>
        <input
          type="text"
          name="address"
          required={need}
          maxLength={REQUEST_LIMITS.addressChars}
          defaultValue={defaults?.address}
          className="w-full"
        />
      </label>
      <Field name="city" label={t.city} maxLength={REQUEST_LIMITS.cityChars} required={need} defaultValue={defaults?.city} />
      <Field
        name="postalCode"
        label={t.postalCode}
        maxLength={REQUEST_LIMITS.postalCodeChars}
        optional={t.optional}
        ltr
        inputMode="numeric"
        defaultValue={defaults?.postalCode}
      />
      {canSave && (
        <label className="col-span-full flex items-center gap-2 text-[12px]">
          <input type="checkbox" name="saveAddress" />
          <span>{t.saveAddressLabel}</span>
        </label>
      )}
    </fieldset>
  );
}

export function TaxFields({
  locale,
  defaults,
}: {
  locale: Locale;
  defaults?: { nationalId?: string; economicCode?: string };
}) {
  const t = getDict(locale);
  return (
    <fieldset className="col-span-full m-0 grid gap-3 border-0 p-0 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      <legend className="mb-1 border-b border-[var(--color-rule)] pb-0.5 text-[12px] font-bold">
        {t.taxHeading}
      </legend>
      <p className="col-span-full -mt-1 text-[11px] text-[var(--color-ink-muted)]">{t.taxHint}</p>
      <Field name="nationalId" label={t.nationalId} maxLength={REQUEST_LIMITS.taxIdChars} optional={t.optional} ltr inputMode="numeric" defaultValue={defaults?.nationalId} />
      <Field name="economicCode" label={t.economicCode} maxLength={REQUEST_LIMITS.taxIdChars} optional={t.optional} ltr inputMode="numeric" defaultValue={defaults?.economicCode} />
    </fieldset>
  );
}

export function NotesField({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  return (
    <label className="col-span-full block text-[12px]">
      <span className="mb-0.5 block font-bold">
        {t.notes} <span className="font-normal text-[var(--color-ink-faint)]">({t.optional})</span>
      </span>
      <textarea name="notes" rows={3} maxLength={REQUEST_LIMITS.notesChars} dir="auto" className="w-full" />
    </label>
  );
}

type WaitLine = { line: LineSplit; qty: number; backorder: boolean };

/**
 * What the page draws. With no pish-factor terms (no real rate or seller
 * details) nothing may be promised as payable, so the whole cart is shown as
 * a quote request. The signed fingerprint still uses the real split: the
 * server makes the same call with `canIssue` false.
 */
export function checkoutView(split: CartSplit, canIssue: boolean) {
  const kind = canIssue ? split.kind : "quote";
  const payLines = split.lines.filter((x) => x.payNow > 0);
  const waitLines: WaitLine[] = [];
  for (const line of split.lines) {
    const qty = canIssue ? line.heldForQuote + line.backorder : line.qty;
    if (qty > 0) waitLines.push({ line, qty, backorder: line.backorder > 0 });
  }
  const listCents = canIssue ? split.quoteListCents : split.quoteListCents + split.payNowCents;
  return { kind, payLines, waitLines, listCents, hasUnpriced: split.quoteHasUnpriced };
}

export function OrderSummary({
  locale,
  split,
  canIssue,
  vatRateBp,
  currency,
  rate,
  parts,
  submit,
}: {
  locale: Locale;
  split: CartSplit;
  canIssue: boolean;
  vatRateBp: number | null;
  currency: Currency;
  rate: number;
  /** Part numbers by product id: the split lines carry quantities only. */
  parts: Record<number, string>;
  /** The client submit button, passed in so this file stays server-only. */
  submit: React.ReactNode;
}) {
  const t = getDict(locale);
  const view = checkoutView(split, canIssue);
  const showPay = view.kind !== "quote" && vatRateBp !== null;
  const amounts = showPay
    ? roundedForDisplay(invoiceAmounts(split.payNowCents, vatRateBp, currency, rate), currency)
    : null;
  return (
    <aside className="self-start border border-[var(--color-rule)] p-3">
      <h2 className="mb-2 border-b border-[var(--color-rule)] pb-1 text-[13px] font-bold">
        {t.yourOrder}{" "}
        <span className="font-normal text-[var(--color-ink-muted)]">
          (<span className="tech">{formatInt(split.lines.length, locale)}</span> {t.itemsInOrder})
        </span>
      </h2>

      {showPay && amounts && vatRateBp !== null && (
        <section className="mb-3">
          {view.kind === "mixed" && <h3 className="mb-1 text-[12px] font-bold">{t.checkoutPayNowHeading}</h3>}
          <ul className="mb-2 max-h-[200px] overflow-y-auto text-[11px]">
            {view.payLines.map((x) => (
              <li key={x.productId} className="flex justify-between gap-2 py-0.5">
                <span className="tech truncate">{parts[x.productId]}</span>
                <span className="tech shrink-0 text-[var(--color-ink-muted)]">× {formatInt(x.payNow, locale)}</span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 border-t border-[var(--color-rule)] pt-1.5 text-[12px]">
            <dt>{t.subtotal}</dt>
            <dd className="tech text-end">{formatAmount(amounts.subtotal, currency, locale)}</dd>
            <dt>{t.checkoutVat.replace("{rate}", formatVatPercent(vatRateBp, locale))}</dt>
            <dd className="tech text-end">{formatAmount(amounts.vat, currency, locale)}</dd>
            <dt>{t.deliveryLabel}</dt>
            <dd className="text-end">{t.deliveryFree}</dd>
            <dt className="border-t border-[var(--color-ink)] pt-1 text-[13px] font-bold">{t.checkoutTotalDue}</dt>
            <dd className="tech border-t border-[var(--color-ink)] pt-1 text-end text-[13px] font-bold">
              {formatAmount(amounts.total, currency, locale)}
            </dd>
          </dl>
        </section>
      )}

      {view.waitLines.length > 0 && (
        <section className="mb-3">
          {view.kind === "mixed" && <h3 className="mb-1 text-[12px] font-bold">{t.checkoutQuoteHeading}</h3>}
          <ul className="mb-2 max-h-[200px] overflow-y-auto text-[11px]">
            {view.waitLines.map(({ line, qty, backorder }) => (
              <li key={line.productId} className="py-0.5">
                <div className="flex justify-between gap-2">
                  <span className="tech truncate">{parts[line.productId]}</span>
                  <span className="tech shrink-0 text-[var(--color-ink-muted)]">× {formatInt(qty, locale)}</span>
                </div>
                <span className="block text-[10px] text-[var(--color-ink-faint)]">
                  {backorder ? t.backorderTag : t.awaitingQuoteTag}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between gap-2 border-t border-[var(--color-rule)] pt-1.5 text-[12px]">
            <span>{t.checkoutQuoteListTotal}</span>
            <strong className="tech shrink-0">{formatPrice(view.listCents, currency, locale, rate)}</strong>
          </div>
          {view.hasUnpriced && (
            <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{t.checkoutUnpricedNote}</p>
          )}
        </section>
      )}

      {view.kind === "mixed" && (
        <fieldset className="mb-2 grid gap-2 border-0 p-0 text-[12px]">
          <legend className="mb-1 font-bold">{t.checkoutModeLegend}</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" value="split" defaultChecked className="mt-0.5" />
            <span>
              {t.checkoutModeSplit}
              <span className="block text-[11px] text-[var(--color-ink-muted)]">{t.checkoutModeSplitHint}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" value="together" className="mt-0.5" />
            <span>
              {t.checkoutModeTogether}
              <span className="block text-[11px] text-[var(--color-ink-muted)]">{t.checkoutModeTogetherHint}</span>
            </span>
          </label>
        </fieldset>
      )}

      {submit}
      <Link
        href={`/${locale}/cart`}
        className="mt-2 block text-center text-[11px] text-[var(--color-ink-muted)]"
      >
        {t.continueShopping}
      </Link>
    </aside>
  );
}
