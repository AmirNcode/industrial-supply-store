import Link from "next/link";
import { notFound } from "next/navigation";
import { getCartLines, unitPriceAt } from "@/lib/cart";
import { updateQtyAction, removeLineAction } from "@/app/actions";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatPrice, formatInt } from "@/lib/money";
import { specValueLabel } from "@/lib/specValues";

export default async function CartPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const lines = await getCartLines();
  const subtotal = lines.reduce((sum, x) => sum + unitPriceAt(x, x.qty) * x.qty, 0);

  return (
    <main className="mx-auto max-w-[1100px] px-3 pt-3">
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.yourOrder}
        {lines.length > 0 && (
          <span className="ms-2 text-[12px] font-normal text-[var(--color-ink-muted)]">
            <span className="tech">{formatInt(lines.length, l)}</span> {t.itemsInOrder}
          </span>
        )}
      </h1>

      {lines.length === 0 ? (
        <p className="py-8 text-[13px]">
          {t.emptyCart}{" "}
          <Link href={`/${l}`}>{t.startBrowsing}</Link>
        </p>
      ) : (
        <>
          <div className="scroll-x">
            <table className="spec-table">
              <thead>
                <tr>
                  <th>{t.partNumber}</th>
                  <th>{t.products}</th>
                  <th className="num">{t.unitPrice}</th>
                  <th>{t.qty}</th>
                  <th className="num">{t.lineTotal}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const unit = unitPriceAt(line, line.qty);
                  // Two or three specs are enough to identify the row without
                  // reprinting the whole spec table into the cart.
                  const summary = Object.entries(line.specs)
                    .slice(0, 3)
                    .map(([, v]) =>
                      typeof v === "number" ? String(v) : specValueLabel(String(v), l),
                    )
                    .join(" · ");
                  return (
                    <tr key={line.productId}>
                      <td>
                        <Link
                          href={`/${l}/f/${line.familySlug}?pn=${encodeURIComponent(line.partNumber)}`}
                          prefetch={false}
                          className="tech font-bold !text-[var(--color-part-link)]"
                        >
                          {line.partNumber}
                        </Link>
                      </td>
                      <td className="whitespace-normal">
                        <span className="block">
                          {l === "fa" ? line.familyFa : line.familyEn}
                        </span>
                        <span className="block text-[10px] text-[var(--color-ink-faint)]">
                          {summary}
                        </span>
                      </td>
                      <td className="num tech tech-num">{formatPrice(unit, l)}</td>
                      <td>
                        <form action={updateQtyAction} className="flex items-center gap-1">
                          <input type="hidden" name="productId" value={line.productId} />
                          <input
                            type="number"
                            name="qty"
                            min={0}
                            defaultValue={line.qty}
                            aria-label={t.qty}
                            className="w-14 px-1 py-0.5 text-[11px] text-center"
                          />
                          <button type="submit" className="btn-small">
                            {t.update}
                          </button>
                        </form>
                      </td>
                      <td className="num tech tech-num font-bold">
                        {formatPrice(unit * line.qty, l)}
                      </td>
                      <td>
                        <form action={removeLineAction}>
                          <input type="hidden" name="productId" value={line.productId} />
                          <button
                            type="submit"
                            className="text-[11px] text-[var(--color-ink-muted)] underline"
                          >
                            {t.remove}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-end gap-6 border-t border-[var(--color-ink)] pt-3">
            <span className="text-[13px]">
              {t.subtotal}:{" "}
              <strong className="tech text-[15px]">{formatPrice(subtotal, l)}</strong>
            </span>
            <Link href={`/${l}/quote`} className="btn-primary hover:no-underline">
              {t.requestQuote}
            </Link>
          </div>
          <p className="mt-2 text-end text-[11px] text-[var(--color-ink-faint)]">
            {t.rfqIntro}
          </p>
        </>
      )}
    </main>
  );
}
