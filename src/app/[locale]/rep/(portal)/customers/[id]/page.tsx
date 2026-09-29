import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { getCustomerForRep } from "@/db/customerQueries";
import { listNotes } from "@/db/noteQueries";
import { listOrdersForUser } from "@/db/accountQueries";
import {
  addCustomerNoteAction,
  resetCustomerPasswordAction,
  setFollowUpAction,
  startOrderAction,
  updateCustomerAction,
} from "../../../actions";
import { CustomerFields } from "../CustomerFields";
import { CustomerNotes } from "@/components/CustomerNotes";
import { FollowUpControl } from "@/components/FollowUpControl";
import { ErrorBanner, SuccessBanner } from "@/components/Banners";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { CustomerOrderList } from "@/components/CustomerOrderList";
import { ShownOnceCredential } from "@/components/ShownOnceCredential";
import { readShownOnce } from "@/lib/shownOnce";
import { siteOrigin } from "@/lib/siteOrigin";
import { getFxRate } from "@/lib/fx";
import { tehranToday } from "@/lib/persianCalendar";
import { isUuid } from "@/lib/ids";
import { repMayResetPassword } from "@/lib/repAccount";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

const ERROR_KEY = {
  incomplete: "required",
  invalid: "invalidInput",
  "email-taken": "customerEmailTaken",
  "reset-admin-only": "repResetAdminOnly",
} as const;

const OK_KEY = {
  saved: "customerSaved",
  note: "noteAdded",
} as const;

export default async function RepCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale) || !isUuid(id)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { ok, error } = await searchParams;
  const rep = await requireRep(l);

  // 404 rather than 403 for someone else's customer: a 403 would confirm the
  // id belongs to a customer.
  const customer = await getCustomerForRep(rep.id, id);
  if (!customer) notFound();
  const [notes, orders, origin, liveRate, credential] = await Promise.all([
    listNotes(id),
    listOrdersForUser(id),
    siteOrigin(),
    getFxRate(),
    ok === "created" || ok === "password" ? readShownOnce("customer", id) : Promise.resolve(null),
  ]);
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;
  const okKey = ok && ok in OK_KEY ? OK_KEY[ok as keyof typeof OK_KEY] : null;
  const section = "mb-4 border border-[var(--color-rule)] p-3";
  const hidden = { locale: l, customerId: id };

  return (
    <>
      <p className="mb-2 text-[12px]">
        <Link href={`/${l}/rep/customers`}>← {t.customers}</Link>
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
          {customer.repEarnsCommission ? t.commissionOn : t.commissionOff}
        </span>
        <form action={startOrderAction} className="ms-auto">
          <input type="hidden" name="locale" value={l} />
          <input type="hidden" name="customerId" value={id} />
          <button type="submit" className="btn-primary">
            {t.newOrder}
          </button>
        </form>
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

      <FollowUpControl
        locale={l}
        current={customer.nextFollowUpOn}
        today={tehranToday()}
        action={setFollowUpAction}
        hidden={hidden}
      />
      <CustomerNotes locale={l} notes={notes} action={addCustomerNoteAction} hidden={hidden} />

      <CustomerOrderList
        locale={l}
        orders={orders}
        liveRate={liveRate}
        orderHref={(ref) => `/${l}/rep/orders/${ref}`}
      />

      <section className={section}>
        <h2 className="mb-3 text-[13px] font-bold">{t.details}</h2>
        <form action={updateCustomerAction} className="grid max-w-[680px] gap-3 sm:grid-cols-2">
          <input type="hidden" name="locale" value={l} />
          <input type="hidden" name="customerId" value={id} />
          <CustomerFields t={t} values={customer} />
          <button type="submit" className="btn-small justify-self-start sm:col-span-2">
            {t.save}
          </button>
        </form>
      </section>

      <section className={section}>
        <h2 className="mb-2 text-[13px] font-bold">{t.password}</h2>
        {repMayResetPassword(customer, rep.id) ? (
          <form action={resetCustomerPasswordAction}>
            <input type="hidden" name="locale" value={l} />
            <input type="hidden" name="customerId" value={id} />
            <ConfirmSubmit
              label={t.issueTempPassword}
              title={t.confirmIssueTempPassword}
              continueLabel={t.confirmContinue}
              discardLabel={t.confirmDiscard}
              details={[{ label: t.customerId, value: customer.customerCode, tech: true }]}
            />
          </form>
        ) : (
          <p className="text-[12px] text-[var(--color-ink-muted)]" data-testid="rep-reset-admin-only">
            {t.repResetAdminOnly}
          </p>
        )}
      </section>
    </>
  );
}
