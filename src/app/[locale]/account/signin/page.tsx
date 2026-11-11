import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInAction, signInCodeStartAction, signInStartAction } from "../actions";
import { currentUser } from "@/lib/session";
import { readSignInLogin } from "@/lib/signInLogin";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

/**
 * Sign-in is two steps on one route: who you are, then how you prove it. The
 * second step is chosen by the server action (a password for most, an emailed
 * code for an account that never set one), so this page only draws whichever
 * step the URL names.
 */
export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; step?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { error, step } = await searchParams;

  // currentUser, not currentUserId: a validly signed cookie whose row has
  // gone (a reseed, a deletion) would otherwise bounce the visitor here from
  // /account and straight back again, with no way to sign in, up, or out.
  if (await currentUser()) redirect(`/${l}/account`);

  // No identifier remembered (cookie expired, or a bookmarked step-two URL)
  // means there is nobody to ask a password for: fall back to step one.
  const identifier = step === "password" ? await readSignInLogin() : null;

  return (
    <main className="mx-auto max-w-[380px] px-3 pt-8">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.signInTitle}
      </h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{t.signInPrompt}</p>

      {(error === "failed" || error === "rate-limit") && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
          {error === "rate-limit" ? t.rateLimited : t.signInFailed}
        </p>
      )}

      {identifier ? (
        <>
          <p className="mb-3 text-[12px]">
            <span className="tech font-bold" dir="ltr">
              {identifier}
            </span>{" "}
            <Link href={`/${l}/account/signin`}>{t.signInChangeLogin}</Link>
          </p>

          <form action={signInAction} className="grid gap-3">
            <input type="hidden" name="locale" value={l} />
            {/* Server-rendered and never edited, so it is not client state; it
                is here so a password manager pairs the password with the
                account it belongs to. */}
            <input type="hidden" name="login" value={identifier} autoComplete="username" />
            <label className="block text-[12px]">
              <span className="mb-0.5 block font-bold">{t.password}</span>
              <input
                type="password"
                name="password"
                dir="ltr"
                autoComplete="current-password"
                maxLength={REQUEST_LIMITS.passwordChars}
                required
                autoFocus
                className="w-full"
              />
            </label>
            <button type="submit" className="btn-primary mt-1 w-full">
              {t.signInTitle}
            </button>
          </form>

          <form action={signInCodeStartAction} className="mt-3 text-[12px]">
            <input type="hidden" name="locale" value={l} />
            <button type="submit" className="underline">
              {t.signInForgot} {t.signInUseCode}
            </button>
          </form>
        </>
      ) : (
        <form action={signInStartAction} className="grid gap-3">
          <input type="hidden" name="locale" value={l} />
          <label className="block text-[12px]">
            <span className="mb-0.5 block font-bold">{t.loginEmailOrId}</span>
            <input
              type="text"
              name="login"
              dir="ltr"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={REQUEST_LIMITS.emailChars}
              required
              autoFocus
              className="w-full"
            />
          </label>
          <button type="submit" className="btn-primary mt-1 w-full">
            {t.signInContinue}
          </button>
        </form>
      )}

      <p className="mt-4 text-[12px] text-[var(--color-ink-muted)]">
        {t.needAccount}{" "}
        {/* Underlined: inside a sentence, colour alone does not mark a link
            (WCAG 1.4.1). Forced with `!`: the base `a` rule in globals.css is
            unlayered and beats a plain utility. */}
        <Link href={`/${l}/account/signup`} className="!underline">{t.signUp}</Link>
      </p>
    </main>
  );
}
