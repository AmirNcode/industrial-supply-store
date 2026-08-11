"use client";

import { useActionState } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { createFamilyAction, type NewFamilyState } from "./actions";
import type { CategoryChoice } from "@/db/familyQueries";

/**
 * Add an empty family.
 *
 * Deliberately three fields. A family exists so an upload has somewhere to
 * land, and the upload is what gives it columns — asking for a blurb and an
 * icon first would put four screens between a supplier's spreadsheet and the
 * catalog.
 */
export function NewFamilyForm({
  categories,
  locale,
  demo,
}: {
  categories: CategoryChoice[];
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  const [state, formAction, isPending] = useActionState<NewFamilyState | null, FormData>(
    createFamilyAction,
    null,
  );

  return (
    <details className="mb-4 border border-[var(--color-rule)] bg-[var(--color-panel-alt)] px-3 py-2">
      <summary className="cursor-pointer text-[12px] font-bold">{t.newFamily}</summary>

      <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{t.newFamilyIntro}</p>

      {state?.kind === "created" && (
        <p className="mt-2 border border-[#b6d7bb] bg-[#f0f8f1] px-2.5 py-1.5 text-[12px]">
          {t.newFamilyCreated.replace("{name}", state.name)}
        </p>
      )}
      {state?.kind === "error" && (
        <p className="mt-2 border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5 text-[12px] text-[var(--color-danger)]">
          {state.message === "no-name" ? t.newFamilyNoName : t.newFamilyNoCategory}
        </p>
      )}

      <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
        <label className="grid gap-0.5 text-[11px]">
          {t.newFamilyCategory}
          <select name="categoryId" className="admin-select" defaultValue="" required>
            <option value="" disabled>
              —
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {locale === "fa" ? c.nameFa : c.nameEn}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-0.5 text-[11px]">
          {t.newFamilyNameEn}
          <input name="nameEn" className="admin-input" required />
        </label>
        <label className="grid gap-0.5 text-[11px]">
          {t.newFamilyNameFa}
          <input name="nameFa" className="admin-input" dir="rtl" />
        </label>
        <button type="submit" className="btn-small" disabled={demo || isPending}>
          {t.newFamilyAdd}
        </button>
      </form>
    </details>
  );
}
