import { notFound, redirect } from "next/navigation";
import { repSignInAction } from "../actions";
import { currentRep } from "@/lib/repSession";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

/**
 * The reps' door. Not linked from the public site: the admin hands each rep
 * this address with their username, the way staff are given /admin.
 */
export default async function RepSignInPage({
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

  if (await currentRep()) redirect(`/${l}/rep`);

  return (
    <main className="mx-auto max-w-[380px] px-3 pt-8">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.repSignInTitle}
      </h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{t.repSignInPrompt}</p>

      {(error === "failed" || error === "rate-limit") && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
          {error === "rate-limit" ? t.rateLimited : t.repSignInFailed}
        </p>
      )}

      <form action={repSignInAction} className="grid gap-3">
        <input type="hidden" name="locale" value={l} />
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">{t.username}</span>
          <input
            type="text"
            name="username"
            dir="ltr"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={64}
            required
            autoFocus
            className="w-full"
          />
        </label>
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">{t.password}</span>
          <input
            type="password"
            name="password"
            dir="ltr"
            autoComplete="current-password"
            maxLength={REQUEST_LIMITS.passwordChars}
            required
            className="w-full"
          />
        </label>
        <button type="submit" className="btn-primary mt-1 w-full">
          {t.signInTitle}
        </button>
      </form>
    </main>
  );
}
