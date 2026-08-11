"use client";

import { useState } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import {
  BUILTIN_FIELDS,
  prettifyLabel,
  slugifyKey,
  type AnalyzedHeader,
  type BuiltinField,
  type HeaderPlan,
  type MissingColumn,
} from "@/lib/columnPlan";

/**
 * The screen between choosing a file and importing it.
 *
 * The plan lives in React state and is posted as one JSON field rather than as
 * a form control per column: a 47-column file would otherwise need close to two
 * hundred named inputs, and the server would be reassembling them by index.
 *
 * The file itself is not re-chosen. It is still sitting in the file input of the
 * form this renders inside, so confirming posts the same bytes with the
 * decisions attached — no copy of it is held anywhere between the two stages.
 */

type MissingRow = MissingColumn & { productCount: number };

/** What the single "treat as" dropdown offers, flattened. */
const SPEC_OPTION = "__spec__";
const IGNORE_OPTION = "__ignore__";

export function ColumnReview({
  headers,
  missing,
  rowCount,
  problems,
  locale,
  pending,
}: {
  headers: AnalyzedHeader[];
  missing: MissingRow[];
  rowCount: number;
  problems: string[];
  locale: Locale;
  pending: boolean;
}) {
  const t = getDict(locale);
  const [plans, setPlans] = useState<HeaderPlan[]>(() => headers.map((h) => h.plan));
  const [dropKeys, setDropKeys] = useState<string[]>([]);

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
              display: "detail",
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

  const plan = JSON.stringify({ headers: plans, dropKeys });

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

      {newOnes.length > 0 && (
        <section className="mt-3">
          <h4 className="text-[12px] font-bold">
            {t.reviewNew}{" "}
            <span className="tech font-normal text-[var(--color-ink-muted)]">
              {formatInt(newOnes.length, locale)}
            </span>
          </h4>
          <p className="mb-1 text-[11px] text-[var(--color-ink-muted)]">{t.reviewNewIntro}</p>
          <div className="scroll-x">
            <table className="spec-table">
              <thead>
                <tr>
                  <th>{t.importColumn}</th>
                  <th>{t.reviewExamples}</th>
                  <th>{t.reviewRole}</th>
                  <th>{t.reviewShowIn}</th>
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
                          {BUILTIN_FIELDS.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                          <option value={IGNORE_OPTION}>{t.reviewRoleIgnore}</option>
                        </select>
                      </td>
                      <td>
                        {p.role === "spec" ? (
                          <select
                            className="admin-select"
                            value={p.display}
                            onChange={(e) =>
                              update(i, {
                                ...p,
                                display: e.target.value === "table" ? "table" : "detail",
                              })
                            }
                          >
                            <option value="detail">{t.reviewInDetail}</option>
                            <option value="table">{t.reviewInTable}</option>
                          </select>
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

      <button
        type="submit"
        name="stage"
        value="apply"
        className="btn-small mt-3"
        disabled={pending}
      >
        {t.reviewConfirm}
      </button>
    </div>
  );
}
