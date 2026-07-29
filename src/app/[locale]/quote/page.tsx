import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCartLines, unitPriceAt } from "@/lib/cart";
import { submitQuoteAction } from "@/app/actions";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { DEMO_MODE } from "@/lib/demo";
import { formatPrice, formatInt } from "@/lib/money";

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

  const lines = await getCartLines();
  if (lines.length === 0) redirect(`/${l}/cart`);
  const subtotal = lines.reduce((sum, x) => sum + unitPriceAt(x, x.qty) * x.qty, 0);

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

      <form action={submitQuoteAction} className="grid gap-4 md:grid-cols-[1fr_300px]">
        <input type="hidden" name="locale" value={l} />

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] self-start">
          <Field name="company" label={t.company} required />
          <Field name="contactName" label={t.contactName} required />
          <Field name="email" label={t.email} type="email" required />
          <Field name="phone" label={t.phone} optional={t.optional} />
          <Field name="poNumber" label={t.poNumber} optional={t.optional} />
          <Field name="city" label={t.city} optional={t.optional} />
          <Field name="country" label={t.country} optional={t.optional} />
          <label className="col-span-full block text-[12px]">
            <span className="mb-0.5 block font-bold">
              {t.address}{" "}
              <span className="font-normal text-[var(--color-ink-faint)]">({t.optional})</span>
            </span>
            <input type="text" name="address" className="w-full" />
          </label>
          <label className="col-span-full block text-[12px]">
            <span className="mb-0.5 block font-bold">
              {t.notes}{" "}
              <span className="font-normal text-[var(--color-ink-faint)]">({t.optional})</span>
            </span>
            <textarea name="notes" rows={3} className="w-full" />
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
            <strong className="tech">{formatPrice(subtotal, l)}</strong>
          </div>
          <button type="submit" className="btn-primary mt-3 w-full">
            {t.submitRequest}
          </button>
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
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  optional?: string;
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
        // Email and phone are Latin-entry fields even in the Persian UI.
        dir={type === "email" || name === "phone" ? "ltr" : undefined}
        className="w-full"
      />
    </label>
  );
}
