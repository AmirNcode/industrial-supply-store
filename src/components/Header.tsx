import Link from "next/link";
import { getDict, type Locale } from "@/lib/i18n";
import { SearchBar } from "./SearchBar";
import { LocaleSwitch } from "./LocaleSwitch";
import { CartLink } from "./CartLink";
import { MobileHeader } from "./MobileHeader";
import { MastheadReveal } from "./MastheadReveal";

/**
 * Two distinct mastheads rather than one that reflows.
 *
 * The desktop masthead is a thin tagline strip over a single control row —
 * wordmark, search, then the contact line and the order and account links.
 * Squeezing that into 375px is what made the first mobile pass unusable — at
 * phone width the nav has to collapse behind a drawer, which is a different
 * structure, not a narrower version of the same one.
 *
 * Navy, so the bar is a band of brand colour rather than a white strip that
 * dissolves into the page. Everything on it is white or near-white; the one
 * exception is the gold cart count, which stays gold because gold means money.
 *
 * The wordmark sits beside the search rather than on its own line above it.
 * That is what took a row out of the masthead — the branding line was costing
 * ~30px of every screen to say something the logo already says in place.
 */
export function Header({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const other: Locale = locale === "fa" ? "en" : "fa";

  return (
    <header>
      {/* Renders nothing. Watches the scroll and flags this header so the CSS
          can reveal it on phones — see MastheadReveal for why it sits inside
          rather than wrapping. */}
      <MastheadReveal />

      <div className="bg-[var(--color-navy)]">
        <MobileHeader locale={locale} />

        {/* The tagline keeps the top line but gives up the wordmark that used to
            sit beside it, so this is now a thin strip rather than a branding
            band. Small enough to read as a descriptor under the masthead rather
            than a second headline competing with the logo below it. */}
        <div className="hidden px-4 pt-1.5 lg:block">
          <span className="text-[10px] tracking-[0.03em] text-[var(--color-chrome-ink)]">
            {t.tagline}
          </span>
        </div>

        <div className="hidden items-center gap-4 px-4 pt-1 pb-2 lg:flex">
          {/* Set to the search field's own 35px so the two read as one control
              strip. `alt` carries the brand name — with the wordmark being an
              image, this is the only place "TEMEX" exists on the page, and an
              empty alt would erase it for screen readers. */}
          <Link href={`/${locale}`} className="shrink-0 hover:no-underline">
            {/* Attributes carry the *display* size, not the file's 1908×543.
                Same 3.5 ratio either way, so this still reserves the right box
                and prevents layout shift — but if the stylesheet ever fails to
                arrive, the fallback is a 123px logo instead of a 1908px one
                that widens the document and makes phones shrink-to-fit the
                entire page. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/temex-logo-cropped.jpg"
              alt={t.brand}
              width={123}
              height={35}
              className="block h-[35px] w-auto"
            />
          </Link>

          {/* Capped rather than filling the bar: a search field the width of a
              desktop window is harder to aim at, not easier. */}
          <div className="min-w-0 max-w-[560px] flex-1">
            <SearchBar locale={locale} />
          </div>

          <div className="ms-auto shrink-0 text-end">
            <div className="flex items-center justify-end gap-3 text-[12.5px] text-[var(--color-chrome-ink)]">
              <span className="tech">+98 21 8888 0000</span>
              <span className="text-[var(--color-navy-lift)]">|</span>
              <a href="mailto:sales@temex.example" className="!text-white">
                {t.emailUs}
              </a>
              <span className="text-[var(--color-navy-lift)]">|</span>
              <LocaleSwitch other={other} className="font-bold !text-white" />
            </div>
            {/* Both rows carry a size bump over the old masthead, which is what
                closes the gap that used to sit above them: the block is now
                tall enough to fill the row beside the search rather than
                floating in the middle of it. */}
            <div className="mt-1 flex items-center justify-end gap-4">
              <CartLink locale={locale} />
              <Link
                href={`/${locale}/quick-order`}
                className="text-[14px] font-semibold uppercase tracking-[0.08em] !text-white"
              >
                {t.quickOrder}
              </Link>
              {/* Unconditional: reading the session here would make every
                  cached catalog page dynamic. /account decides for itself
                  whether to show orders or a sign-in prompt. */}
              <Link
                href={`/${locale}/account`}
                className="text-[14px] font-semibold uppercase tracking-[0.08em] !text-white"
              >
                {t.account}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Lighter than the bar above it, because the navy block already draws its
          own edge against the page — this is the highlight along that edge, not
          the edge itself. Kept as a gradient, as the gold rule it descends from
          was, so it reads as deliberate rather than as a slab of colour. */}
      <div
        className="h-[3px]"
        style={{
          background:
            "linear-gradient(90deg, var(--color-navy-lift) 0%, var(--color-navy-tint) 38%, var(--color-rule) 100%)",
        }}
      />
    </header>
  );
}
