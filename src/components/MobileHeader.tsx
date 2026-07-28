"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDict, type Locale } from "@/lib/i18n";
import { SearchBar } from "./SearchBar";
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

  // Lock body scroll behind the drawer.
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
    { href: `/${locale}/admin`, label: t.admin },
  ];

  return (
    <div className="lg:hidden">
      {isHome && (
        <div className="px-3 pt-2 pb-1 text-center">
          <Link href={`/${locale}`} className="hover:no-underline">
            <span
              className="inline-block font-bold text-[var(--color-catalog-green-dark)] leading-none"
              style={{
                fontSize: locale === "fa" ? 26 : 30,
                letterSpacing: locale === "fa" ? 0 : "-0.02em",
                fontFamily:
                  locale === "fa" ? undefined : "Georgia, 'Times New Roman', serif",
              }}
            >
              {t.brand}
              <sup className="text-[11px] align-super">®</sup>
            </span>
          </Link>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        {!isHome && (
          <Link
            href={`/${locale}`}
            aria-label={t.home}
            className="flex h-9 w-9 shrink-0 items-center justify-center bg-[var(--color-accent-bar)] font-bold text-[var(--color-catalog-green-dark)] hover:no-underline"
            style={{ fontFamily: "Georgia, serif", fontSize: 22 }}
          >
            P
          </Link>
        )}

        <div className="min-w-0 flex-1">
          <SearchBar locale={locale} />
        </div>

        <Link
          href={`/${locale}/cart`}
          className="tap shrink-0 px-1 text-[13px] font-bold uppercase text-[var(--color-catalog-green)]"
        >
          {t.order}
          <CartBadge locale={locale} />
        </Link>

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label={t.browseCatalog}
          className="tap shrink-0 px-1 text-[22px] leading-none text-[var(--color-catalog-green)]"
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {menuOpen && (
        <nav className="border-t-2 border-[var(--color-accent-bar)] bg-white">
          <ul>
            {menuLinks.map((l) => (
              <li key={l.href} className="border-b border-[var(--color-rule-light)]">
                <Link
                  href={l.href}
                  className="tap px-4 py-3 text-[17px] font-bold text-[var(--color-catalog-green)]"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="border-b border-[var(--color-rule-light)]">
              <Link
                href={`/${other}`}
                lang={other}
                className="tap px-4 py-3 text-[17px] font-bold text-[var(--color-catalog-green)]"
              >
                {other === "fa" ? "فارسی" : "English"}
              </Link>
            </li>
          </ul>
          <div className="px-4 py-3 text-[13px] text-[var(--color-ink-muted)]">
            <div className="mb-1 font-bold text-[var(--color-ink)]">{t.emailUs}</div>
            <a href="mailto:sales@parstech.example" className="tech block">
              sales@parstech.example
            </a>
            <a href="tel:+982188880000" className="tech block">
              +98 21 8888 0000
            </a>
          </div>
        </nav>
      )}
    </div>
  );
}
