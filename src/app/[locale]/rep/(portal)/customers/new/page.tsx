import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { createCustomerAction } from "../../../actions";
import { CustomerFields } from "../CustomerFields";
import { ErrorBanner } from "@/components/Banners";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

const ERROR_KEY = {
  incomplete: "required",
  invalid: "invalidInput",
  "code-taken": "customerCodeTaken",
  "email-taken": "customerEmailTaken",
  "no-phone-code": "customerPhoneTooShort",
  "rate-limit": "rateLimited",
} as const;

export default async function RepNewCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { error } = await searchParams;
  await requireRep(l);
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;

  return (
    <>
      <p className="mb-2 text-[12px]">
        <Link href={`/${l}/rep/customers`}>← {t.customers}</Link>
      </p>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.newCustomer}
      </h1>
      {errorKey && <ErrorBanner>{t[errorKey]}</ErrorBanner>}

      <section className="mb-4 border border-[var(--color-rule)] p-3">
        <form action={createCustomerAction} className="grid max-w-[680px] gap-3 sm:grid-cols-2">
          <input type="hidden" name="locale" value={l} />
          <CustomerFields t={t} />
          <fieldset className="grid gap-1 text-[12px] sm:col-span-2">
            <legend className="mb-1 text-[11px] font-semibold">{t.customerCodeChoice}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="codeChoice" value="phone" defaultChecked />
              {t.customerCodeFromPhone}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="codeChoice" value="random" />
              {t.customerCodeRandom}
            </label>
          </fieldset>
          <button type="submit" className="btn-primary justify-self-start sm:col-span-2">
            {t.createCustomer}
          </button>
        </form>
      </section>
    </>
  );
}
