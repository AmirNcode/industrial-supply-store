import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/session";
import { listOrdersForUser } from "@/db/accountQueries";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { OrderStatusPill } from "@/components/OrderStatusPill";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import {
  signOutAction,
  updateProfileAction,
  changePasswordAction,
} from "./actions";
import { isLocale, getDict, locales, type Locale } from "@/lib/i18n";
import { customerCurrencyFor, formatPrice, formatInt } from "@/lib/money";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

const ERROR_KEY = {
  "current-password": "currentPasswordWrong",
  short: "passwordTooShort",
  mismatch: "passwordMismatch",
  invalid: "invalidInput",
  "rate-limit": "rateLimited",
} as const;

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { ok, error } = await searchParams;

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

  const [orders, rate, priceDisplayMode] = await Promise.all([
    listOrdersForUser(user.id),
    getFxRate(),
    getPriceDisplayMode(),
  ]);
  const currency = customerCurrencyFor(priceDisplayMode, l);
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;

  // A failed password change should not leave the panel shut over its own error
  // message, and neither should a successful save leave it shut over the
  // confirmation. Otherwise both sections start closed, as asked.
  const profileOpen = Boolean(errorKey) || ok === "profile" || ok === "password";

  return (
    <main className="mx-auto max-w-[900px] px-3 pt-3 pb-16">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">{t.account}</h1>
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

      {/* Native <details>: collapsed by default, keyboard accessible, and it
          works before any JavaScript loads — which matters because the only
          thing inside is a form. */}
      <details className="mb-3 border border-[var(--color-rule)]">
        <summary className="cursor-pointer bg-[var(--color-panel-alt)] px-3 py-2 text-[13px] font-bold">
          {t.myOrders}{" "}
          <span className="tech font-normal text-[var(--color-ink-muted)]">
            {formatInt(orders.length, l)}
          </span>
        </summary>

        <div className="px-3 pb-3">
          {orders.length === 0 ? (
            <p className="py-4 text-[13px] text-[var(--color-ink-muted)]">
              {t.noOrdersYet} <Link href={`/${l}`}>{t.startBrowsing}</Link>
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-rule-light)]">
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
                  {/* An invoiced order shows the rate it was invoiced at; one
                      still being priced has none, so the live rate is honest. */}
                  <strong className="tech ms-auto text-[13px]">
                    {formatPrice(o.totalCents, currency, l, o.fxRateToRial ?? rate)}
                  </strong>

                  {/* The action comes to the customer rather than waiting to be
                      found. An order sitting at `invoiced` is waiting on them,
                      and that was previously only discoverable by opening it. */}
                  {o.status === "invoiced" && o.paymentUrl && (
                    // New tab: paying leaves the site for a bank's gateway, and
                    // losing the order list behind it means coming back is a
                    // navigation rather than closing a tab. `noopener` is what
                    // stops the payment page reaching back through
                    // `window.opener`, and is required once `target` is set.
                    <a
                      href={o.paymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary shrink-0 text-[11px] hover:no-underline"
                    >
                      {t.payNow}
                    </a>
                  )}
                  {o.invoiceNumber && (
                    <Link
                      href={`/${l}/invoice/${o.ref}`}
                      className="shrink-0 text-[11px]"
                      prefetch={false}
                    >
                      {t.viewInvoice}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <details id="profile" className="border border-[var(--color-rule)]" open={profileOpen}>
        <summary className="cursor-pointer bg-[var(--color-panel-alt)] px-3 py-2 text-[13px] font-bold">
          {t.profileSettings}
        </summary>

        <div className="px-3 pb-4 pt-3">
          {ok === "profile" && <Ok>{t.profileSaved}</Ok>}
          {ok === "password" && <Ok>{t.passwordChanged}</Ok>}
          {errorKey && (
            <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
              {t[errorKey]}
            </p>
          )}

          <form action={updateProfileAction} className="grid max-w-[520px] gap-3">
            <input type="hidden" name="locale" value={l} />
            <label className="block text-[12px]">
              <span className="mb-0.5 block font-bold">{t.company}</span>
              <input
                type="text"
                name="company"
                maxLength={REQUEST_LIMITS.companyChars}
                defaultValue={user.company}
                className="w-full"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[12px]">
                <span className="mb-0.5 block font-bold">{t.contactName}</span>
                <input
                  type="text"
                  name="contactName"
                  maxLength={REQUEST_LIMITS.contactNameChars}
                  defaultValue={user.contactName}
                  className="w-full"
                />
              </label>
              <label className="block text-[12px]">
                <span className="mb-0.5 block font-bold">{t.phone}</span>
                <input
                  type="tel"
                  name="phone"
                  maxLength={REQUEST_LIMITS.phoneChars}
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
                maxLength={REQUEST_LIMITS.poNumberChars}
                dir="ltr"
                defaultValue={user.defaultPoNumber}
                className="w-full"
              />
            </label>

            <label className="block text-[12px]">
              <span className="mb-0.5 block font-bold">{t.languagePreference}</span>
              <select
                name="preferredLocale"
                defaultValue={isLocale(user.locale) ? user.locale : l}
                className="w-full"
              >
                {locales.map((code) => (
                  <option key={code} value={code}>
                    {code === "en" ? t.english : t.persian}
                  </option>
                ))}
              </select>
              <span className="mt-0.5 block text-[11px] text-[var(--color-ink-faint)]">
                {t.languageHint}
              </span>
            </label>

            <button type="submit" className="btn-primary mt-1 justify-self-start">
              {t.saveProfile}
            </button>
          </form>

          <h3 className="mt-6 mb-2 border-t border-[var(--color-rule)] pt-3 text-[13px] font-bold">
            {t.changePassword}
          </h3>
          <form action={changePasswordAction} className="grid max-w-[520px] gap-3">
            <input type="hidden" name="locale" value={l} />
            <label className="block text-[12px]">
              <span className="mb-0.5 block font-bold">{t.currentPassword}</span>
              <input
                type="password"
                name="currentPassword"
                dir="ltr"
                maxLength={REQUEST_LIMITS.passwordChars}
                autoComplete="current-password"
                required
                className="w-full"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[12px]">
                <span className="mb-0.5 block font-bold">{t.newPassword}</span>
                <input
                  type="password"
                  name="newPassword"
                  dir="ltr"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={REQUEST_LIMITS.passwordChars}
                  required
                  className="w-full"
                />
              </label>
              <label className="block text-[12px]">
                <span className="mb-0.5 block font-bold">{t.passwordAgain}</span>
                <input
                  type="password"
                  name="newPasswordConfirm"
                  dir="ltr"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={REQUEST_LIMITS.passwordChars}
                  required
                  className="w-full"
                />
              </label>
            </div>
            <button type="submit" className="btn-small justify-self-start">
              {t.changePassword}
            </button>
          </form>
        </div>
      </details>
    </main>
  );
}

function Ok({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-[12px] text-[var(--color-ok)]">
      {children}
    </p>
  );
}
