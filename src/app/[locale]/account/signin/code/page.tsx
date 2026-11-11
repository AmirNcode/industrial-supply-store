import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInCodeStartAction, verifyLoginCodeAction } from "../../actions";
import { currentUser } from "@/lib/session";
import { readSignInLogin } from "@/lib/signInLogin";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const ERROR_KEY = {
  wrong: "signInCodeWrong",
  expired: "signInCodeExpired",
  "rate-limit": "rateLimited",
} as const;

/** Step two for an account that signs in by emailed code. */
export default async function SignInCodePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { error, sent } = await searchParams;

  const user = await currentUser();
  if (user) redirect(user.needsPassword ? `/${l}/account/password/new` : `/${l}/account`);

  const identifier = await readSignInLogin();
  if (!identifier) redirect(`/${l}/account/signin`);

  const errorKey = error && error in ERROR_KEY ? ERROR_KEY[error as keyof typeof ERROR_KEY] : null;

  return (
    <main className="mx-auto max-w-[380px] px-3 pt-8">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.signInCodeTitle}
      </h1>
      <p className="mb-2 text-[12px] text-[var(--color-ink-muted)]">{t.signInCodePrompt}</p>
      <p className="mb-4 text-[12px]">
        <span className="tech font-bold" dir="ltr">
          {identifier}
        </span>{" "}
        <Link href={`/${l}/account/signin`}>{t.signInChangeLogin}</Link>
      </p>

      {errorKey && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
          {t[errorKey]}
        </p>
      )}
      {!errorKey && sent === "1" && (
        <p className="mb-3 border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-[12px] text-[var(--color-ok)]">
          {t.signInCodeSent}
        </p>
      )}

      <form action={verifyLoginCodeAction} className="grid gap-3">
        <input type="hidden" name="locale" value={l} />
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">{t.signInCodeLabel}</span>
          <input
            type="text"
            name="code"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={12}
            required
            autoFocus
            className="tech w-full"
          />
        </label>
        <button type="submit" className="btn-primary mt-1 w-full">
          {t.signInContinue}
        </button>
      </form>

      <form action={signInCodeStartAction} className="mt-3 text-[12px]">
        <input type="hidden" name="locale" value={l} />
        <button type="submit" className="underline">
          {t.signInCodeResend}
        </button>
      </form>
    </main>
  );
}
