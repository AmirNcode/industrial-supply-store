"use client";

import { useState, useTransition } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { isSoldBy, type SoldBy } from "@/lib/soldBy";
import { setFamilySoldByAction } from "./actions";

/**
 * Whether a family is sold in packages or by single units. Saves on change:
 * there is nothing to draft, and the sticky Save belongs to the tree edits.
 * A failed save puts the select back, so it never shows a value the catalog
 * is not using.
 */
export function SoldByControl({
  familyId,
  initial,
  locale,
  demo,
}: {
  familyId: number;
  initial: SoldBy;
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  const [value, setValue] = useState<SoldBy>(initial);
  const [note, setNote] = useState<"saved" | "failed" | null>(null);
  const [pending, start] = useTransition();

  const change = (next: string) => {
    if (!isSoldBy(next) || next === value) return;
    const previous = value;
    setValue(next);
    setNote(null);
    start(async () => {
      const { ok } = await setFamilySoldByAction(familyId, next, locale).catch(() => ({ ok: false }));
      if (!ok) setValue(previous);
      setNote(ok ? "saved" : "failed");
    });
  };

  return (
    <label className="inline-flex flex-wrap items-center gap-2 text-[12px]">
      <span className="font-bold">{t.soldByLabel}</span>
      <select
        value={value}
        disabled={demo || pending}
        onChange={(e) => change(e.target.value)}
        className="text-[12px]"
      >
        <option value="package">{t.soldByPackage}</option>
        <option value="unit">{t.soldByUnit}</option>
      </select>
      {note && (
        <span
          role="status"
          className={note === "saved" ? "text-[var(--color-ink-muted)]" : "text-[#a3312a]"}
        >
          {note === "saved" ? t.soldBySaved : t.soldByFailed}
        </span>
      )}
    </label>
  );
}
