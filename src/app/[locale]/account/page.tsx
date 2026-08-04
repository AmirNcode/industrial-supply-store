import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/session";
import { listOrdersForUser } from "@/db/accountQueries";
import { getFxRate } from "@/lib/fx";
import { OrderStatusPill } from "@/components/OrderStatusPill";
import { signOutAction, updateProfileAction } from "./actions";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatPrice, formatInt } from "@/lib/money";

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { ok } = await searchParams;

  const user = await currentUser();

  // A prompt rather than a redirect: the masthead links here unconditionally,
  // so a signed-out visitor arriving is ordinary, not an error.
  if (!user) {
    return (
      <main className="mx-auto max-w-[420px] px-3 pt-10 text-center">
        <h1 className="mb-2 text-[17px] font-bold">{t.account}</h1>
        <p className="mb-4 text-[13px] text-[var(--color-ink-muted)]">{t.signInPrompt}</p>
        <div className="flex justify-center gap-3">
          <Link href={`/${l}/account/signin`} className="btn-primary">
            {t.signInTitle}
          </Link>
          <Link href={`/${l}/account/signup`} className="btn-small">
            {t.signUp}
          </Link>
        </div>
      </main>
    );
  }

  const [orders, rate] = await Promise.all([listOrdersForUser(user.id), getFxRate()]);

  return (
    <main className="mx-auto max-w-[900px] px-3 pt-3">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">{t.myOrders}</h1>
        <div className="flex items-baseline gap-3 text-[11px] text-[var(--color-ink-muted)]">
          <span>
            {t.signedInAs} <span className="tech">{user.email}</span>
          </span>
          <form action={signOutAction}>
            <input type="hidden" name="locale" value={l} />
            <button type="submit" className="underline">
              {t.signOut}
            </button>
          </form>
        </div>
      </div>

      {ok === "profile" && (
        <p className="mb-3 border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-[12px] text-[var(--color-ok)]">
          {t.profileSaved}
        </p>
      )}

      {orders.length === 0 ? (
        <p className="py-6 text-[13px] text-[var(--color-ink-muted)]">
          {t.noOrdersYet} <Link href={`/${l}`}>{t.startBrowsing}</Link>
        </p>
      ) : (
        <ul className="mb-8 divide-y divide-[var(--color-rule-light)] border-y border-[var(--color-rule-light)]">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <Link
                href={`/${l}/account/orders/${o.ref}`}
                className="tech text-[13px] font-bold"
                prefetch={false}
              >
                {o.ref}
              </Link>
              <OrderStatusPill locale={l} status={o.status} />
              <span className="tech text-[11px] text-[var(--color-ink-faint)]">
                {new Date(o.createdAt).toISOString().slice(0, 10)}
              </span>
              <span className="text-[11px] text-[var(--color-ink-muted)]">
                <span className="tech">{formatInt(o.itemCount, l)}</span> {t.itemsInOrder}
              </span>
              {/* An invoiced order shows the rate it was invoiced at; one still
                  being priced has none, so the live rate is the honest one. */}
              <strong className="tech ms-auto text-[13px]">
                {formatPrice(o.totalCents, l, o.fxRateToToman ?? rate)}
              </strong>
            </li>
          ))}
        </ul>
      )}

      <section className="max-w-[520px]">
        <h2 className="mb-2 border-b border-[var(--color-rule)] pb-1 text-[13px] font-bold">
          {t.profile}
        </h2>
        <form action={updateProfileAction} className="grid gap-3">
          <input type="hidden" name="locale" value={l} />
          <label className="block text-[12px]">
            <span className="mb-0.5 block font-bold">{t.company}</span>
            <input type="text" name="company" defaultValue={user.company} className="w-full" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[12px]">
              <span className="mb-0.5 block font-bold">{t.contactName}</span>
              <input
                type="text"
                name="contactName"
                defaultValue={user.contactName}
                className="w-full"
              />
            </label>
            <label className="block text-[12px]">
              <span className="mb-0.5 block font-bold">{t.phone}</span>
              <input
                type="tel"
                name="phone"
                dir="ltr"
                defaultValue={user.phone}
                className="w-full"
              />
            </label>
          </div>
          <label className="block text-[12px]">
            <span className="mb-0.5 block font-bold">{t.defaultPoNumber}</span>
            <input
              type="text"
              name="defaultPoNumber"
              dir="ltr"
              defaultValue={user.defaultPoNumber}
              className="w-full"
            />
          </label>
          <button type="submit" className="btn-primary mt-1 justify-self-start">
            {t.saveProfile}
          </button>
        </form>
      </section>
    </main>
  );
}
