"use client";

import { useActionState, useState } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { saveColumnsAction, type ColumnsState } from "./actions";
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
    })),
    dropKeys,
  });

  if (rows.length === 0) {
    return <p className="text-[12px] text-[var(--color-ink-muted)]">{t.columnsNone}</p>;
  }

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

      <div className="scroll-x">
        <table className="spec-table">
          <thead>
            <tr>
              <th className="num">{t.columnsOrder}</th>
              <th>{t.columnsKey}</th>
              <th>{t.columnsHeadingEn}</th>
              <th>{t.columnsHeadingFa}</th>
              <th>{t.columnsUnit}</th>
              <th>{t.reviewKind}</th>
              <th>{t.reviewShowIn}</th>
              <th className="num">{t.reviewFilterable}</th>
              <th className="num">{t.products}</th>
              <th />
            </tr>
          </thead>
          <tbody>
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
                      className="admin-input"
                      value={r.labelEn}
                      disabled={dropped || demo}
                      onChange={(e) => set(r.key, { labelEn: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="admin-input"
                      dir="rtl"
                      value={r.labelFa}
                      disabled={dropped || demo}
                      onChange={(e) => set(r.key, { labelFa: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
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
                  <td>
                    <select
                      className="admin-select"
                      value={r.display}
                      disabled={dropped || demo}
                      onChange={(e) =>
                        set(r.key, { display: e.target.value === "table" ? "table" : "detail" })
                      }
                    >
                      <option value="table">{t.reviewInTable}</option>
                      <option value="detail">{t.reviewInDetail}</option>
                    </select>
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

      <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{t.columnsDeleteHint}</p>

      <button type="submit" className="btn-small mt-2" disabled={demo || isPending}>
        {t.columnsSave}
      </button>
    </form>
  );
}
