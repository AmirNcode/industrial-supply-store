import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/repSession";
import { repSignOutAction } from "../actions";
import { PanelTabs } from "@/components/PanelTabs";
import { isLocale, getDict, type Locale } from "@/lib/i18n";

/**
 * The rep portal's shell and its gate: a current session, past any forced
 * password change. Same shape as the admin panel, because reps and the admin
 * look at the same kinds of lists and it keeps one set of styles.
 */
export default async function RepPortalLayout({
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
  const rep = await requireRep(l);

  const sections = [
    { href: `/${l}/rep`, label: t.repHome, exact: true },
    { href: `/${l}/rep/customers`, label: t.customers },
    { href: `/${l}/rep/orders`, label: t.ordersTab },
    { href: `/${l}/rep/commission`, label: t.commission },
  ];

  return (
    <div className="mx-auto max-w-[1240px] px-3 pt-3 pb-16">
      <nav className="admin-tabs">
        <span className="admin-tabs-brand">{t.repPortal}</span>
        <PanelTabs sections={sections} />
        <div className="admin-tabs-aside ms-auto flex flex-wrap items-baseline gap-3 text-[11px]">
          <span className="text-[var(--color-ink-muted)]">{rep.name}</span>
          <Link href={`/${l}/rep/password`}>{t.changePassword}</Link>
          <form action={repSignOutAction}>
            <input type="hidden" name="locale" value={l} />
            <button type="submit" className="underline">
              {t.signOut}
            </button>
          </form>
        </div>
      </nav>
      <main className="min-w-0 pt-3">{children}</main>
    </div>
  );
}
