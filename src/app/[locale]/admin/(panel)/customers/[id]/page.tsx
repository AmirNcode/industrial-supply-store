import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/demo";
import { getCustomerAdmin } from "@/db/customerQueries";
import { listActiveReps } from "@/db/repQueries";
import { listNotes } from "@/db/noteQueries";
import { listOrdersForUser } from "@/db/accountQueries";
import {
  addCustomerNoteAdminAction,
  assignCustomerAction,
  resetCustomerPasswordAdminAction,
  setFollowUpAdminAction,
} from "../actions";
import { originLabel } from "../originLabel";
import { CustomerNotes } from "@/components/CustomerNotes";
import { CustomerOrderList } from "@/components/CustomerOrderList";
import { FollowUpControl } from "@/components/FollowUpControl";
import { ErrorBanner, SuccessBanner } from "@/components/Banners";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { ShownOnceCredential } from "@/components/ShownOnceCredential";
import { readShownOnce } from "@/lib/shownOnce";
import { siteOrigin } from "@/lib/siteOrigin";
import { getFxRate } from "@/lib/fx";
import { tehranToday } from "@/lib/persianCalendar";
import { isUuid } from "@/lib/ids";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

const ERROR_KEY = {
  rep: "repBadDestination",
  invalid: "invalidInput",
} as const;

const OK_KEY = {
  assigned: "assignmentSaved",
  note: "noteAdded",
} as const;

export default async function AdminCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  // Not on the public demo: see ../page.tsx.
  if (DEMO_MODE) notFound();
  if (!isLocale(locale) || !isUuid(id)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { ok, error } = await searchParams;

  const customer = await getCustomerAdmin(id);
  if (!customer) notFound();
  const [activeReps, notes, orders, liveRate, origin, credential] = await Promise.all([
    listActiveReps(),
    listNotes(id),
    listOrdersForUser(id),
    getFxRate(),
    siteOrigin(),
    ok === "password" ? readShownOnce("customer", id) : Promise.resolve(null),
  ]);
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;
  const okKey = ok && ok in OK_KEY ? OK_KEY[ok as keyof typeof OK_KEY] : null;
  const section = "mb-4 border border-[var(--color-rule)] p-3";
  const hidden = { locale: l, customerId: id };
  // Deactivating a rep moves their customers, so a customer should never sit
  // with an inactive one. If one does, it is listed as an ordinary option:
  // a disabled option is left out of the submitted form, and saving would
  // quietly unassign the customer instead of refusing the inactive rep.
  const currentRepInactive =
    customer.repId !== null && !activeReps.some((rep) => rep.id === customer.repId);

  // Phone and email are left-to-right: in a Persian page a spaced phone
  // number otherwise renders its digit groups in reverse order.
  const details: [label: string, value: string, ltr: boolean][] = [
    [t.contactName, customer.contactName, false],
    [t.phone, customer.phone, true],
    [t.email, customer.email ?? "—", true],
    [t.city, customer.city || "—", false],
    [t.address, customer.address || "—", false],
  ];

  return (
    <>
      <p className="mb-2 text-[12px]">
        <Link href={`/${l}/admin/customers`}>← {t.customers}</Link>
      </p>
      <div className="mb-3 flex flex-wrap items-baseline gap-3 border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">{customer.company}</h1>
        <span className="text-[12px]">
          {t.customerId}{" "}
          <span className="tech" dir="ltr" data-testid="customer-code">
            {customer.customerCode}
          </span>
        </span>
        <span className="text-[11px] text-[var(--color-ink-muted)]">
          {originLabel(t, customer.origin, customer.originRepName)}
        </span>
      </div>

      {credential && (
        <ShownOnceCredential
          heading={t.tempPasswordOnce}
          loginLabel={t.customerId}
          login={credential.login}
          password={credential.password}
          message={t.customerCredentialsMessage
            .replace("{url}", `${origin}/${l}/account/signin`)
            .replace("{login}", credential.login)
            .replace("{password}", credential.password)}
          labels={{ tempPassword: t.tempPassword, share: t.share, copied: t.copied }}
        />
      )}
      {okKey && <SuccessBanner>{t[okKey]}</SuccessBanner>}
      {errorKey && <ErrorBanner>{t[errorKey]}</ErrorBanner>}

      <section className={section}>
        <h2 className="mb-2 text-[13px] font-bold">{t.assignRep}</h2>
        <form action={assignCustomerAction} className="grid max-w-[680px] gap-2">
          <input type="hidden" name="locale" value={l} />
          <input type="hidden" name="customerId" value={id} />
          <select
            name="repId"
            defaultValue={customer.repId ?? ""}
            aria-label={t.assignRep}
            disabled={DEMO_MODE}
            className="max-w-[360px]"
          >
            <option value="">{t.noRep}</option>
            {currentRepInactive && (
              <option value={customer.repId!}>
                {customer.repName} ({t.repStatusInactive})
              </option>
            )}
            {activeReps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.name}
              </option>
            ))}
          </select>
          <label className="flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              name="earnsCommission"
              defaultChecked={customer.repEarnsCommission}
              disabled={DEMO_MODE}
              className="mt-0.5"
            />
            <span>
              {t.repEarnsCommission}
              <span className="block text-[11px] text-[var(--color-ink-muted)]">
                {t.repEarnsCommissionHint}
              </span>
            </span>
          </label>
          <button type="submit" className="btn-small justify-self-start" disabled={DEMO_MODE}>
            {t.save}
          </button>
        </form>
      </section>

      <section className={section}>
        <h2 className="mb-2 text-[13px] font-bold">{t.details}</h2>
        <dl className="grid max-w-[680px] grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12px]">
          {details.map(([label, value, ltr]) => (
            <div key={label} className="contents">
              <dt className="font-semibold">{label}</dt>
              <dd className={ltr ? "tech justify-self-start" : "whitespace-pre-line"} dir={ltr ? "ltr" : undefined}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <FollowUpControl
        locale={l}
        current={customer.nextFollowUpOn}
        today={tehranToday()}
        action={setFollowUpAdminAction}
        hidden={hidden}
        disabled={DEMO_MODE}
      />
      <CustomerNotes
        locale={l}
        notes={notes}
        action={addCustomerNoteAdminAction}
        hidden={hidden}
        disabled={DEMO_MODE}
      />
      <CustomerOrderList locale={l} orders={orders} liveRate={liveRate} />

      <section className={section}>
        <h2 className="mb-2 text-[13px] font-bold">{t.password}</h2>
        <form action={resetCustomerPasswordAdminAction}>
          <input type="hidden" name="locale" value={l} />
          <input type="hidden" name="customerId" value={id} />
          <ConfirmSubmit
            label={t.issueTempPassword}
            title={t.confirmIssueTempPassword}
            continueLabel={t.confirmContinue}
            discardLabel={t.confirmDiscard}
            disabled={DEMO_MODE}
            details={[{ label: t.customerId, value: customer.customerCode, tech: true }]}
          />
        </form>
      </section>
    </>
  );
}
