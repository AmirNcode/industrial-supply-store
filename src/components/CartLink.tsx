import Link from "next/link";
import { getDict, type Locale } from "@/lib/i18n";
import { CartBadge } from "./CartBadge";

/**
 * Deliberately does NOT read the cart cookie.
 *
 * Reading it here would make every page that renders the header dynamic —
 * including the category tree, which is identical for every visitor and should
 * be cached. The badge fetches its own count on the client instead, so the
 * catalog stays statically rendered and the count still tells the truth a beat
 * after paint.
 */
export function CartLink({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  return (
    <Link
      href={`/${locale}/cart`}
      className="text-[13px] font-bold uppercase text-[var(--color-catalog-green)] tracking-wide"
    >
      {t.order}
      <CartBadge locale={locale} />
    </Link>
  );
}
