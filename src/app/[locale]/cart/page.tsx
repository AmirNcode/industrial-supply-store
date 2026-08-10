import Link from "next/link";
import { notFound } from "next/navigation";
import { getCartLines, unitPriceAt } from "@/lib/cart";
import { updateQtyAction, removeLineAction } from "@/app/actions";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatPrice, formatInt } from "@/lib/money";
import { specValueLabel } from "@/lib/specValues";
import { getFxRate } from "@/lib/fx";

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
  const rate = await getFxRate();
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
          {/* Phone layout: each line stacks so the quantity, Update and Remove
              controls stay on screen. The table version scrolled them out of
              reach, which is unacceptable on the one page where the buyer has
              to edit what they are about to submit. */}
          <ul className="divide-y divide-[var(--color-rule-light)] border-y border-[var(--color-rule-light)] lg:hidden">
            {lines.map((line) => {
              const unit = unitPriceAt(line, line.qty);
              const summary = Object.entries(line.specs)
                .slice(0, 3)
                .map(([, v]) =>
                  typeof v === "number" ? String(v) : specValueLabel(String(v), l),
                )
                .join(" · ");
              return (
                <li key={line.productId} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/${l}/f/${line.familySlug}?pn=${encodeURIComponent(line.partNumber)}`}
                        prefetch={false}
                        className="tech block text-[13px] font-bold !text-[var(--color-ink)]"
                      >
                        {line.partNumber}
                      </Link>
                      <span className="block text-[13px] leading-snug">
                        {l === "fa" ? line.familyFa : line.familyEn}
                      </span>
                      <bdi className="tech mt-0.5 block text-[11px] text-[var(--color-ink-faint)]">
                        {summary}
                      </bdi>
                    </div>
                    <span className="tech shrink-0 text-[15px] font-bold">
                      {formatPrice(unit * line.qty, l, rate)}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    <span className="tech text-[12px] text-[var(--color-ink-muted)]">
                      {formatPrice(unit, l, rate)} / {t.each}
                    </span>
                    <form
                      action={updateQtyAction}
                      className="ms-auto flex items-center gap-1.5"
                    >
                      <input type="hidden" name="productId" value={line.productId} />
                      <input
                        type="number"
                        name="qty"
                        min={0}
                        defaultValue={line.qty}
                        aria-label={t.qty}
                        className="w-16 px-1 py-1 text-center"
                      />
                      <button type="submit" className="btn-small">
                        {t.update}
                      </button>
                    </form>
                    <form action={removeLineAction}>
                      <input type="hidden" name="productId" value={line.productId} />
                      <button
                        type="submit"
                        className="tap cursor-pointer text-[12px] text-[var(--color-ink-muted)] underline"
                      >
                        {t.remove}
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="scroll-x hidden lg:block">
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
                          className="tech font-bold !text-[var(--color-ink)]"
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
                      <td className="num tech tech-num">{formatPrice(unit, l, rate)}</td>
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
                        {formatPrice(unit * line.qty, l, rate)}
                      </td>
                      <td>
                        <form action={removeLineAction}>
                          <input type="hidden" name="productId" value={line.productId} />
                          <button
                            type="submit"
                            className="cursor-pointer text-[11px] text-[var(--color-ink-muted)] underline"
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

          <div className="mt-4 flex flex-col items-stretch gap-3 border-t border-[var(--color-ink)] pt-3 sm:flex-row sm:items-center sm:justify-end sm:gap-6">
            <span className="text-[15px] sm:text-[13px]">
              {t.subtotal}:{" "}
              <strong className="tech text-[17px] sm:text-[15px]">
                {formatPrice(subtotal, l, rate)}
              </strong>
            </span>
            <Link
              href={`/${l}/quote`}
              className="btn-primary py-3 text-center hover:no-underline sm:py-[7px]"
            >
              {t.requestQuote}
            </Link>
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-ink-faint)] sm:text-end">
            {t.rfqIntro}
          </p>
        </>
      )}
    </main>
  );
}
