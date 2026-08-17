import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { loginAction } from "../actions";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

/**
 * The admin password form, on its own route.
 *
 * It lives here rather than inline on /admin so that page has exactly one job.
 * Every admin route redirects here when signed out, and this is the only place
 * that renders the form — there is no second copy to fall out of step.
 *
 * Deliberately `noindex`: a sign-in form for a private area has no reason to
 * appear in search results.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function AdminLoginPage({
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

  // Already signed in: nothing to do here. Without this, a stale bookmark
  // would show a password box to someone who does not need one.
  if (await isAdmin()) redirect(`/${l}/admin`);

  return (
    <main className="mx-auto max-w-[360px] px-3 pt-16">
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[15px] font-bold">
        {t.admin}
      </h1>

      {error && (
        <p className="mb-2 text-[12px] text-[#a3312a]">
          {error === "rate-limit" ? t.rateLimited : t.wrongPassword}
        </p>
      )}

      <form action={loginAction}>
        <input type="hidden" name="locale" value={l} />
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">{t.password}</span>
          <input
            type="password"
            name="password"
            maxLength={REQUEST_LIMITS.passwordChars}
            autoComplete="current-password"
            className="w-full"
            autoFocus
            required
          />
        </label>
        <button type="submit" className="btn-primary mt-3 w-full">
          {t.signIn}
        </button>
      </form>
    </main>
  );
}
