import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { DEMO_MODE } from "@/lib/demo";
import { logoutAction } from "../actions";
import { AdminTabs } from "./AdminTabs";
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
    <div className="mx-auto max-w-[1240px] px-3 pt-3 pb-16">
      {/*
        Tabs across the top rather than a rail down the side.
        The panel's tables are the widest thing in the app, and a 160px column
        of three links was charging them for it on every page.
      */}
      <nav className="admin-tabs">
        <span className="admin-tabs-brand">{t.admin}</span>
        <AdminTabs sections={sections} />

        {!DEMO_MODE && (
          <form action={logoutAction} className="ms-auto">
            <input type="hidden" name="locale" value={l} />
            <button type="submit" className="text-[11px] underline">
              {t.signOut}
            </button>
          </form>
        )}
      </nav>

      <div className="min-w-0 pt-3">
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
