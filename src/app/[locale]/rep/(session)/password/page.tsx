import Link from "next/link";
import { notFound } from "next/navigation";
import { repChangePasswordAction, repSignOutAction } from "../../actions";
import { requireRepSession } from "@/lib/repSession";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

const ERROR_KEY = {
  policy: "repPasswordPolicy",
  mismatch: "passwordMismatch",
  "current-password": "currentPasswordWrong",
  invalid: "invalidInput",
  "rate-limit": "rateLimited",
} as const;

/**
 * Where a temporary password must be replaced, and where a rep changes their
 * own password later. The rules are always on screen: a rule a person meets
 * only as an error message is a rule they meet twice.
 */
export default async function RepPasswordPage({
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
  const rep = await requireRepSession(l);
  const forced = rep.mustChangePassword;
  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;

  return (
    <main className="mx-auto max-w-[380px] px-3 pt-8">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {forced ? t.choosePasswordTitle : t.changePassword}
      </h1>
      {forced && <p className="mb-3 text-[12px]">{t.tempPasswordForced}</p>}

      {errorKey && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
          {t[errorKey]}
        </p>
      )}
      <p className="mb-3 text-[11px] text-[var(--color-ink-muted)]">{t.repPasswordRules}</p>

      <form action={repChangePasswordAction} className="grid gap-3">
        <input type="hidden" name="locale" value={l} />
        {!forced && (
          <PasswordField name="currentPassword" label={t.currentPassword} autoComplete="current-password" />
        )}
        <PasswordField name="newPassword" label={t.newPassword} autoComplete="new-password" />
        <PasswordField name="passwordAgain" label={t.passwordAgain} autoComplete="new-password" />
        <button type="submit" className="btn-primary mt-1 w-full">
          {t.savePassword}
        </button>
      </form>

      {forced ? (
        // The portal's sign-out sits behind this page, and a forced change asks
        // for no current password: without this, a session left open on a
        // shared computer lets the next person choose the rep's password.
        <form action={repSignOutAction} className="mt-4 text-[12px]">
          <input type="hidden" name="locale" value={l} />
          <button type="submit" className="btn-small">
            {t.signOut}
          </button>
        </form>
      ) : (
        <p className="mt-4 text-[12px]">
          <Link href={`/${l}/rep`}>← {t.repHome}</Link>
        </p>
      )}
    </main>
  );
}

function PasswordField({
  name,
  label,
  autoComplete,
}: {
  name: string;
  label: string;
  autoComplete: string;
}) {
  return (
    <label className="block text-[12px]">
      <span className="mb-0.5 block font-bold">{label}</span>
      <input
        type="password"
        name={name}
        dir="ltr"
        autoComplete={autoComplete}
        maxLength={REQUEST_LIMITS.passwordChars}
        required
        className="w-full"
      />
    </label>
  );
}
