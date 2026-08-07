"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getDict, type Locale } from "@/lib/i18n";
import type { Suggestion } from "@/db/queries";

/**
 * One of only four client islands in the app. Suggestions are fetched from a
 * route handler rather than a server action so the request can be aborted when
 * the buyer keeps typing — abandoned keystrokes should not queue up work.
 */
export function SearchBar({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, {
          signal: ctl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as Suggestion[];
        setItems(data);
        setOpen(true);
        setActive(-1);
      } catch {
        /* aborted or offline — leave the previous list in place */
      }
    }, 130);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function hrefFor(s: Suggestion): string {
    if (s.type === "category") return `/${locale}/c/${s.path}`;
    if (s.type === "family") return `/${locale}/f/${s.slug}`;
    return `/${locale}/f/${s.slug}?pn=${encodeURIComponent(s.partNumber)}`;
  }

  function labelFor(s: Suggestion): string {
    return locale === "fa" ? s.nameFa : s.nameEn;
  }

  function go(s: Suggestion) {
    setOpen(false);
    router.push(hrefFor(s));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      go(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      {/* Sits on the dark masthead, so the field is a light well rather than a
          bordered box — the contrast does the work the border used to. */}
      <form
        action={`/${locale}/search`}
        onSubmit={() => setOpen(false)}
        className="flex items-center rounded-[3px] border border-[var(--color-chrome-line)] bg-white focus-within:border-[var(--color-amber)] focus-within:ring-[3px] focus-within:ring-[rgba(200,134,13,0.25)]"
      >
        <input
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t.searchPlaceholder}
          autoComplete="off"
          aria-label={t.search}
          // `min-w-0` is load-bearing: a flex item defaults to `min-width:
          // auto`, so without it this input refuses to shrink below the
          // intrinsic width of its placeholder and pushes the submit button
          // out past the form's right edge — on a 375px screen that put the
          // magnifier on top of the ORDER link.
          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-1.5 text-[14px] outline-none focus:shadow-none focus:ring-0"
        />
        <button
          type="submit"
          aria-label={t.search}
          className="px-3 py-1 text-[var(--color-ink-muted)] hover:text-[var(--color-pine)]"
        >
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.8" />
            <path d="M13 13l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </form>

      {open && items.length > 0 && (
        <ul className="absolute z-30 inset-x-0 top-full bg-white border border-[var(--color-rule)] shadow-lg max-h-96 overflow-y-auto">
          {items.map((s, i) => (
            <li key={`${s.type}-${i}`}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(s)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-start text-[13px] ${
                  i === active ? "bg-[var(--color-panel)]" : ""
                }`}
              >
                {s.type === "product" ? (
                  <>
                    <span className="tech font-bold text-[var(--color-part-link)]">
                      {s.partNumber}
                    </span>
                    <span className="text-[var(--color-ink-muted)] truncate">
                      {labelFor(s)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="truncate">{labelFor(s)}</span>
                    <span className="ms-auto shrink-0 text-[11px] text-[var(--color-ink-faint)] tech">
                      {s.count}
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
