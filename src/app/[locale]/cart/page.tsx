import Link from "next/link";
import { notFound } from "next/navigation";
import { getCartLines, unitPriceAt } from "@/lib/cart";
import { updateQtyAction, removeLineAction } from "@/app/actions";
import { CartPageSync } from "@/components/CartPageSync";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { customerCurrencyFor, formatPrice, formatInt } from "@/lib/money";
import { specValueLabel } from "@/lib/specValues";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { currentRep } from "@/lib/repSession";
import { readOrderingFor } from "@/lib/repOrderContext";
import { getOrderableCustomerForRep } from "@/db/customerQueries";
import { splitCart, type LineSplit } from "@/lib/checkoutSplit";
import { runExpirySweep } from "@/lib/orderFlow";

export default async function CartPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; skipped?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { error, skipped } = await searchParams;

  // First, so a hold that lapsed overnight is back on the shelf before the
  // split below decides what is "in stock" for this buyer.
  await runExpirySweep();
  const [lines, rate, priceDisplayMode, rep, orderingForId] = await Promise.all([
    getCartLines(),
    getFxRate(),
    getPriceDisplayMode(),
    currentRep(),
    readOrderingFor(),
  ]);
  // Reps never see dollar amounts.
  const currency = rep ? "IRR" : customerCurrencyFor(priceDisplayMode, l);
  // "New order" on an unassigned search result puts that customer here too, so
  // own customers alone would leave the banner saying the customer is chosen
  // at checkout. A taken one (or none) names nobody.
  const orderable = rep && orderingForId ? await getOrderableCustomerForRep(rep.id, orderingForId) : null;
  const orderingFor = orderable && orderable.kind !== "taken" ? orderable.customer : null;
  // Set by Reorder: part numbers from the old order that are no longer sold.
  const skippedParts =
    typeof skipped === "string" ? skipped.split(",").filter(Boolean).slice(0, 20) : [];
  // Unpriced lines contribute 0, so the subtotal is the priced part only.
  const subtotal = lines.reduce((sum, x) => sum + unitPriceAt(x, x.qty) * x.qty, 0);
  const split = splitCart(
    lines.map((x) => ({
      productId: x.productId,
      qty: x.qty,
      unitPriceCents: unitPriceAt(x, x.qty),
      inStock: x.inStock,
      available: x.available,
    })),
  );
  const splitById = new Map(split.lines.map((x) => [x.productId, x]));
  // The highlighted line under a part: why it cannot simply be bought, in
  // the buyer's terms. Each reason gets its own words — "back order" alone
  // left people guessing whether the shelf, the supplier or the price was
  // the cause, and that decides whether they lower the quantity or wait.
  const stockNote = (s: LineSplit | undefined): string | null => {
    if (!s) return null;
    if (!s.inStock) return t.cartSupplierItem;
    const onShelf = s.payNow + s.heldForQuote;
    if (s.backorder > 0) {
      return onShelf === 0
        ? t.cartOutOfStock
        : t.cartStockSplit
            .replace("{now}", formatInt(onShelf, l))
            .replace("{later}", formatInt(s.backorder, l));
    }
    return s.heldForQuote > 0 ? t.cartNoPrice : null;
  };

  return (
    <main className="mx-auto max-w-[1100px] px-3 pt-3">
      <CartPageSync revision={lines.map((x) => `${x.productId}:${x.qty}`).join(",")} />
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.yourOrder}
        {lines.length > 0 && (
          <span className="ms-2 text-[12px] font-normal text-[var(--color-ink-muted)]">
            <span className="tech">{formatInt(lines.length, l)}</span> {t.itemsInOrder}
          </span>
        )}
      </h1>
      {rep && (
        <p className="mb-3 flex flex-wrap items-baseline gap-3 border border-[var(--color-rule)] px-3 py-2 text-[12px]">
          <span className="font-bold">
            {orderingFor
              ? t.orderingForName.replace(
                  "{name}",
                  `${orderingFor.company} (${orderingFor.customerCode})`,
                )
              : t.orderingForChoose}
          </span>
          <Link href={`/${l}/rep/customers`}>{t.change}</Link>
        </p>
      )}
      {skippedParts.length > 0 && (
        <p className="mb-3 border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px] text-[var(--color-warn)]">
          {t.reorderSkipped}{" "}
          {skippedParts.map((part, i) => (
            <span key={part}>
              {i > 0 && ", "}
              <span className="tech" dir="ltr">
                {part}
              </span>
            </span>
          ))}
        </p>
      )}
      {error === "rate-limit" && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
          {t.rateLimited}
        </p>
      )}

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
              const note = stockNote(splitById.get(line.productId));
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
                      {note && (
                        <span className="mt-1 block w-fit bg-[var(--color-warn-soft)] px-1.5 py-0.5 text-[12px] font-semibold text-[var(--color-ink)]">
                          {note}
                        </span>
                      )}
                    </div>
                    <span className="tech shrink-0 text-[15px] font-bold">
                      {unit > 0 ? formatPrice(unit * line.qty, currency, l, rate) : t.cartRequestQuoteCell}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    <span className="tech text-[12px] text-[var(--color-ink-muted)]">
                      {unit > 0 ? `${formatPrice(unit, currency, l, rate)} / ${t.each}` : t.cartRequestQuoteCell}
                    </span>
                    <form
                      action={updateQtyAction}
                      className="ms-auto flex items-center gap-1.5"
                    >
                      <input type="hidden" name="productId" value={line.productId} />
                      <input type="hidden" name="locale" value={l} />
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
                      <input type="hidden" name="locale" value={l} />
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
                  const note = stockNote(splitById.get(line.productId));
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
                        {note && (
                          <span className="mt-0.5 block w-fit bg-[var(--color-warn-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-ink)]">{note}</span>
                        )}
                      </td>
                      <td className="num tech tech-num">
                        {unit > 0 ? formatPrice(unit, currency, l, rate) : t.cartRequestQuoteCell}
                      </td>
                      <td>
                        <form action={updateQtyAction} className="flex items-center gap-1">
                          <input type="hidden" name="productId" value={line.productId} />
                          <input type="hidden" name="locale" value={l} />
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
                        {unit > 0 ? formatPrice(unit * line.qty, currency, l, rate) : t.cartRequestQuoteCell}
                      </td>
                      <td>
                        <form action={removeLineAction}>
                          <input type="hidden" name="productId" value={line.productId} />
                          <input type="hidden" name="locale" value={l} />
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
                {formatPrice(subtotal, currency, l, rate)}
              </strong>
            </span>
            <Link
              href={`/${l}/quote`}
              className="btn-primary py-3 text-center hover:no-underline sm:py-[7px]"
            >
              {split.kind === "instant" ? t.checkout : t.requestQuote}
            </Link>
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-ink-faint)] sm:text-end">
            {t.cartVatNote}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-ink-faint)] sm:text-end">
            {split.kind === "instant"
              ? t.cartCheckoutNote
              : split.kind === "quote"
                ? t.cartQuoteOnlyNote
                : t.cartNeedsQuoteNote}
          </p>
        </>
      )}
    </main>
  );
}
