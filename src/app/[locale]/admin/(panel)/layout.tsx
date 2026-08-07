import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { DEMO_MODE } from "@/lib/demo";
import { logoutAction } from "../actions";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

/**
 * The admin shell: side navigation, and the one place the sign-in gate lives.
 *
 * It is a route group — `(panel)` does not appear in any URL — so /admin/login
 * sits outside it. A gate in a layout that also wrapped the login page would
 * redirect the login page to itself.
 *
 * The nav sits at the inline start, so it is on the left in English and on the
 * right in Persian without a second rule: `flex-row` plus the document's `dir`
 * already means that, and hard-coding `left` would put it on the wrong side of
 * the Persian admin.
 */
export default async function AdminPanelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  // In demo mode the inbox is deliberately open so it can be shown without
  // handing out a credential.
  const authorised = DEMO_MODE || (await isAdmin());
  if (!authorised) redirect(`/${l}/admin/login`);

  const sections = [
    { href: `/${l}/admin/orders`, label: t.quoteRequests },
    { href: `/${l}/admin/products`, label: t.products },
    { href: `/${l}/admin/settings`, label: t.settings },
  ];

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-3 pt-3 pb-16 sm:flex-row">
      <nav className="shrink-0 sm:w-[160px]">
        <div className="mb-2 border-b border-[var(--color-ink)] pb-1 text-[13px] font-bold">
          {t.admin}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] sm:block sm:space-y-1">
          {sections.map((s) => (
            <li key={s.href}>
              <Link href={s.href}>{s.label}</Link>
            </li>
          ))}
        </ul>

        {!DEMO_MODE && (
          <form action={logoutAction} className="mt-4">
            <input type="hidden" name="locale" value={l} />
            <button type="submit" className="text-[11px] underline">
              {t.signOut}
            </button>
          </form>
        )}
      </nav>

      <div className="min-w-0 flex-1">
        {DEMO_MODE && (
          <p className="mb-3 border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px] text-[var(--color-warn)]">
            {t.demoAdminPublic}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
