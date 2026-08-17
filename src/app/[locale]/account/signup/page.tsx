import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signUpAction } from "../actions";
import { currentUser } from "@/lib/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

const MESSAGE = {
  incomplete: "signUpIncomplete",
  short: "passwordTooShort",
  mismatch: "passwordMismatch",
  taken: "emailTaken",
  invalid: "invalidInput",
  "rate-limit": "rateLimited",
} as const;

export default async function SignUpPage({
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

  // currentUser, not currentUserId: a validly signed cookie whose row has
  // gone (a reseed, a deletion) would otherwise bounce the visitor here from
  // /account and straight back again, with no way to sign in, up, or out.
  if (await currentUser()) redirect(`/${l}/account`);

  const messageKey = error && error in MESSAGE ? MESSAGE[error as keyof typeof MESSAGE] : null;

  return (
    <main className="mx-auto max-w-[440px] px-3 pt-8">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.signUpTitle}
      </h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{t.signUpPrompt}</p>

      {messageKey && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
          {t[messageKey]}
        </p>
      )}

      <form action={signUpAction} className="grid gap-3">
        <input type="hidden" name="locale" value={l} />

        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">
            {t.email}
            <span className="text-[var(--color-danger)]"> *</span>
          </span>
          <input
            type="email"
            name="email"
            dir="ltr"
            maxLength={REQUEST_LIMITS.emailChars}
            required
            autoFocus
            className="w-full"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px]">
            <span className="mb-0.5 block font-bold">
              {t.password}
              <span className="text-[var(--color-danger)]"> *</span>
            </span>
            <input
              type="password"
              name="password"
              dir="ltr"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={REQUEST_LIMITS.passwordChars}
              required
              className="w-full"
            />
          </label>
          <label className="block text-[12px]">
            <span className="mb-0.5 block font-bold">
              {t.passwordAgain}
              <span className="text-[var(--color-danger)]"> *</span>
            </span>
            <input
              type="password"
              name="passwordConfirm"
              dir="ltr"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={REQUEST_LIMITS.passwordChars}
              required
              className="w-full"
            />
          </label>
        </div>

        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">
            {t.company}
            <span className="text-[var(--color-danger)]"> *</span>
          </span>
          <input
            type="text"
            name="company"
            maxLength={REQUEST_LIMITS.companyChars}
            required
            className="w-full"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px]">
            <span className="mb-0.5 block font-bold">
              {t.contactName}
              <span className="text-[var(--color-danger)]"> *</span>
            </span>
            <input
              type="text"
              name="contactName"
              maxLength={REQUEST_LIMITS.contactNameChars}
              required
              className="w-full"
            />
          </label>
          <label className="block text-[12px]">
            <span className="mb-0.5 block font-bold">
              {t.phone}
              <span className="text-[var(--color-danger)]"> *</span>
            </span>
            <input
              type="tel"
              name="phone"
              dir="ltr"
              maxLength={REQUEST_LIMITS.phoneChars}
              required
              className="w-full"
            />
          </label>
        </div>

        <button type="submit" className="btn-primary mt-1 w-full">
          {t.signUp}
        </button>
      </form>

      <p className="mt-4 text-[12px] text-[var(--color-ink-muted)]">
        {t.haveAccount} <Link href={`/${l}/account/signin`}>{t.signInTitle}</Link>
      </p>
    </main>
  );
}
