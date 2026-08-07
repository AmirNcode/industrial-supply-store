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
 * The wordmark stays on every screen. It used to appear only on the home page,
 * with a small amber tile carrying the brand's initial standing in for it
 * elsewhere — which saved a row of vertical space and cost people the obvious
 * way back to the catalog, because a monogram only reads as "home" to someone
 * who already knows it is the logo. Setting the mark and its tagline on one
 * line buys most of that space back without hiding anything.
 *
 * Still a client component: the drawer needs state, and closing it on
 * navigation needs the current route.
 */
export function MobileHeader({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

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

  // No "Your Order" here: the ORDER control sits in the bar above with its own
  // count badge, and two routes to the same page in one header is noise.
  const menuLinks = [
    { href: `/${locale}/quick-order`, label: t.quickOrder },
    { href: `/${locale}`, label: t.allCategories },
    // Account, not Admin. This menu is what a customer on a phone sees, and
    // /admin is staff-only — it stays reachable from the footer.
    { href: `/${locale}/account`, label: t.account },
  ];

  return (
    <div className="lg:hidden">
      {/* On every page, not just the home page. The masthead disappearing
          elsewhere was what left people without an obvious way back, and a
          single line costs little enough vertical space to keep everywhere. */}
      <div className="px-3 pt-2 pb-1">
        <Link href={`/${locale}`} className="hover:no-underline">
          <span className="flex flex-wrap items-baseline gap-x-2 leading-none">
            <span className="font-bold tracking-[0.04em] text-white text-[15px]">
              {t.brand}
              <sup className="ms-0.5 align-super text-[8px] text-[var(--color-chrome-muted)]">
                ®
              </sup>
            </span>
            {/* Same size as the mark, separated by colour alone. */}
            <span className="text-[15px] text-[var(--color-chrome-muted)]">
              {t.tagline}
            </span>
          </span>
        </Link>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2">
        {/* A word, not a monogram. The amber square with a letter in it did
            not read as "go back to the catalog" to anyone who had not already
            worked out that it was the logo. */}
        <Link
          href={`/${locale}`}
          className="tap shrink-0 rounded-[3px] bg-[var(--color-amber)] px-2.5 py-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] !text-[var(--color-chrome)] hover:no-underline"
        >
          {t.catalogButton}
        </Link>

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
              href="mailto:sales@temex.example"
              className="tech block !text-[var(--color-chrome-muted)]"
            >
              sales@temex.example
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
