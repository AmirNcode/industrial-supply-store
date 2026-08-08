import Link from "next/link";
import { getDict, type Locale } from "@/lib/i18n";

export function Footer({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const links = [
    { href: `/${locale}`, label: t.home },
    { href: `/${locale}/quick-order`, label: t.quickOrder },
    { href: `/${locale}/cart`, label: t.cart },
    { href: `/${locale}/track`, label: t.trackOrder },
    { href: `/${locale}/admin`, label: t.admin },
  ];
  return (
    <footer className="mt-8 border-t border-[var(--color-rule)] bg-white">
      {/* The promise the brand is built on — fast delivery and a money-back
          guarantee — stated once, where it is on every page without competing
          with the catalog for attention. */}
      <div className="border-b border-[var(--color-rule-light)] px-3 py-2 text-[12px] font-semibold text-[var(--color-navy)]">
        {t.brandPromise}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px] text-[var(--color-ink-muted)]">
        {links.map((l, i) => (
          <span key={l.href} className="flex items-center gap-3">
            {i > 0 && <span className="text-[var(--color-rule)]">|</span>}
            <Link href={l.href}>{l.label}</Link>
          </span>
        ))}
        <span className="ms-auto">{t.footerNote}</span>
      </div>
      {/* v1 runs on generated data; saying so in the chrome avoids anyone
          mistaking a demo catalog for a real parts reference. */}
      <div className="border-t border-[var(--color-rule-light)] bg-[var(--color-panel-alt)] px-3 py-1.5 text-[10px] text-[var(--color-ink-faint)]">
        {t.seedNotice}
      </div>
    </footer>
  );
}
