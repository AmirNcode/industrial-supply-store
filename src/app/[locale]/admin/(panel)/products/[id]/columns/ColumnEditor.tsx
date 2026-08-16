"use client";

import { useActionState, useState } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { saveColumnsAction, type ColumnsState } from "./actions";
import { MAX_LEGIBLE_COLUMNS } from "@/lib/columnPlan";
import type { EditableDef } from "@/db/columnQueries";

/**
 * The column editor.
 *
 * Order is set with up/down buttons rather than dragging. A 47-row list is
 * exactly where dragging is worst — the drop target is off-screen — and the
 * buttons work on a phone and with a keyboard without a library.
 *
 * Deletion is staged, not immediate: a deleted column is struck through and
 * restorable until Save, so removing the wrong one of two similarly named
 * columns is an undo rather than a re-import.
 */
export function ColumnEditor({
  familyId,
  defs,
  locale,
  demo,
}: {
  familyId: number;
  defs: EditableDef[];
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  const [state, formAction, isPending] = useActionState<ColumnsState | null, FormData>(
    saveColumnsAction,
    null,
  );
  const [rows, setRows] = useState(defs);
  const [dropKeys, setDropKeys] = useState<string[]>([]);

  const set = (key: string, patch: Partial<EditableDef>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function move(i: number, by: number) {
    setRows((prev) => {
      const next = [...prev];
      const to = i + by;
      if (to < 0 || to >= next.length) return prev;
      [next[i], next[to]] = [next[to], next[i]];
      return next;
    });
  }

  /** Every product in the family has a part number, so the widest count is it. */
  const productTotal = rows.reduce((n, r) => Math.max(n, r.productCount), 0);

  /**
   * How many columns the catalog table would carry. The part number is one of
   * them and is not in `rows`, so it is counted here — the reader sees it as a
   * column like any other, and the advice is about what they end up scanning.
   */
  const tableColumns =
    1 + rows.filter((r) => r.display === "table" && !dropKeys.includes(r.key)).length;

  const kept = rows.filter((r) => !dropKeys.includes(r.key));
  const edits = JSON.stringify({
    // Sort is the position in the kept list, so deleting a column closes the
    // gap rather than leaving the order sparse.
    edits: kept.map((r) => ({
      key: r.key,
      labelEn: r.labelEn,
      labelFa: r.labelFa,
      unit: r.unit,
      kind: r.kind,
      display: r.display,
      filterable: r.filterable,
      mobile: r.mobile,
    })),
    dropKeys,
  });

  return (
    <form action={formAction}>
      <input type="hidden" name="familyId" value={familyId} />
      <input type="hidden" name="edits" value={edits} />

      {state?.kind === "saved" && (
        <p className="mb-2 border border-[#b6d7bb] bg-[#f0f8f1] px-2.5 py-1.5 text-[12px]">
          {t.columnsSaved}
          {state.deleted > 0 &&
            ` ${t.importDroppedColumns.replace("{n}", formatInt(state.deleted, locale))}.`}
        </p>
      )}
      {state?.kind === "error" && (
        <p className="mb-2 border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5 text-[12px] text-[var(--color-danger)]">
          {state.message}
        </p>
      )}

      <div className="scroll-x scroll-x-pad">
        <table className="spec-table">
          <thead>
            <tr>
              <th className="num">{t.columnsOrder}</th>
              <th>{t.columnsKey}</th>
              <th>{t.columnsHeadingEn}</th>
              <th>{t.columnsHeadingFa}</th>
              <th>{t.columnsUnit}</th>
              <th>{t.reviewKind}</th>
              <th className="num">{t.reviewInTable}</th>
              <th className="num">{t.columnsMobile}</th>
              <th className="num">{t.reviewFilterable}</th>
              <th className="num">{t.products}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {/*
              The part number, shown but not editable.

              It is a column on `products`, not one of this family's specs, so
              there is nothing here to rename, reorder or delete. It was absent
              entirely before, which made the catalog's first column look like
              it came from nowhere.
            */}
            <tr className="bg-[var(--color-panel-alt)]">
              <td className="num text-[10px] text-[var(--color-ink-faint)]">
                {t.columnsFixed}
              </td>
              <td className="tech">part_number</td>
              <td className="text-[11px]">{t.partNumber}</td>
              <td className="text-[11px]" dir="rtl">
                {t.partNumber}
              </td>
              <td />
              <td className="text-[11px] text-[var(--color-ink-muted)]">
                {t.reviewKindText}
              </td>
              <td className="num">
                <input type="checkbox" checked readOnly disabled />
              </td>
              <td className="num">
                <input type="checkbox" checked readOnly disabled />
              </td>
              <td className="num">
                <input type="checkbox" checked={false} readOnly disabled />
              </td>
              <td className="num tech tech-num">{formatInt(productTotal, locale)}</td>
              <td />
            </tr>
            {rows.map((r, i) => {
              const dropped = dropKeys.includes(r.key);
              return (
                <tr key={r.key} className={dropped ? "opacity-45" : undefined}>
                  <td className="num whitespace-nowrap">
                    <button
                      type="button"
                      className="btn-tiny"
                      onClick={() => move(i, -1)}
                      disabled={i === 0 || demo}
                      aria-label={t.columnsMoveUp}
                    >
                      ↑
                    </button>{" "}
                    <button
                      type="button"
                      className="btn-tiny"
                      onClick={() => move(i, 1)}
                      disabled={i === rows.length - 1 || demo}
                      aria-label={t.columnsMoveDown}
                    >
                      ↓
                    </button>
                  </td>
                  <td className={`tech ${dropped ? "line-through" : ""}`}>{r.key}</td>
                  <td>
                    <input
                      type="text"
                      className="admin-input"
                      value={r.labelEn}
                      disabled={dropped || demo}
                      onChange={(e) => set(r.key, { labelEn: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="admin-input"
                      dir="rtl"
                      value={r.labelFa}
                      disabled={dropped || demo}
                      onChange={(e) => set(r.key, { labelFa: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="admin-input w-14"
                      value={r.unit}
                      disabled={dropped || demo}
                      onChange={(e) => set(r.key, { unit: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="admin-select"
                      value={r.kind}
                      disabled={dropped || demo}
                      onChange={(e) =>
                        set(r.key, { kind: e.target.value === "number" ? "number" : "text" })
                      }
                    >
                      <option value="text">{t.reviewKindText}</option>
                      <option value="number">{t.reviewKindNumber}</option>
                    </select>
                  </td>
                  {/* Checked is the catalog table, unchecked is product
                      details. Two states do not need a dropdown. */}
                  <td className="num">
                    <input
                      type="checkbox"
                      checked={r.display === "table"}
                      disabled={dropped || demo}
                      onChange={(e) =>
                        set(r.key, { display: e.target.checked ? "table" : "detail" })
                      }
                    />
                  </td>
                  {/* Shown on the collapsed phone card. A phone fits three or
                      four values, not the eight a desktop row carries. */}
                  <td className="num">
                    <input
                      type="checkbox"
                      checked={r.mobile}
                      disabled={dropped || demo}
                      onChange={(e) => set(r.key, { mobile: e.target.checked })}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="checkbox"
                      checked={r.filterable}
                      disabled={dropped || demo}
                      onChange={(e) => set(r.key, { filterable: e.target.checked })}
                    />
                  </td>
                  <td className="num tech tech-num">{formatInt(r.productCount, locale)}</td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn-tiny"
                      disabled={demo}
                      onClick={() =>
                        setDropKeys((prev) =>
                          dropped ? prev.filter((k) => k !== r.key) : [...prev, r.key],
                        )
                      }
                    >
                      {dropped ? t.reviewKeep : t.reviewDelete}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
        {rows.length === 0 ? t.columnsNone : t.columnsDeleteHint}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-small" disabled={demo || isPending}>
          {t.columnsSave}
        </button>
        {/* Counted on the catalog table, which is the thing that gets hard to
            read — the columns left in the expanded detail row cost nothing to
            scan past. Advice only: the button beside it stays enabled. */}
        {tableColumns > MAX_LEGIBLE_COLUMNS && (
          <p className="text-[11px] text-[var(--color-danger)]">{t.columnsTooMany}</p>
        )}
      </div>
    </form>
  );
}
