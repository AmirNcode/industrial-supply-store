import Link from "next/link";
import { notFound } from "next/navigation";
import { normaliseRef } from "@/lib/trackRef";
import { findOrderForTracking } from "@/db/trackQueries";
import { OrderStatusPill } from "@/components/OrderStatusPill";
import { OrderTimeline } from "@/components/OrderTimeline";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

/**
 * The form submits by GET, so a result survives a reload and can be
 * bookmarked — which does mean the email sits in the URL, and so in browser
 * history and our access logs. `noindex` keeps a result URL out of search
 * results if one is ever posted publicly; the rest is the same address the
 * customer already gave us when they ordered.
 */
export const metadata = { robots: { index: false, follow: false } };

/**
 * Tracking an order without an account.
 *
 * The reference alone gates nothing — six characters from a 32-symbol
 * alphabet is guessable, and a hit would otherwise expose a company's order.
 * It is paired with the email the order was placed under, and every miss
 * gives the same message, so the form cannot be used to test which reference
 * exists or which address ordered.
 */
export default async function TrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ref?: string; email?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const { ref: rawRef, email } = await searchParams;
  const asked = Boolean(rawRef && email);

  // A malformed reference takes the same path as a real miss. A distinct
  // "that is not a valid reference" message would tell someone probing which
  // of their two inputs to keep varying.
  const normalised = asked ? normaliseRef(rawRef!) : null;
  const order = normalised ? await findOrderForTracking(normalised, email!) : null;

  return (
    <main className="mx-auto max-w-[560px] px-3 pt-8 pb-16">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.trackOrder}
      </h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{t.trackIntro}</p>

      <form method="get" className="grid gap-3">
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">{t.trackRefLabel}</span>
          <input
            type="text"
            name="ref"
            dir="ltr"
            placeholder="ORD-XXXXXX"
            defaultValue={rawRef ?? ""}
            required
            // Only on a fresh visit. Once there is a result below, pulling
            // focus back up scrolls past it and opens the keyboard on mobile.
            autoFocus={!asked}
            className="tech w-full"
          />
        </label>
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">{t.email}</span>
          <input
            type="email"
            name="email"
            dir="ltr"
            defaultValue={email ?? ""}
            required
            className="w-full"
          />
        </label>
        <button type="submit" className="btn-primary mt-1 w-full">
          {t.trackSubmit}
        </button>
      </form>

      {asked && !order && (
        <p className="mt-4 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
          {t.trackNotFound}
        </p>
      )}

      {order && (
        <section className="mt-6 border border-[var(--color-rule)] p-3">
          <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-[var(--color-rule)] pb-2">
            <span className="tech text-[15px] font-bold">{order.ref}</span>
            <OrderStatusPill locale={l} status={order.status} />
          </div>

          <OrderTimeline
            locale={l}
            status={order.status}
            stamps={{
              createdAt: order.createdAt,
              invoicedAt: order.invoicedAt,
              paidAt: order.paidAt,
              shippedAt: order.shippedAt,
              deliveredAt: order.deliveredAt,
            }}
          />

          {/* Shown whenever there is one, not only while `shipped` — a
              delivered parcel is exactly what someone comes here to look up. */}
          {order.trackingNumber ? (
            <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--color-rule)] pt-2 text-[12px]">
              {order.courier && (
                <div className="flex gap-1.5">
                  <dt className="font-bold">{t.trackCourier}:</dt>
                  <dd>{order.courier}</dd>
                </div>
              )}
              <div className="flex gap-1.5">
                <dt className="font-bold">{t.trackingNumber}:</dt>
                <dd className="tech">{order.trackingNumber}</dd>
              </div>
            </dl>
          ) : (
            order.status !== "cancelled" && (
              <p className="border-t border-[var(--color-rule)] pt-2 text-[12px] text-[var(--color-ink-muted)]">
                {t.trackNoTracking}
              </p>
            )
          )}
        </section>
      )}

      <p className="mt-6 text-[12px] text-[var(--color-ink-muted)]">
        {t.trackHaveAccount}{" "}
        <Link href={`/${l}/account/signup`}>{t.signUp}</Link>
      </p>
    </main>
  );
}
