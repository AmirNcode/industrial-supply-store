import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCartId, getCartLines, unitPriceAt } from "@/lib/cart";
import { submitQuoteAction } from "@/app/actions";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { DEMO_MODE } from "@/lib/demo";
import { customerCurrencyFor, formatPrice, formatInt } from "@/lib/money";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { currentUser } from "@/lib/session";
import { AUTH_SECRET } from "@/lib/authSecret";
import {
  createQuoteSubmission,
  quoteCartFingerprint,
  signQuoteSubmissionToken,
} from "@/lib/quoteSubmission";
import QuoteSubmitButton from "@/components/QuoteSubmitButton";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { error } = await searchParams;

  const [lines, rate, priceDisplayMode, user, cartId] = await Promise.all([
    getCartLines(),
    getFxRate(),
    getPriceDisplayMode(),
    currentUser(),
    getCartId(),
  ]);
  if (lines.length === 0) redirect(`/${l}/cart`);
  if (!cartId) redirect(`/${l}/cart`);
  const currency = customerCurrencyFor(priceDisplayMode, l);
  const subtotal = lines.reduce((sum, x) => sum + unitPriceAt(x, x.qty) * x.qty, 0);
  const fingerprint = quoteCartFingerprint(
    lines.map((line) => ({
      productId: line.productId,
      qty: line.qty,
      unitPriceCents: unitPriceAt(line, line.qty),
    })),
  );
  const submissionToken = signQuoteSubmissionToken(
    createQuoteSubmission(cartId, fingerprint),
    AUTH_SECRET,
  );

  return (
    <main className="mx-auto max-w-[900px] px-3 pt-3">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.requestAQuote}
      </h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{t.rfqIntro}</p>

      {/* Shown before the form, not after: the point is to inform the decision
          to type real details, which is too late once they are submitted. */}
      {DEMO_MODE && (
        <p className="mb-3 border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--color-warn)]">
          {t.demoQuoteWarning}
        </p>
      )}

      {error === "missing" && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
          {t.required}
        </p>
      )}
      {error === "expired" && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
          {t.quoteFormExpired}
        </p>
      )}
      {error === "cart-changed" && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
          {t.quoteCartChanged}
        </p>
      )}
      {(error === "invalid" || error === "rate-limit") && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
          {error === "rate-limit" ? t.rateLimited : t.invalidInput}
        </p>
      )}

      <form action={submitQuoteAction} className="grid gap-4 md:grid-cols-[1fr_300px]">
        <input type="hidden" name="locale" value={l} />
        <input type="hidden" name="submissionToken" value={submissionToken} />

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] self-start">
          <Field name="company" label={t.company} maxLength={REQUEST_LIMITS.companyChars} required defaultValue={user?.company} />
          <Field name="contactName" label={t.contactName} maxLength={REQUEST_LIMITS.contactNameChars} required defaultValue={user?.contactName} />
          <Field name="email" label={t.email} type="email" maxLength={REQUEST_LIMITS.emailChars} required defaultValue={user?.email} />
          <Field name="phone" label={t.phone} type="tel" maxLength={REQUEST_LIMITS.phoneChars} required defaultValue={user?.phone} />
          <Field name="poNumber" label={t.poNumber} maxLength={REQUEST_LIMITS.poNumberChars} optional={t.optional} defaultValue={user?.defaultPoNumber} />
          <Field name="city" label={t.city} maxLength={REQUEST_LIMITS.cityChars} optional={t.optional} />
          <Field name="country" label={t.country} maxLength={REQUEST_LIMITS.countryChars} optional={t.optional} />
          <label className="col-span-full block text-[12px]">
            <span className="mb-0.5 block font-bold">
              {t.address}{" "}
              <span className="font-normal text-[var(--color-ink-faint)]">({t.optional})</span>
            </span>
            <input
              type="text"
              name="address"
              maxLength={REQUEST_LIMITS.addressChars}
              className="w-full"
            />
          </label>
          <label className="col-span-full block text-[12px]">
            <span className="mb-0.5 block font-bold">
              {t.notes}{" "}
              <span className="font-normal text-[var(--color-ink-faint)]">({t.optional})</span>
            </span>
            <textarea
              name="notes"
              rows={3}
              maxLength={REQUEST_LIMITS.notesChars}
              className="w-full"
            />
          </label>
        </div>

        <aside className="self-start border border-[var(--color-rule)] p-3">
          <h2 className="mb-2 border-b border-[var(--color-rule)] pb-1 text-[13px] font-bold">
            {t.yourOrder}{" "}
            <span className="font-normal text-[var(--color-ink-muted)]">
              (<span className="tech">{formatInt(lines.length, l)}</span> {t.itemsInOrder})
            </span>
          </h2>
          <ul className="mb-2 max-h-[260px] overflow-y-auto text-[11px]">
            {lines.map((line) => (
              <li key={line.productId} className="flex justify-between gap-2 py-0.5">
                <span className="tech truncate">{line.partNumber}</span>
                <span className="tech shrink-0 text-[var(--color-ink-muted)]">
                  × {formatInt(line.qty, l)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-[var(--color-ink)] pt-1.5 text-[13px]">
            <span>{t.subtotal}</span>
            <strong className="tech">
              {formatPrice(subtotal, currency, l, rate)}
            </strong>
          </div>
          <QuoteSubmitButton label={t.submitRequest} />
          <Link
            href={`/${l}/cart`}
            className="mt-2 block text-center text-[11px] text-[var(--color-ink-muted)]"
          >
            {t.continueShopping}
          </Link>
        </aside>
      </form>
    </main>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
  optional,
  defaultValue,
  maxLength,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  optional?: string;
  defaultValue?: string;
  maxLength: number;
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
        // Email and phone are Latin-entry fields even in the Persian UI.
        dir={type === "email" || type === "tel" ? "ltr" : undefined}
        className="w-full"
      />
    </label>
  );
}
