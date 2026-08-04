import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInAction } from "../actions";
import { currentUser } from "@/lib/session";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

export default async function SignInPage({
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

  return (
    <main className="mx-auto max-w-[380px] px-3 pt-8">
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.signInTitle}
      </h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{t.signInPrompt}</p>

      {error === "failed" && (
        <p className="mb-3 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)]">
          {t.signInFailed}
        </p>
      )}

      <form action={signInAction} className="grid gap-3">
        <input type="hidden" name="locale" value={l} />
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">{t.email}</span>
          <input type="email" name="email" dir="ltr" required autoFocus className="w-full" />
        </label>
        <label className="block text-[12px]">
          <span className="mb-0.5 block font-bold">{t.password}</span>
          <input type="password" name="password" dir="ltr" required className="w-full" />
        </label>
        <button type="submit" className="btn-primary mt-1 w-full">
          {t.signInTitle}
        </button>
      </form>

      <p className="mt-4 text-[12px] text-[var(--color-ink-muted)]">
        {t.needAccount}{" "}
        <Link href={`/${l}/account/signup`}>{t.signUp}</Link>
      </p>
    </main>
  );
}
