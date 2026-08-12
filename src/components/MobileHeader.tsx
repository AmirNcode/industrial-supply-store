"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDict, type Locale } from "@/lib/i18n";
import { SearchBar } from "./SearchBar";
import { LocaleSwitch } from "./LocaleSwitch";
import { CartBadge } from "./CartBadge";
import type { SiteContact } from "@/lib/siteContactValues";

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
 * With the wordmark present everywhere, the Catalog button below it was a
 * second control pointing at the same route, and dropping it hands roughly
 * 70px back to the search field — which is the control that actually needed
 * the width at 375px.
 *
 * Still a client component: the drawer needs state, and closing it on
 * navigation needs the current route.
 */
export function MobileHeader({
  locale,
  contact,
}: {
  locale: Locale;
  contact: SiteContact;
}) {
  const t = getDict(locale);
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const other: Locale = locale === "fa" ? "en" : "fa";

  // Close the drawer on navigation — otherwise tapping a link leaves it open
  // over the page the user just asked for.
  useEffect(() => setMenuOpen(false), [pathname]);

  /*
   * Flags the masthead while the drawer is open, which does two jobs.
   *
   * `MastheadReveal` reads it and stops tucking the bar away — otherwise a
   * stray wheel notch would slide the open drawer off the top of the screen.
   * It also guarantees the header keeps `transform: none`, and a transformed
   * ancestor would become the containing block for the fixed backdrop below,
   * which would then cover the header instead of the page.
   *
   * This replaced an `overflow: hidden` scroll lock on `<body>`. That lock made
   * the body a scroll container, which destroys `position: sticky` on the
   * header: the bar dropped back to its static position at the top of the
   * document, out of sight whenever the drawer was opened part-way down a page.
   * The backdrop's `touch-action` holds the page still instead.
   */
  useEffect(() => {
    const header = rootRef.current?.closest("header");
    if (!header) return;
    if (!menuOpen) {
      header.removeAttribute("data-menu-open");
      return;
    }
    header.setAttribute("data-menu-open", "true");
    return () => header.removeAttribute("data-menu-open");
  }, [menuOpen]);

  // Escape is the keyboard equivalent of tapping the backdrop.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
    <div ref={rootRef} className="lg:hidden">
      {/*
        Dismisses the drawer on a tap anywhere off it, and holds the page still
        while it is open.

        `touch-action: none` is the whole scroll lock: it stops a gesture that
        starts on the backdrop from scrolling the page, without making `<body>`
        a scroll container the way `overflow: hidden` did — which is what broke
        the sticky header. Sits at the default z-index so the bar and drawer,
        both lifted to z-10 below, stay above it and stay tappable.

        Presentational: a keyboard user gets Escape rather than a focusable
        blank rectangle in the tab order.
      */}
      {menuOpen && (
        <div
          aria-hidden="true"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 touch-none bg-[rgba(11,34,73,0.5)]"
        />
      )}

      {/* The wordmark shares the top line with the tagline here, unlike the
          desktop masthead where it sits beside the search. At phone width it
          was the widest fixed item in the control row, and the search — already
          down to 134px — is what needed that space back. */}
      <div className="relative z-10 bg-[var(--color-navy)] px-3 pt-2 pb-1">
        <Link href={`/${locale}`} className="flex items-center gap-2 hover:no-underline">
          {/* alt carries the brand name, and the attributes carry the display
              size rather than the file's 1908×543 — see the note in Header.tsx
              for why that matters on a phone. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/temex-logo-cropped.jpg"
            alt={t.brand}
            width={77}
            height={22}
            className="block h-[22px] w-auto shrink-0"
          />
          <span className="min-w-0 text-[10px] leading-tight text-[var(--color-chrome-ink)]">
            {t.tagline}
          </span>
        </Link>
      </div>

      {/*
        Both controls carry an explicit height rather than leaning on `.tap`.
        `.tap` only exists under `(pointer: coarse)`, so on a laptop narrowed to
        phone width it never applies — which left the order link sitting at its
        text height and the burger at its own, misaligned by whatever the glyph
        metrics happened to give. 35px matches the search field, so all three
        items in the row share one height and one centre line in either pointer
        mode; `.tap` still raises both to 44px on real touch hardware.
      */}
      <div className="relative z-10 flex items-center gap-2 bg-[var(--color-navy)] px-3 pb-2">
        <div className="min-w-0 flex-1">
          <SearchBar locale={locale} />
        </div>

        <Link
          href={`/${locale}/cart`}
          className="tap flex h-[35px] shrink-0 items-center px-1 text-[12px] font-semibold uppercase tracking-[0.06em] !text-white"
        >
          {t.order}
          <CartBadge locale={locale} />
        </Link>

        {/* Drawn rather than typed. `☰` and `✕` sit wherever the font puts them
            inside the line box, which is what made the burger look low against
            the order link; a path is positioned by geometry instead. */}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label={t.browseCatalog}
          className="tap flex h-[35px] w-[35px] shrink-0 items-center justify-center text-white"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {menuOpen ? (
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M3.5 7h17M3.5 12h17M3.5 17h17"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </div>

      {/* A step darker than the masthead rather than lighter. The bar is navy
          now, so the drawer has to separate from it downward — at the same
          value the two would read as one block and the menu would look like
          part of the header rather than a layer over the catalog. */}
      {menuOpen && (
        <nav className="relative z-10 bg-[var(--color-navy-deep)]">
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
              {/* Muted rather than accented: this is chrome, not a fourth
                  destination, and gold now means money. */}
              <LocaleSwitch
                other={other}
                className="tap block px-4 py-3 text-[16px] font-semibold !text-[var(--color-chrome-muted)]"
              />
            </li>
          </ul>
          <div className="px-4 py-3 text-[12px] text-[var(--color-chrome-muted)]">
            <a
              href={`mailto:${contact.email}`}
              className="tech mb-1 block !text-[var(--color-chrome-ink)]"
            >
              {contact.email}
            </a>
            <a
              href={contact.phoneHref}
              className="tech block !text-[var(--color-chrome-muted)]"
            >
              {contact.phone}
            </a>
          </div>
        </nav>
      )}
    </div>
  );
}
