"use client";

import { useState } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import {
  BUILTIN_FIELDS,
  MAX_LEGIBLE_COLUMNS,
  prettifyLabel,
  slugifyKey,
  type AnalyzedHeader,
  type BuiltinField,
  type HeaderPlan,
  type ImportMode,
  type MissingColumn,
} from "@/lib/columnPlan";
import type { ImportError } from "@/lib/importCsv";

/**
 * The screen between choosing a file and importing it.
 *
 * The plan lives in React state and is posted as one JSON field rather than as
 * a form control per column: a 47-column file would otherwise need close to two
 * hundred named inputs, and the server would be reassembling them by index.
 *
 * The file itself is not re-chosen. It is held in a short-lived private object,
 * and confirmation posts only the signed handle plus these decisions.
 */

type MissingRow = MissingColumn & { productCount: number };

/** What the single "treat as" dropdown offers, flattened. */
const SPEC_OPTION = "__spec__";
const IGNORE_OPTION = "__ignore__";

/** A long file can fail on thousands of rows; the first screenful is what
 *  someone acts on. */
const MAX_SHOWN = 50;

export function ColumnReview({
  headers,
  missing,
  rowCount,
  problems,
  rowProblems,
  goodRows,
  locale,
  pending,
}: {
  headers: AnalyzedHeader[];
  missing: MissingRow[];
  rowCount: number;
  problems: string[];
  rowProblems: ImportError[];
  goodRows: number;
  locale: Locale;
  pending: boolean;
}) {
  const t = getDict(locale);
  const [plans, setPlans] = useState<HeaderPlan[]>(() => headers.map((h) => h.plan));
  const [dropKeys, setDropKeys] = useState<string[]>([]);
  const [mode, setMode] = useState<ImportMode>("update");
  const [skipBadRows, setSkipBadRows] = useState(false);

  const update = (i: number, next: HeaderPlan) =>
    setPlans((prev) => prev.map((p, j) => (j === i ? next : p)));

  /** Switching role has to invent the fields the new role needs. */
  function setRole(i: number, value: string) {
    const header = plans[i].header;
    if (value === IGNORE_OPTION) return update(i, { role: "ignore", header });
    if (value === SPEC_OPTION) {
      const label = prettifyLabel(header);
      const original = headers[i].plan;
      // Coming back to "spec" restores what was proposed, so flipping a column
      // to ignored and back does not lose the inferred kind.
      return update(
        i,
        original.role === "spec"
          ? original
          : {
              role: "spec",
              header,
              key: slugifyKey(header),
              labelEn: label,
              labelFa: label,
              unit: "",
              specKind: "text",
              inTable: false,
              inDetail: true,
              filterable: false,
            },
      );
    }
    update(i, { role: "builtin", header, field: value as BuiltinField });
  }

  const newOnes = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.isNew);
  const matched = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => !h.isNew);

  /**
   * Which column already holds each built-in field.
   *
   * There is one `documents` slot, one `price_usd`, one part number. Offering
   * a slot that is already taken is offering a mistake — the confirm step
   * refuses it, so the only thing a second choice can produce is an error.
   * Shown as disabled, named after its owner, rather than hidden: "taken by
   * documents" explains the absence where a missing row would puzzle.
   */
  const owners = new Map<string, string>();
  for (const p of plans) if (p.role === "builtin") owners.set(p.field, p.header);

  /*
   * What the catalog table would carry after this import: the part number,
   * every spec column this file marks for the table, and the family's existing
   * table columns that the file does not carry and is not dropping — those
   * survive the import and keep their place in the table.
   */
  const tableColumns =
    1 +
    plans.filter((p) => p.role === "spec" && p.inTable).length +
    missing.filter((m) => m.inTable && !dropKeys.includes(m.key)).length;

  const plan = JSON.stringify({ headers: plans, dropKeys, mode, skipBadRows });
  const badRowCount = new Set(rowProblems.map((e) => e.row)).size;
  // Confirming with bad rows and no decision about them would just bounce back.
  const blocked = badRowCount > 0 && !skipBadRows;

  return (
    <div className="mt-2 border border-[var(--color-rule)] bg-white p-3">
      <input type="hidden" name="plan" value={plan} />

      <h3 className="text-[13px] font-bold text-[var(--color-navy)]">{t.reviewTitle}</h3>
      <p className="mt-0.5 text-[12px] text-[var(--color-ink-muted)]">
        {t.reviewIntro.replace("{rows}", formatInt(rowCount, locale))}
      </p>

      {problems.length > 0 && (
        <div className="mt-2 border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5">
          <p className="text-[12px] font-bold text-[var(--color-danger)]">
            {t.reviewProblems}
          </p>
          <ul className="mt-0.5 grid gap-0.5 text-[11px]">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {badRowCount > 0 && (
        <div className="mt-2 border border-[var(--color-warn-line)] bg-[var(--color-warn-soft)] px-2.5 py-1.5">
          <p className="text-[12px] font-bold">
            {t.reviewBadRows
              .replace("{bad}", formatInt(badRowCount, locale))
              .replace("{total}", formatInt(rowCount, locale))}
          </p>
          <table className="spec-table mt-1">
            <thead>
              <tr>
                <th className="num">{t.importRow}</th>
                <th>{t.importColumn}</th>
                <th>{t.importProblem}</th>
              </tr>
            </thead>
            <tbody>
              {rowProblems.slice(0, MAX_SHOWN).map((e, i) => (
                <tr key={i}>
                  <td className="num tech tech-num">{formatInt(e.row, locale)}</td>
                  <td className="tech">{e.column}</td>
                  <td className="whitespace-normal">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rowProblems.length > MAX_SHOWN && (
            <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
              + {formatInt(rowProblems.length - MAX_SHOWN, locale)}
            </p>
          )}
          {/* The way through. Without it the only options are editing the file
              and redoing the columns, or giving up. */}
          <label className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold">
            <input
              type="checkbox"
              checked={skipBadRows}
              onChange={(e) => setSkipBadRows(e.target.checked)}
            />
            {t.reviewSkipBadRows
              .replace("{bad}", formatInt(badRowCount, locale))
              .replace("{good}", formatInt(goodRows, locale))}
          </label>
        </div>
      )}

      <fieldset className="mt-3">
        <legend className="text-[12px] font-bold">{t.reviewMode}</legend>
        <label className="mt-0.5 flex items-start gap-1.5 text-[12px]">
          <input
            type="radio"
            name="mode-ui"
            className="mt-0.5"
            checked={mode === "update"}
            onChange={() => setMode("update")}
          />
          <span>
            {t.reviewModeUpdate}
            <span className="block text-[11px] text-[var(--color-ink-muted)]">
              {t.reviewModeUpdateHint}
            </span>
          </span>
        </label>
        <label className="mt-1 flex items-start gap-1.5 text-[12px]">
          <input
            type="radio"
            name="mode-ui"
            className="mt-0.5"
            checked={mode === "replace"}
            onChange={() => setMode("replace")}
          />
          <span>
            {t.reviewModeReplace}
            <span className="block text-[11px] text-[var(--color-ink-muted)]">
              {t.reviewModeReplaceHint}
            </span>
          </span>
        </label>
      </fieldset>

      {newOnes.length > 0 && (
        <section className="mt-3">
          <h4 className="text-[12px] font-bold">
            {t.reviewNew}{" "}
            <span className="tech font-normal text-[var(--color-ink-muted)]">
              {formatInt(newOnes.length, locale)}
            </span>
          </h4>
          <p className="mb-1 text-[11px] text-[var(--color-ink-muted)]">{t.reviewNewIntro}</p>
          <div className="scroll-x scroll-x-pad">
            <table className="spec-table">
              <thead>
                <tr>
                  <th>{t.importColumn}</th>
                  <th>{t.reviewExamples}</th>
                  <th>{t.reviewRole}</th>
                  {/* A checkbox rather than a two-option dropdown: promoting
                      six columns out of thirty-eight is then six clicks, not
                      thirty-eight visits. Unchecked means product details. */}
                  <th className="num">{t.reviewInTable}</th>
                  <th>{t.reviewKind}</th>
                  <th className="num">{t.reviewFilterable}</th>
                </tr>
              </thead>
              <tbody>
                {newOnes.map(({ h, i }) => {
                  const p = plans[i];
                  return (
                    <tr key={h.plan.header}>
                      <td className="tech font-semibold">{h.plan.header}</td>
                      <td className="max-w-[220px] truncate text-[11px] text-[var(--color-ink-muted)]">
                        {h.samples.join(" · ") || "—"}
                      </td>
                      <td>
                        <select
                          className="admin-select"
                          value={
                            p.role === "spec"
                              ? SPEC_OPTION
                              : p.role === "ignore"
                                ? IGNORE_OPTION
                                : p.field
                          }
                          onChange={(e) => setRole(i, e.target.value)}
                        >
                          <option value={SPEC_OPTION}>{t.reviewRoleSpec}</option>
                          {BUILTIN_FIELDS.map((f) => {
                            const owner = owners.get(f);
                            const taken = owner !== undefined && owner !== p.header;
                            return (
                              <option key={f} value={f} disabled={taken}>
                                {f}
                                {taken ? ` — ${t.reviewFieldTaken.replace("{column}", owner)}` : ""}
                              </option>
                            );
                          })}
                          <option value={IGNORE_OPTION}>{t.reviewRoleIgnore}</option>
                        </select>
                      </td>
                      <td className="num">
                        {p.role === "spec" ? (
                          <input
                            type="checkbox"
                            checked={p.inTable}
                            /* One tick, two flags: the review screen still
                               offers "in the catalog table or in the expanded
                               row", exactly as before. The four-way choice
                               lives in the column editor. */
                            onChange={(e) =>
                              update(i, {
                                ...p,
                                inTable: e.target.checked,
                                inDetail: !e.target.checked,
                              })
                            }
                          />
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">—</span>
                        )}
                      </td>
                      <td>
                        {p.role === "spec" ? (
                          <select
                            className="admin-select"
                            value={p.specKind}
                            onChange={(e) =>
                              update(i, {
                                ...p,
                                specKind: e.target.value === "number" ? "number" : "text",
                              })
                            }
                          >
                            <option value="text">{t.reviewKindText}</option>
                            <option value="number">{t.reviewKindNumber}</option>
                          </select>
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">—</span>
                        )}
                      </td>
                      <td className="num">
                        {p.role === "spec" ? (
                          <input
                            type="checkbox"
                            checked={p.filterable}
                            onChange={(e) => update(i, { ...p, filterable: e.target.checked })}
                          />
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {missing.length > 0 && (
        <section className="mt-3">
          <h4 className="text-[12px] font-bold">{t.reviewMissing}</h4>
          <p className="mb-1 text-[11px] text-[var(--color-ink-muted)]">
            {t.reviewMissingIntro}
          </p>
          <ul className="grid gap-1">
            {missing.map((m) => {
              const dropping = dropKeys.includes(m.key);
              return (
                <li key={m.key} className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className="tech font-semibold">{m.key}</span>
                  <span className="text-[11px] text-[var(--color-ink-muted)]">
                    {m.productCount > 0
                      ? t.reviewHasValues.replace("{n}", formatInt(m.productCount, locale))
                      : t.reviewNoValues}
                  </span>
                  <select
                    className="admin-select ms-auto"
                    value={dropping ? "delete" : "keep"}
                    onChange={(e) =>
                      setDropKeys((prev) =>
                        e.target.value === "delete"
                          ? [...prev, m.key]
                          : prev.filter((k) => k !== m.key),
                      )
                    }
                  >
                    <option value="keep">{t.reviewKeep}</option>
                    <option value="delete">{t.reviewDelete}</option>
                  </select>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {matched.length > 0 && (
        <section className="mt-3">
          <h4 className="text-[12px] font-bold">
            {t.reviewMatched}{" "}
            <span className="tech font-normal text-[var(--color-ink-muted)]">
              {formatInt(matched.length, locale)}
            </span>
          </h4>
          <p className="text-[11px] text-[var(--color-ink-muted)]">
            {t.reviewMatchedIntro}
          </p>
          <p className="tech mt-0.5 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
            {matched
              .map(({ h }) =>
                h.plan.role === "builtin"
                  ? `${h.plan.header} → ${h.plan.field}`
                  : h.plan.header,
              )
              .join(", ")}
          </p>
        </section>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="stage"
          value="apply"
          className="btn-small"
          disabled={pending || blocked}
        >
          {t.reviewConfirm}
        </button>
        {/* The same advice the column editor gives, at the same count, so an
            import cannot quietly build the table the editor would warn about.
            Advice only — the import is not blocked. */}
        {tableColumns > MAX_LEGIBLE_COLUMNS && (
          <p className="text-[11px] text-[var(--color-danger)]">{t.columnsTooMany}</p>
        )}
      </div>
      {blocked && (
        <p className="mt-1 text-[11px] text-[var(--color-danger)]">{t.reviewBlocked}</p>
      )}
    </div>
  );
}
