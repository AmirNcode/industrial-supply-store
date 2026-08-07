"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDict, type Locale } from "@/lib/i18n";
import { SearchBar } from "./SearchBar";
import { LocaleSwitch } from "./LocaleSwitch";
import { CartBadge } from "./CartBadge";

/**
 * The phone masthead.
 *
 * The reference site shows the full wordmark only on the home screen and swaps
 * to a small square tile everywhere else, which buys back a whole row of
 * vertical space on the pages where content matters most. Reproducing that
 * needs the current route, hence the client component.
 */
export function MobileHeader({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const isHome = pathname === `/${locale}` || pathname === `/${locale}/`;
  const other: Locale = locale === "fa" ? "en" : "fa";

  // Close the drawer on navigation — otherwise tapping a link leaves it open
  // over the page the user just asked for.
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const menuLinks = [
    { href: `/${locale}/cart`, label: t.yourOrder },
    { href: `/${locale}/quick-order`, label: t.quickOrder },
    { href: `/${locale}`, label: t.allCategories },
    // Account, not Admin. This menu is what a customer on a phone sees, and
    // /admin is staff-only — it stays reachable from the footer.
    { href: `/${locale}/account`, label: t.account },
  ];

  return (
    <div className="lg:hidden">
      {isHome && (
        <div className="px-3 pt-3 pb-1 text-center">
          <Link href={`/${locale}`} className="hover:no-underline">
            <span
              className="block whitespace-nowrap font-bold leading-none text-white"
              style={{
                fontSize: locale === "fa" ? 23 : 25,
                letterSpacing: locale === "fa" ? 0 : "0.03em",
              }}
            >
              {t.brand}
              <sup className="ms-0.5 align-super text-[9px] text-[var(--color-chrome-muted)]">
                ®
              </sup>
            </span>
            <span className="mt-1.5 block text-[9px] uppercase tracking-[0.22em] text-[var(--color-chrome-muted)]">
              {t.tagline}
            </span>
          </Link>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        {!isHome && (
          <Link
            href={`/${locale}`}
            aria-label={t.home}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] bg-[var(--color-amber)] text-[19px] font-bold leading-none text-[var(--color-chrome)] hover:no-underline"
          >
            P
          </Link>
        )}

        <div className="min-w-0 flex-1">
          <SearchBar locale={locale} />
        </div>

        <Link
          href={`/${locale}/cart`}
          className="tap shrink-0 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] !text-[var(--color-amber-lift)]"
        >
          {t.order}
          <CartBadge locale={locale} />
        </Link>

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label={t.browseCatalog}
          className="tap shrink-0 px-1 text-[21px] leading-none text-[var(--color-chrome-ink)]"
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {menuOpen && (
        <nav className="bg-[var(--color-chrome-2)]">
          <ul>
            {menuLinks.map((l) => (
              <li
                key={l.href}
                className="border-b border-[var(--color-chrome-line)]"
              >
                <Link
                  href={l.href}
                  className="tap px-4 py-3 text-[16px] font-semibold !text-[var(--color-chrome-ink)]"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="border-b border-[var(--color-chrome-line)]">
              <LocaleSwitch
                other={other}
                className="tap block px-4 py-3 text-[16px] font-semibold !text-[var(--color-amber-lift)]"
              />
            </li>
          </ul>
          <div className="px-4 py-3 text-[12px] text-[var(--color-chrome-muted)]">
            <div className="mb-1 font-semibold text-[var(--color-chrome-ink)]">
              {t.emailUs}
            </div>
            <a
              href="mailto:sales@parstech.example"
              className="tech block !text-[var(--color-chrome-muted)]"
            >
              sales@parstech.example
            </a>
            <a
              href="tel:+982188880000"
              className="tech block !text-[var(--color-chrome-muted)]"
            >
              +98 21 8888 0000
            </a>
          </div>
        </nav>
      )}
    </div>
  );
}
