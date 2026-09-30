"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
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
 *
 * A third exit is not a link at all: choosing another family in the products
 * tree swaps the pane in place, which would drop the product table's edits.
 * `requestRef` lets the page route that through the same dialog, with the
 * move to make once the person has chosen.
 *
 * A fourth is the browser's Back and Forward, which change `?cat=` and remount
 * the pane with the draft gone (review finding M-19). `popstate` cannot be
 * cancelled, so the guard listens in the capture phase — ahead of the router's
 * own listener — puts the page's address back, and asks; the move the person
 * pressed becomes the navigation to make if they choose to leave.
 */
type Pending = { href: string } | { go: () => void };
export function UnsavedOrderGuard({
  dirtyCount,
  locale,
  onSave,
  onDiscard,
  copy,
  requestRef,
}: {
  /** How many categories hold an unsaved arrangement. */
  dirtyCount: number;
  locale: Locale;
  /** Resolves once every pending category is written, or false if any failed. */
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
  /** Taxonomy work also includes descriptions/images, not only ordering. */
  copy?: { title: string; body: string; scope: string };
  /** Filled with a function that opens this dialog for an in-page move. */
  requestRef?: RefObject<((go: () => void) => void) | null>;
}) {
  const t = getDict(locale);
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);

  /*
   * The handler is registered once and reads the current values through a ref.
   * Re-registering a capture-phase document listener on every keystroke of
   * state would mean a window, however small, where a click lands between the
   * remove and the add.
  */
  const state = useRef({ dirtyCount, pending });
  useEffect(() => {
    state.current = { dirtyCount, pending };
  }, [dirtyCount, pending]);

  // Where this page is, to put back when Back or Forward is pressed with
  // unsaved work. Refreshed only while nothing is unsaved: the router
  // re-renders for the new address *before* `popstate` fires, so a snapshot
  // taken on every render would already be the page Back is heading to. While
  // work is unsaved the address cannot change except through this dialog.
  const here = useRef<{ href: string; state: unknown } | null>(null);
  useEffect(() => {
    if (dirtyCount === 0 || here.current === null) {
      here.current = { href: window.location.href, state: window.history.state };
    }
  });

  useEffect(() => {
    if (!requestRef) return;
    requestRef.current = (go) => setPending({ go });
    return () => {
      requestRef.current = null;
    };
  }, [requestRef]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (state.current.dirtyCount === 0 || state.current.pending !== null) return;

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
      setPending({ href });
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (state.current.dirtyCount === 0) return;
      // Both spellings: `preventDefault` is the standard, `returnValue` is what
      // some browsers still read. Neither controls the wording.
      event.preventDefault();
      event.returnValue = "";
    };

    const onPopState = (event: PopStateEvent) => {
      if (state.current.dirtyCount === 0 || state.current.pending !== null || !here.current) return;
      const target = window.location.pathname + window.location.search + window.location.hash;
      // Keep the router from acting on it, and stay where the work is.
      event.stopImmediatePropagation();
      window.history.pushState(here.current.state, "", here.current.href);
      setPending({ href: target });
    };

    // Where the Navigation API exists, Back/Forward is stopped before the
    // address changes, so nothing re-renders; `popstate` is the fallback.
    type NavigateEvent = Event & {
      navigationType: string;
      cancelable: boolean;
      destination: { url: string };
    };
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    const onNavigate = (event: Event) => {
      const nav = event as NavigateEvent;
      if (state.current.dirtyCount === 0 || state.current.pending !== null) return;
      if (nav.navigationType !== "traverse" || !nav.cancelable) return;
      const url = new URL(nav.destination.url);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      setPending({ href: url.pathname + url.search + url.hash });
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState, true);
    navigation?.addEventListener("navigate", onNavigate);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState, true);
      navigation?.removeEventListener("navigate", onNavigate);
    };
  }, []);

  if (pending === null) return null;

  const leave = (to: Pending) => {
    // An in-page move closes the dialog; a navigation leaves it up until the
    // page goes, as before, so nothing else can be clicked on the way out.
    if ("go" in to) {
      setPending(null);
      to.go();
      return;
    }
    const url = new URL(to.href, window.location.href);
    if (url.origin === window.location.origin) router.push(url.pathname + url.search + url.hash);
    else window.location.href = to.href;
  };

  const scope =
    copy?.scope ??
    (dirtyCount === 1
      ? t.orderUnsavedOne
      : t.orderUnsavedMany.replace("{n}", formatInt(dirtyCount, locale)));
  const title = copy?.title ?? t.orderUnsavedTitle;
  const body = (copy?.body ?? t.orderUnsavedBody).replace("{n}", scope);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
      onClick={() => setPending(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[440px] border border-[var(--color-ink)] bg-white p-4 text-start"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 border-b border-[var(--color-rule)] pb-1 text-[14px] font-bold">
          {title}
        </h2>
        <p className="text-[12px]">{body}</p>

        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[var(--color-rule)] pt-3">
          <button
            type="button"
            className="btn-small"
            disabled={saving}
            onClick={() => setPending(null)}
          >
            {t.orderStay}
          </button>
          <button
            type="button"
            className="btn-small"
            disabled={saving}
            onClick={() => {
              onDiscard();
              leave(pending);
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
              if (ok) leave(pending);
              else setPending(null);
            }}
          >
            {t.orderSaveAndLeave}
          </button>
        </div>
      </div>
    </div>
  );
}
