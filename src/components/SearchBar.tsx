"use client";

import { Suspense, useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDict, type Locale } from "@/lib/i18n";
import type { Suggestion } from "@/db/queries";
import { REQUEST_LIMITS } from "@/lib/requestLimits";

/* Shared so the boundary's fallback is the same field, pixel for pixel, as the
   one that hydrates over it. */
const FORM_CLASS =
  "flex items-center rounded-[3px] border border-[var(--color-navy-deep)] bg-white focus-within:border-white focus-within:ring-[3px] focus-within:ring-[rgba(255,255,255,0.35)]";
const INPUT_CLASS =
  "min-w-0 flex-1 border-0 bg-transparent px-3 py-1.5 text-[14px] outline-none focus:shadow-none focus:ring-0";
const SUBMIT_CLASS =
  "px-3 py-1 text-[var(--color-ink-muted)] hover:text-[var(--color-navy)]";

function Magnifier() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M13 13l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * `useSearchParams` opts its subtree out of static rendering, and this field is
 * in the masthead — which is to say on every page — so without a boundary here
 * `next build` fails on every route it tries to prerender.
 *
 * The fallback is not a spinner: it is the same form, posting to the same
 * route. Before hydration the search still works as a plain GET, and the markup
 * React swaps in is identical, so nothing moves when it arrives.
 */
export function SearchBar({ locale }: { locale: Locale }) {
  return (
    <Suspense fallback={<SearchField locale={locale} />}>
      <LiveSearchBar locale={locale} />
    </Suspense>
  );
}

function SearchField({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  return (
    <div className="relative">
      <form action={`/${locale}/search`} className={FORM_CLASS}>
        <input
          type="search"
          name="q"
          placeholder={t.searchPlaceholder}
          aria-label={t.search}
          autoComplete="off"
          maxLength={REQUEST_LIMITS.searchChars}
          className={INPUT_CLASS}
        />
        <button type="submit" aria-label={t.search} className={SUBMIT_CLASS}>
          <Magnifier />
        </button>
      </form>
    </div>
  );
}

/**
 * One of only four client islands in the app. Suggestions are fetched from a
 * route handler rather than a server action so the request can be aborted when
 * the buyer keeps typing — abandoned keystrokes should not queue up work.
 */
function LiveSearchBar({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const router = useRouter();
  const searchParams = useSearchParams();
  const submittedQuery = searchParams.get("q") ?? "";
  const [draft, setDraft] = useState(() => ({ source: submittedQuery, value: submittedQuery }));
  const q = draft.source === submittedQuery ? draft.value : submittedQuery;
  const [suggestions, setSuggestions] = useState<{ query: string; items: Suggestion[] }>({
    query: "",
    items: [],
  });
  const items =
    q.trim().length >= 2 && suggestions.query === q ? suggestions.items : [];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = useId();

  // The persistent header can outlive a navigation. Keying the draft to the
  // submitted URL derives the reset during render, without a second render from
  // a synchronous state-setting effect.
  function setQ(value: string) {
    setDraft({ source: submittedQuery, value });
  }

  useEffect(() => {
    // Cleanup runs as soon as the query changes, not after the next debounce.
    // That prevents a slow response for the old value from reopening the list
    // while the buyer is already typing a new one.
    abortRef.current?.abort();
    if (q.trim().length < 2) {
      return;
    }
    const timer = setTimeout(async () => {
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, {
          signal: ctl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as Suggestion[];
        setSuggestions({ query: q, items: data });
        // A submitted query initializes `q` on the results page, which also
        // triggers this fetch. Keep the suggestions warm, but do not cover the
        // results unless the buyer is actively editing the field.
        setOpen(document.activeElement === inputRef.current);
        setActive(-1);
      } catch {
        /* aborted or offline — leave the previous list in place */
      }
    }, 130);
    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
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
      {/* A light well on the navy bar: the contrast draws the edge, so the
          border only has to stop the white from bleeding into the band. Focus
          goes to white rather than a brighter blue — on navy there is nowhere
          bluer to go. */}
      <form
        action={`/${locale}/search`}
        onSubmit={() => setOpen(false)}
        className={FORM_CLASS}
      >
        <input
          type="search"
          ref={inputRef}
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t.searchPlaceholder}
          autoComplete="off"
          maxLength={REQUEST_LIMITS.searchChars}
          aria-label={t.search}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && items.length > 0}
          aria-controls={open && items.length > 0 ? listboxId : undefined}
          aria-activedescendant={
            open && active >= 0 ? `${listboxId}-option-${active}` : undefined
          }
          // `min-w-0` is load-bearing: a flex item defaults to `min-width:
          // auto`, so without it this input refuses to shrink below the
          // intrinsic width of its placeholder and pushes the submit button
          // out past the form's right edge — on a 375px screen that put the
          // magnifier on top of the ORDER link.
          className={INPUT_CLASS}
        />
        <button type="submit" aria-label={t.search} className={SUBMIT_CLASS}>
          <Magnifier />
        </button>
      </form>

      {open && items.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t.search}
          className="absolute z-30 inset-x-0 top-full bg-white border border-[var(--color-rule)] shadow-lg max-h-96 overflow-y-auto"
        >
          {items.map((s, i) => (
            <li key={`${s.type}-${i}`} role="presentation">
              <button
                id={`${listboxId}-option-${i}`}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                type="button"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(s)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-start text-[13px] ${
                  i === active ? "bg-[var(--color-panel)]" : ""
                }`}
              >
                {s.type === "product" ? (
                  <>
                    <span className="tech font-bold text-[var(--color-ink)]">
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
