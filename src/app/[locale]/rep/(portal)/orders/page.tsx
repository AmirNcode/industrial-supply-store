import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { listOrdersForRep } from "@/db/repOrderQueries";
import { getFxRate } from "@/lib/fx";
import { siteOrigin } from "@/lib/siteOrigin";
import { formatOrderTotal } from "@/lib/invoice";
import { formatPersianDate } from "@/lib/persianCalendar";
import { ORDER_STATUSES, isOrderStatus } from "@/lib/orders";
import { OrderStatusPill, STATUS_LABEL_KEY } from "@/components/OrderStatusPill";
import { ShareButton } from "@/components/ShareButton";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

/**
 * Every order a rep may see — the ones credited to them and their current
 * customers' — newest first, each with its pay link one tap from a message.
 */
export default async function RepOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { status: raw } = await searchParams;
  const status = typeof raw === "string" && isOrderStatus(raw) ? raw : null;
  const rep = await requireRep(l);
  const [orders, liveRate, origin] = await Promise.all([
    listOrdersForRep(rep.id, status),
    getFxRate(),
    siteOrigin(),
  ]);

  const filters: { href: string; label: string; current: boolean }[] = [
    { href: `/${l}/rep/orders`, label: t.filterAll, current: status === null },
    ...ORDER_STATUSES.map((s) => ({
      href: `/${l}/rep/orders?status=${s}`,
      label: t[STATUS_LABEL_KEY[s]],
      current: status === s,
    })),
  ];

  return (
    <>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.ordersTab}
      </h1>
      <nav className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {filters.map((filter) => (
          <Link
            key={filter.href}
            href={filter.href}
            aria-current={filter.current ? "page" : undefined}
            className={filter.current ? "font-bold !text-[var(--color-ink)]" : undefined}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {orders.length === 0 ? (
        <p className="text-[12px] text-[var(--color-ink-muted)]">{t.noOrdersYet}</p>
      ) : (
        <ul className="grid gap-2">
          {orders.map((order) => {
            const url = `${origin}/${l}/pay/${order.payToken}`;
            return (
              <li
                key={order.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-rule)] pb-2 text-[12px]"
              >
                <Link href={`/${l}/rep/orders/${order.ref}`} className="tech font-bold" dir="ltr">
                  {order.ref}
                </Link>
                <span>
                  {order.company}
                  {order.customerCode && (
                    <span className="tech ms-1.5 text-[var(--color-ink-muted)]" dir="ltr">
                      {order.customerCode}
                    </span>
                  )}
                </span>
                <OrderStatusPill locale={l} status={order.status} />
                <span className="text-[var(--color-ink-muted)]">
                  {formatPersianDate(order.createdAt, l)}
                </span>
                <span className="num tech">
                  {formatOrderTotal(
                    order.totalCents,
                    order.vatRateBp,
                    "IRR",
                    l,
                    order.fxRateToRial ?? liveRate,
                  )}
                </span>
                <span className="ms-auto">
                  <ShareButton
                    text={t.payLinkMessage
                      .replace("{company}", order.company)
                      .replace("{ref}", order.ref)
                      .replace("{url}", url)}
                    label={t.sharePayLink}
                    copiedLabel={t.copied}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
