"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The panel's tab strip.
 *
 * A client component only because a layout is not told the current path, and
 * knowing which tab is current is the whole point — the selected tab drops its
 * bottom border so it runs into the page beneath it.
 *
 * Matched by prefix, so `/admin/products/60/columns` still lights Products.
 */
export function AdminTabs({
  sections,
}: {
  sections: { href: string; label: string }[];
}) {
  const pathname = usePathname();

  return (
    <ul className="admin-tabs-list">
      {sections.map((s) => {
        const current = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <li key={s.href}>
            {/* `aria-current` carries the same fact to a screen reader, and the
                CSS keys off it rather than off a class of its own. */}
            <Link
              href={s.href}
              aria-current={current ? "page" : undefined}
              className="admin-tab"
            >
              {s.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
