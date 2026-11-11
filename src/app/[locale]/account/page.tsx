import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { listOrdersForUser } from "@/db/accountQueries";
import { listAddresses } from "@/db/addressQueries";
import { formatDeadline, runExpirySweep } from "@/lib/orderFlow";
import { getRepContactForUser } from "@/db/userQueries";
import { latinDigits } from "@/lib/digits";
import { getFxRate, getPriceDisplayMode } from "@/lib/fx";
import { OrderStatusPill } from "@/components/OrderStatusPill";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import {
  signOutAction,
  updateProfileAction,
  changePasswordAction,
  saveAddressAction,
  setDefaultAddressAction,
  deleteAddressAction,
} from "./actions";
import { isLocale, getDict, locales, type Locale } from "@/lib/i18n";
import { customerCurrencyFor, formatInt } from "@/lib/money";
import { formatOrderTotal } from "@/lib/invoice";
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
  if (user.mustChangePassword) redirect(`/${l}/account/password`);
  // An account made by checkout or sign-up has no password yet; nothing on
  // this page is shown until it chooses one.
  if (user.needsPassword) redirect(`/${l}/account/password/new`);

  // Before the order read, so a lapsed pish-factor shows as cancelled here.
  await runExpirySweep();

  const [orders, addresses, rate, priceDisplayMode, repContact] = await Promise.all([
    listOrdersForUser(user.id),
    listAddresses(user.id),
    getFxRate(),
    getPriceDisplayMode(),
    getRepContactForUser(user.id),
  ]);
  const currency = customerCurrencyFor(priceDisplayMode, l);
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;

  // A failed password change should not leave the panel shut over its own error
  // message, and neither should a successful save leave it shut over the
  // confirmation. Otherwise both sections start closed, as asked.
  const profileOpen = Boolean(errorKey) || ok === "profile" || ok === "password";
  const addressesOpen = ok === "address" || error === "address" || error === "address-full";
  const addressErrorKey =
    error === "address" ? "addressInvalid" : error === "address-full" ? "addressFull" : null;
  const awaitingPayment = orders.filter((o) => o.status === "invoiced");
  const quotesWaiting = orders.filter((o) => o.status === "quoted");

  return (
    <main className="mx-auto max-w-[900px] px-3 pt-3 pb-16">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">{t.account}</h1>
        <div className="flex items-baseline gap-3 text-[11px] text-[var(--color-ink-muted)]">
          <span>
            {t.signedInAs} <span className="tech">{user.email ?? user.customerCode}</span>
          </span>
          <form action={signOutAction}>
            <input type="hidden" name="locale" value={l} />
            <button type="submit" className="underline">
              {t.signOut}
            </button>
          </form>
        </div>
      </div>

      {/* The number a rep types to place an order for this customer. */}
      <section className="mb-3 border border-[var(--color-rule)] px-3 py-2 text-[12px]">
        <h2 className="mb-1 text-[13px] font-bold">{t.accountNumber}</h2>
        <p>
          <span className="tech text-[15px] font-bold" dir="ltr" data-testid="customer-id">
            {user.customerCode}
          </span>
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">{t.accountNumberHint}</p>
      </section>

      <OrderGroup heading={t.awaitingPaymentHeading} orders={awaitingPayment} l={l} />
      <OrderGroup heading={t.quotesWaitingHeading} orders={quotesWaiting} l={l} />

      {repContact && (
        <section className="mb-3 border border-[var(--color-rule)] px-3 py-2 text-[12px]">
          <h2 className="mb-1 text-[13px] font-bold">{t.yourSalesRep}</h2>
          <p className="flex flex-wrap items-baseline gap-3">
            <span data-testid="your-rep">{repContact.name}</span>
            {repContact.phone && (
              // Digits normalised first: a phone typed in Persian digits would
              // otherwise leave nothing for the tel: link to dial.
              <a
                href={`tel:${latinDigits(repContact.phone).replace(/[^\d+]/g, "")}`}
                className="tech"
                dir="ltr"
              >
                {repContact.phone}
              </a>
            )}
          </p>
        </section>
      )}

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
                  {/* An invoiced order shows the rate and VAT it was invoiced
                      at; one still being priced has neither, so the live rate
                      is honest. */}
                  <strong className="tech ms-auto text-[13px]">
                    {formatOrderTotal(o.totalCents, o.vatRateBp, currency, l, o.fxRateToRial ?? rate)}
                  </strong>
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

      <details id="addresses" className="mb-3 border border-[var(--color-rule)]" open={addressesOpen}>
        <summary className="cursor-pointer bg-[var(--color-panel-alt)] px-3 py-2 text-[13px] font-bold">
          {t.addressesHeading}{" "}
          <span className="tech font-normal text-[var(--color-ink-muted)]">
            {formatInt(addresses.length, l)}
          </span>
        </summary>

        <div className="px-3 pb-3 pt-3">
          {ok === "address" && <Ok>{t.addressSaved}</Ok>}
          {addressErrorKey && (
            <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
              {t[addressErrorKey]}
            </p>
          )}

          {addresses.length === 0 ? (
            <p className="mb-3 text-[13px] text-[var(--color-ink-muted)]">{t.noAddresses}</p>
          ) : (
            <ul className="mb-3 divide-y divide-[var(--color-rule-light)]">
              {addresses.map((a) => (
                <li key={a.id} className="py-3 text-[12px]">
                  <div className="flex flex-wrap items-baseline gap-2">
                    {a.label && <strong className="text-[13px]">{a.label}</strong>}
                    {a.isDefault && (
                      <span className="border border-[var(--color-rule)] px-1.5 text-[10px] font-bold uppercase">
                        {t.defaultAddress}
                      </span>
                    )}
                  </div>
                  {(a.recipient || a.phone) && (
                    <p className="mt-0.5">
                      {a.recipient}
                      {a.recipient && a.phone && " · "}
                      {a.phone && (
                        <span className="tech" dir="ltr">
                          {a.phone}
                        </span>
                      )}
                    </p>
                  )}
                  <p className="mt-0.5 whitespace-pre-line">{a.address}</p>
                  <p className="mt-0.5 text-[var(--color-ink-muted)]">
                    {a.city}
                    {a.postalCode && (
                      <>
                        {" · "}
                        <span className="tech" dir="ltr">
                          {a.postalCode}
                        </span>
                      </>
                    )}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!a.isDefault && (
                      <form action={setDefaultAddressAction}>
                        <input type="hidden" name="locale" value={l} />
                        <input type="hidden" name="addressId" value={a.id} />
                        <button type="submit" className="btn-small">
                          {t.makeDefault}
                        </button>
                      </form>
                    )}
                    <form action={deleteAddressAction}>
                      <input type="hidden" name="locale" value={l} />
                      <input type="hidden" name="addressId" value={a.id} />
                      <button type="submit" className="btn-small">
                        {t.deleteAddress}
                      </button>
                    </form>
                  </div>

                  {/* The form is in the details body, not the summary: a click
                      on a summary toggles it and never submits. */}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[12px] underline">{t.editAddress}</summary>
                    <AddressForm l={l} address={a} t={t} />
                  </details>
                </li>
              ))}
            </ul>
          )}

          <details open={addresses.length === 0} className="border-t border-[var(--color-rule-light)] pt-2">
            <summary className="cursor-pointer text-[12px] font-bold">{t.addAddress}</summary>
            <AddressForm l={l} t={t} />
          </details>
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

            <fieldset className="grid gap-3 border-t border-[var(--color-rule-light)] pt-3">
              <legend className="text-[12px] font-bold">{t.taxHeading}</legend>
              <p className="-mt-1 text-[11px] text-[var(--color-ink-faint)]">{t.taxHint}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[12px]">
                  <span className="mb-0.5 block font-bold">{t.nationalId}</span>
                  <input
                    type="text"
                    name="nationalId"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={20}
                    defaultValue={user.nationalId}
                    className="w-full"
                  />
                </label>
                <label className="block text-[12px]">
                  <span className="mb-0.5 block font-bold">{t.economicCode}</span>
                  <input
                    type="text"
                    name="economicCode"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={20}
                    defaultValue={user.economicCode}
                    className="w-full"
                  />
                </label>
              </div>
            </fieldset>

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

type Dict = ReturnType<typeof getDict>;

function AddressForm({
  l,
  t,
  address,
}: {
  l: Locale;
  t: Dict;
  address?: Awaited<ReturnType<typeof listAddresses>>[number];
}) {
  return (
    <form action={saveAddressAction} className="mt-2 grid max-w-[520px] gap-3">
      <input type="hidden" name="locale" value={l} />
      {address && <input type="hidden" name="addressId" value={address.id} />}
      <label className="block text-[12px]">
        <span className="mb-0.5 block font-bold">{t.addressLabel}</span>
        <input
          type="text"
          name="label"
          maxLength={REQUEST_LIMITS.addressLabelChars}
          placeholder={t.addressLabelHint}
          defaultValue={address?.label}
          className="w-full"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">{t.recipient}</span>
          <input
            type="text"
            name="recipient"
            maxLength={REQUEST_LIMITS.contactNameChars}
            defaultValue={address?.recipient}
            className="w-full"
          />
        </label>
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">{t.phone}</span>
          <input
            type="tel"
            name="addressPhone"
            dir="ltr"
            maxLength={REQUEST_LIMITS.phoneChars}
            defaultValue={address?.phone}
            className="w-full"
          />
        </label>
      </div>
      <label className="block text-[12px]">
        <span className="mb-0.5 block font-bold">
          {t.address}
          <span className="text-[var(--color-danger)]"> *</span>
        </span>
        <textarea
          name="address"
          rows={2}
          maxLength={REQUEST_LIMITS.addressChars}
          required
          defaultValue={address?.address}
          className="w-full"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">
            {t.city}
            <span className="text-[var(--color-danger)]"> *</span>
          </span>
          <input
            type="text"
            name="city"
            maxLength={REQUEST_LIMITS.cityChars}
            required
            defaultValue={address?.city}
            className="w-full"
          />
        </label>
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">{t.postalCode}</span>
          <input
            type="text"
            name="postalCode"
            dir="ltr"
            inputMode="numeric"
            maxLength={20}
            defaultValue={address?.postalCode}
            className="w-full"
          />
        </label>
      </div>
      {!address && (
        <label className="flex items-baseline gap-2 text-[12px]">
          <input type="checkbox" name="makeDefault" />
          <span>{t.makeDefault}</span>
        </label>
      )}
      <button type="submit" className="btn-small justify-self-start">
        {t.saveProfile}
      </button>
    </form>
  );
}

/** The orders waiting on the customer, above the full list; nothing when none. */
function OrderGroup({
  heading,
  orders,
  l,
}: {
  heading: string;
  orders: Awaited<ReturnType<typeof listOrdersForUser>>;
  l: Locale;
}) {
  if (orders.length === 0) return null;
  return (
    <section className="mb-3 border border-[var(--color-rule)] px-3 py-2 text-[12px]">
      <h2 className="mb-1 text-[13px] font-bold">{heading}</h2>
      <ul className="divide-y divide-[var(--color-rule-light)]">
        {orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
            <Link href={`/${l}/account/orders/${o.ref}`} className="tech text-[13px] font-bold" prefetch={false}>
              {o.ref}
            </Link>
            <OrderStatusPill locale={l} status={o.status} />
            {o.expiresAt && (
              <span className="tech text-[11px] text-[var(--color-ink-muted)]">
                {formatDeadline(o.expiresAt, l)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
