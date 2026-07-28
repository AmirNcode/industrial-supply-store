"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDict, type Locale } from "@/lib/i18n";

/**
 * Switches a category page between browsing product families and listing the
 * individual SKUs beneath them. Kept in the URL so the choice survives a share
 * or a back button, rather than living in component state.
 */
export function ViewAsToggle({
  locale,
  categoriesHref,
  listHref,
  current,
}: {
  locale: Locale;
  categoriesHref: string;
  listHref: string;
  current: "categories" | "list";
}) {
  const t = getDict(locale);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const options = [
    { key: "categories" as const, label: t.viewAsCategories, href: categoriesHref },
    { key: "list" as const, label: t.viewAsList, href: listHref },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="tap text-[13px] font-bold uppercase tracking-wide text-[var(--color-catalog-green)]"
      >
        {t.viewAs} <span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
      </button>

      {/*
        The panel is anchored to the toggle's end edge and grown leftwards to
        nearly the full viewport. The toggle is a narrow flex item, so
        `inset-x-0` would size the panel to the button and wrap every option
        onto two lines. `end-0` flips correctly under RTL.
      */}
      {open && (
        <div className="absolute end-0 top-full z-40 w-[calc(100vw-1.5rem)] border-b-2 border-[var(--color-accent-bar)] bg-white px-3 shadow-lg lg:w-64 lg:border lg:border-[var(--color-rule)]">
          <ul>
            {options.map((o) => (
              <li key={o.key} className="border-b border-[var(--color-rule-light)] last:border-0">
                <Link
                  href={o.href}
                  prefetch={false}
                  className="tap gap-3 py-3 text-[15px] !text-[var(--color-ink)] hover:no-underline"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
                      current === o.key
                        ? "border-[var(--color-catalog-green)]"
                        : "border-[var(--color-rule)]"
                    }`}
                  >
                    {current === o.key && (
                      <span className="h-[9px] w-[9px] rounded-full bg-[var(--color-catalog-green)]" />
                    )}
                  </span>
                  {o.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
