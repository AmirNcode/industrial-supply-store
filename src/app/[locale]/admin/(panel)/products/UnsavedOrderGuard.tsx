"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";

/**
 * Stops an unsaved catalog arrangement from being lost on the way out.
 *
 * Two exits, and the browser only lets us do the good version of one of them:
 *
 *   Leaving the site — closing the tab, reloading, typing a new address — can
 *   only be caught by `beforeunload`, and every browser deliberately replaces
 *   whatever we say with its own generic "Leave site?" dialog. There is no way
 *   to offer Save or Discard there; the choice is the browser's two buttons.
 *   That is a platform rule, not something worth fighting.
 *
 *   Leaving *within* the site — the admin tabs, a family's Columns link, the
 *   category editor — is a click we can catch first, and that one gets the real
 *   dialog with Save, Discard and Stay.
 *
 * The click is caught in the capture phase on `document`, rather than by
 * wiring a handler into every link on the page. Those links are spread across
 * the header, the tab strip and each family row, several of them owned by
 * components with no idea this page has unsaved state — and a guard that only
 * covers the links someone remembered to mark is a guard that will be wrong
 * later. Anything that is not really a navigation is left alone: the CSV
 * template and export are downloads, and a middle-click or ⌘-click opens a new
 * tab and leaves this page exactly where it is.
 */
export function UnsavedOrderGuard({
  dirtyCount,
  locale,
  onSave,
  onDiscard,
}: {
  /** How many categories hold an unsaved arrangement. */
  dirtyCount: number;
  locale: Locale;
  /** Resolves once every pending category is written, or false if any failed. */
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
}) {
  const t = getDict(locale);
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /*
   * The handler is registered once and reads the current values through a ref.
   * Re-registering a capture-phase document listener on every keystroke of
   * state would mean a window, however small, where a click lands between the
   * remove and the add.
  */
  const state = useRef({ dirtyCount, pendingHref });
  useEffect(() => {
    state.current = { dirtyCount, pendingHref };
  }, [dirtyCount, pendingHref]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (state.current.dirtyCount === 0 || state.current.pendingHref !== null) return;

      // Anything but a plain left click is the reader opening this elsewhere or
      // asking for a context menu; either way they are not leaving the page.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      // A download hands over a file and leaves the page standing; a new tab
      // leaves it standing too.
      if (link.hasAttribute("download") || (link.target && link.target !== "_self")) return;

      const href = link.href;
      const url = new URL(href, window.location.href);
      // A jump inside this very page is not leaving it.
      if (url.origin === window.location.origin && url.pathname === window.location.pathname) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setPendingHref(href);
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (state.current.dirtyCount === 0) return;
      // Both spellings: `preventDefault` is the standard, `returnValue` is what
      // some browsers still read. Neither controls the wording.
      event.preventDefault();
      event.returnValue = "";
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  if (pendingHref === null) return null;

  const leave = (href: string) => {
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin) router.push(url.pathname + url.search + url.hash);
    else window.location.href = href;
  };

  const scope =
    dirtyCount === 1
      ? t.orderUnsavedOne
      : t.orderUnsavedMany.replace("{n}", formatInt(dirtyCount, locale));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
      onClick={() => setPendingHref(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.orderUnsavedTitle}
        className="w-full max-w-[440px] border border-[var(--color-ink)] bg-white p-4 text-start"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 border-b border-[var(--color-rule)] pb-1 text-[14px] font-bold">
          {t.orderUnsavedTitle}
        </h2>
        <p className="text-[12px]">{t.orderUnsavedBody.replace("{n}", scope)}</p>

        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[var(--color-rule)] pt-3">
          <button
            type="button"
            className="btn-small"
            disabled={saving}
            onClick={() => setPendingHref(null)}
          >
            {t.orderStay}
          </button>
          <button
            type="button"
            className="btn-small"
            disabled={saving}
            onClick={() => {
              onDiscard();
              leave(pendingHref);
            }}
          >
            {t.orderDiscardAndLeave}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onSave();
              setSaving(false);
              // A save that failed leaves the dialog up with the reason already
              // rendered behind it; leaving now would discard the work anyway.
              if (ok) leave(pendingHref);
              else setPendingHref(null);
            }}
          >
            {t.orderSaveAndLeave}
          </button>
        </div>
      </div>
    </div>
  );
}
