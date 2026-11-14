"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps what was typed into the form it sits in, and puts it back when the
 * page comes back with an error (review R-13).
 *
 * Checkout and sign-up answer a refused submit with a redirect to the same
 * page plus `?error=…`, and the form arrived empty: a guest who missed one
 * field, or whose cart changed under them, typed company, name, phone, email
 * and address again. The typed values are kept in this tab's session storage
 * — never sent anywhere, gone when the tab closes — and restored only when
 * `restore` is set, which the page does when it is showing an error. A normal
 * visit clears them, so a finished order's details do not greet the next one.
 *
 * Passwords, hidden fields and files are never kept.
 */
export function FormDraft({ storageKey, restore }: { storageKey: string; restore: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const key = `form-draft:${storageKey}`;
    const kept = (el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      (el instanceof HTMLInputElement && !["password", "hidden", "file", "submit"].includes(el.type) && el.name !== "") ||
      ((el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) && el.name !== "");
    const fields = () => Array.from(form.elements).filter(kept);

    function save() {
      const draft: Record<string, string | boolean> = {};
      for (const el of fields()) {
        if (el instanceof HTMLInputElement && el.type === "radio") {
          if (el.checked) draft[el.name] = el.value;
        } else if (el instanceof HTMLInputElement && el.type === "checkbox") {
          draft[el.name] = el.checked;
        } else {
          draft[el.name] = el.value;
        }
      }
      try {
        sessionStorage.setItem(key, JSON.stringify(draft));
      } catch {
        /* storage full or blocked: the form simply is not remembered */
      }
    }

    function put() {
      let draft: Record<string, string | boolean>;
      try {
        draft = JSON.parse(sessionStorage.getItem(key) ?? "null") ?? {};
      } catch {
        return;
      }
      for (const el of fields()) {
        const value = draft[el.name];
        if (value === undefined) continue;
        if (el instanceof HTMLInputElement && el.type === "radio") el.checked = el.value === value;
        else if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = value === true;
        else if (typeof value === "string") el.value = value;
      }
    }

    // After the frame, not at once: React clears an action's form when the
    // action finishes, and that must not land on top of what was just put back.
    let frame = 0;
    if (restore) frame = requestAnimationFrame(put);
    else {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* nothing to clear */
      }
    }
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
    };
  }, [storageKey, restore]);

  return <span ref={anchor} hidden />;
}
