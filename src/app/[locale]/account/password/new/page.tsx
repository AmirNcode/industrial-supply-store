import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { setFirstPasswordAction, signOutAction } from "../../actions";
import { currentUser } from "@/lib/session";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { REQUEST_LIMITS } from "@/lib/requestLimits";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const ERROR_KEY = {
  short: "passwordTooShort",
  mismatch: "passwordMismatch",
  invalid: "invalidInput",
  "rate-limit": "rateLimited",
} as const;

/**
 * Where an account that signed in by emailed code chooses its first password.
 * Unlike /account/password there is no "current password" to ask for: the
 * code just proved the owner holds the inbox. Sign-out is offered because the
 * account page, where it normally lives, is gated behind this one.
 */
export default async function FirstPasswordPage({
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

  const user = await currentUser();
  if (!user) redirect(`/${l}/account/signin`);
  if (!user.needsPassword) redirect(`/${l}/account`);
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;

  return (
    <main className="mx-auto max-w-[380px] px-3 pt-8">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.firstPasswordTitle}
      </h1>
      <p className="mb-4 text-[12px]">{t.firstPasswordPrompt}</p>

      {errorKey && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
          {t[errorKey]}
        </p>
      )}

      <form action={setFirstPasswordAction} className="grid gap-3">
        <input type="hidden" name="locale" value={l} />
        <PasswordField name="newPassword" label={t.newPassword} />
        <PasswordField name="passwordAgain" label={t.passwordAgain} />
        <button type="submit" className="btn-primary mt-1 w-full">
          {t.savePassword}
        </button>
      </form>

      <form action={signOutAction} className="mt-4 text-[12px]">
        <input type="hidden" name="locale" value={l} />
        <button type="submit" className="btn-small">
          {t.signOut}
        </button>
      </form>
    </main>
  );
}

function PasswordField({ name, label }: { name: string; label: string }) {
  return (
    <label className="block text-[12px]">
      <span className="mb-0.5 block font-bold">{label}</span>
      <input
        type="password"
        name={name}
        dir="ltr"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={REQUEST_LIMITS.passwordChars}
        required
        className="w-full"
      />
    </label>
  );
}
