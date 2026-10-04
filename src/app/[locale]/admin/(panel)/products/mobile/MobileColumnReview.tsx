"use client";

import { useEffect, useRef } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import {
  BUILTIN_FIELDS,
  MAX_LEGIBLE_COLUMNS,
  type AnalyzedHeader,
  type ImportPlan,
} from "@/lib/columnPlan";
import type { ImportError } from "@/lib/importCsv";
import type { ForeignPart } from "@/db/importQueries";
import {
  IGNORE_OPTION,
  MAX_SHOWN,
  SPEC_OPTION,
  blockedNote,
  foreignReason,
  useColumnPlan,
  type MissingRow,
} from "../ColumnReview";
import { Banner, CheckRow, SectionHeading, Segmented, ToggleRow, TopBar, useBodyScrollLock } from "./parts";

/**
 * The column check between Upload and import, full screen on a phone.
 *
 * The desktop's `ColumnReview` with cards instead of a table: the same
 * decisions (`useColumnPlan`), posted as the same `plan` field by the same
 * form, and blocked on the same conditions. Cancel drops the uploaded file,
 * exactly as choosing no file does.
 */
export function MobileColumnReview({
  headers,
  missing,
  rowCount,
  problems,
  rowProblems,
  goodRows,
  blankRows,
  foreign,
  locale,
  pending,
  initialPlan,
  fileName,
  familyName,
  onCancel,
}: {
  headers: AnalyzedHeader[];
  missing: MissingRow[];
  rowCount: number;
  problems: string[];
  rowProblems: ImportError[];
  goodRows: number;
  blankRows: number;
  foreign: ForeignPart[];
  locale: Locale;
  pending: boolean;
  initialPlan: ImportPlan;
  fileName: string;
  familyName: string;
  onCancel: () => void;
}) {
  const t = getDict(locale);
  useBodyScrollLock();
  const review = useColumnPlan({ initialPlan, headers, missing, rowProblems, blankRows, foreign });
  const { plans, newOnes, matched, owners, badRowCount, blocked } = review;
  const importing = review.skipBadRows && badRowCount > 0 ? goodRows : rowCount;

  /*
   * The phone's Back gesture is Cancel here, as it closes a sheet: the layer
   * pushes a history entry of its own, and leaving it closes the layer. After
   * an import that entry stays behind, the same address, so one more Back
   * lands where it would have anyway.
   */
  // The entry is marked with a token of this layer's own, not a bare flag:
  // entries keep their state across reloads, so an older layer's mark could
  // otherwise be mistaken for this one's.
  const token = useRef<string | null>(null);
  // Registered once and read through a ref: a listener swapped on every
  // render can be the one removed while the browser is delivering the event.
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });
  useEffect(() => {
    if (token.current === null) {
      token.current = `${Date.now()}-${Math.random()}`;
      window.history.pushState({ mtxLayer: token.current }, "", window.location.href);
    }
    const onPopState = () => {
      if (window.history.state?.mtxLayer !== token.current) cancelRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function cancel() {
    if (token.current !== null && window.history.state?.mtxLayer === token.current) {
      window.history.back();
    }
    else onCancel();
  }

  return (
    <div className="mtx-layer" role="dialog" aria-modal="true" aria-labelledby="mtx-review-title">
      <input type="hidden" name="plan" value={review.plan} />
      <TopBar
        start={
          <button type="button" className="mtx-text-button" disabled={pending} onClick={cancel}>
            {t.fxCancel}
          </button>
        }
        title={<span id="mtx-review-title">{t.mobileCheckColumns}</span>}
        kind={t.mobileImportOf.replace("{family}", familyName)}
      />

      <section className="mtx-section">
        <p className="mtx-review-file">
          <span className="mtx-mono">{fileName}</span>
          {" · "}
          {t.mobileRowCount.replace("{n}", formatInt(rowCount, locale))}
        </p>
      </section>

      {problems.length > 0 && (
        <div className="mtx-banners">
          <Banner tone="error">
            <strong>{t.reviewProblems}</strong>
            <span className="mtx-banner-list">
              {problems.map((problem, i) => (
                <span key={i}>{problem}</span>
              ))}
            </span>
          </Banner>
        </div>
      )}

      {badRowCount > 0 && (
        <section className="mtx-warn-box">
          <h2>
            {t.reviewBadRows
              .replace("{bad}", formatInt(badRowCount, locale))
              .replace("{total}", formatInt(rowCount, locale))}
          </h2>
          <ul className="mtx-bad-rows">
            {rowProblems.slice(0, MAX_SHOWN).map((problem, i) => (
              <li key={i}>
                <span className="mtx-bad-row">
                  {t.importRow} {formatInt(problem.row, locale)}
                </span>
                <span className="mtx-bad-column" dir="ltr">{problem.column}</span>
                <span className="mtx-bad-message">{problem.message}</span>
              </li>
            ))}
          </ul>
          {rowProblems.length > MAX_SHOWN && (
            <p className="mtx-hint">
              {t.mobileMoreRows.replace("{n}", formatInt(rowProblems.length - MAX_SHOWN, locale))}
            </p>
          )}
          <CheckRow
            label={t.reviewSkipBadRows
              .replace("{bad}", formatInt(badRowCount, locale))
              .replace("{good}", formatInt(goodRows, locale))}
            checked={review.skipBadRows}
            onChange={review.setSkipBadRows}
          />
        </section>
      )}

      {blankRows > 0 && (
        <section className="mtx-warn-box">
          <h2>{review.hasPartColumn ? t.reviewBlankParts : t.reviewNoPartColumn}</h2>
          <p className="mtx-hint">
            {(review.hasPartColumn ? t.reviewBlankPartsHint : t.reviewNoPartColumnHint).replace(
              "{count}",
              formatInt(blankRows, locale),
            )}
          </p>
          <CheckRow
            label={t.reviewBlankPartsGenerate}
            checked={review.autoNumber}
            onChange={review.setAutoNumber}
          />
        </section>
      )}

      {foreign.length > 0 && (
        <section className="mtx-warn-box">
          <h2>{t.reviewForeignParts}</h2>
          <p className="mtx-hint">
            {t.reviewForeignPartsHint.replace("{count}", formatInt(foreign.length, locale))}
          </p>
          <ul className="mtx-hint">
            {foreign.slice(0, MAX_SHOWN).map((part) => (
              <li key={part.partNumber}>
                <span className="tech" dir="ltr">{part.partNumber}</span> — {foreignReason(t, part)}
              </li>
            ))}
            {foreign.length > MAX_SHOWN && <li>+ {formatInt(foreign.length - MAX_SHOWN, locale)}</li>}
          </ul>
          <CheckRow
            label={t.reviewForeignRenumber}
            checked={review.renumber}
            onChange={review.setRenumber}
          />
        </section>
      )}

      <section className="mtx-section">
        <SectionHeading>{t.reviewMode}</SectionHeading>
        <div className="mtx-radio-cards" role="radiogroup" aria-label={t.reviewMode}>
          {(
            [
              ["update", t.reviewModeUpdate, t.reviewModeUpdateHint],
              ["replace", t.reviewModeReplace, t.reviewModeReplaceHint],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className={`mtx-radio-card ${review.mode === value ? "is-selected" : ""}`}>
              <input
                type="radio"
                name="mode-ui"
                checked={review.mode === value}
                onChange={() => review.setMode(value)}
              />
              <span className="mtx-radio-dot" aria-hidden="true" />
              <span className="mtx-radio-text">
                <strong>{label}</strong>
                <span>{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {newOnes.length > 0 && (
        <section className="mtx-section">
          <SectionHeading count={formatInt(newOnes.length, locale)}>{t.reviewNew}</SectionHeading>
          <div className="mtx-cards">
            {newOnes.map(({ h, i }) => {
              const p = plans[i];
              const selectId = `mtx-role-${i}`;
              return (
                <div key={h.plan.header} className="mtx-card">
                  <div>
                    <p className="mtx-card-key" dir="ltr">{h.plan.header}</p>
                    {h.samples.length > 0 && (
                      <p className="mtx-hint">
                        {t.mobileExamples.replace("{values}", h.samples.join(" · "))}
                      </p>
                    )}
                  </div>
                  <label className="mtx-field" htmlFor={selectId}>
                    <span className="mtx-field-label">{t.reviewRole}</span>
                    <select
                      id={selectId}
                      className="mtx-input mtx-select"
                      value={p.role === "spec" ? SPEC_OPTION : p.role === "ignore" ? IGNORE_OPTION : p.field}
                      onChange={(event) => review.setRole(i, event.target.value)}
                    >
                      <option value={SPEC_OPTION}>{t.reviewRoleSpec}</option>
                      {BUILTIN_FIELDS.map((field) => {
                        const owner = owners.get(field);
                        const taken = owner !== undefined && owner !== p.header;
                        return (
                          <option key={field} value={field} disabled={taken}>
                            {field}
                            {taken ? ` — ${t.reviewFieldTaken.replace("{column}", owner)}` : ""}
                          </option>
                        );
                      })}
                      <option value={IGNORE_OPTION}>{t.reviewRoleIgnore}</option>
                    </select>
                  </label>
                  {p.role === "spec" && (
                    <>
                      <Segmented
                        label={t.reviewKind}
                        value={p.specKind}
                        options={[
                          { value: "text", label: t.reviewKindText },
                          { value: "number", label: t.reviewKindNumber },
                        ]}
                        onChange={(specKind) => review.update(i, { ...p, specKind })}
                      />
                      <ToggleRow
                        label={t.reviewInTable}
                        hint={p.inTable ? undefined : t.mobileShownInRow}
                        checked={p.inTable}
                        // One switch, two flags, as on desktop: the review
                        // offers table or expanded row; the column editor has
                        // the rest.
                        onChange={(checked) =>
                          review.update(i, { ...p, inTable: checked, inDetail: !checked })
                        }
                      />
                      <ToggleRow
                        label={t.reviewFilterable}
                        checked={p.filterable}
                        onChange={(filterable) => review.update(i, { ...p, filterable })}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {missing.length > 0 && (
        <section className="mtx-section">
          <SectionHeading count={formatInt(missing.length, locale)}>{t.reviewMissing}</SectionHeading>
          <div className="mtx-cards">
            {missing.map((column) => {
              const dropping = review.dropKeys.includes(column.key);
              return (
                <div key={column.key} className="mtx-card">
                  <div>
                    <p className="mtx-card-key" dir="ltr">{column.key}</p>
                    <p className="mtx-hint">
                      {column.productCount > 0
                        ? t.reviewHasValues.replace("{n}", formatInt(column.productCount, locale))
                        : t.reviewNoValues}
                    </p>
                  </div>
                  <Segmented
                    label={column.key}
                    value={dropping ? "delete" : "keep"}
                    options={[
                      { value: "keep", label: t.reviewKeep },
                      { value: "delete", label: t.reviewDelete },
                    ]}
                    onChange={(choice) =>
                      review.setDropKeys((previous) =>
                        choice === "delete"
                          ? [...previous.filter((key) => key !== column.key), column.key]
                          : previous.filter((key) => key !== column.key),
                      )
                    }
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {matched.length > 0 && (
        <section className="mtx-section">
          <SectionHeading count={formatInt(matched.length, locale)}>{t.reviewMatched}</SectionHeading>
          <p className="mtx-matched" dir="ltr">
            {matched
              .map(({ h }) => (h.plan.role === "builtin" ? `${h.plan.header} → ${h.plan.field}` : h.plan.header))
              .join(", ")}
          </p>
        </section>
      )}

      <div className="mtx-bottom-bar mtx-layer-bar">
        {blocked && (
          <p className="mtx-field-error mtx-bar-note">
            {blockedNote(t, review.blockedBy)}
          </p>
        )}
        {review.tableColumns > MAX_LEGIBLE_COLUMNS && (
          <p className="mtx-hint mtx-bar-note">{t.columnsTooMany}</p>
        )}
        <button
          type="submit"
          name="stage"
          value="apply"
          className="mtx-button mtx-primary mtx-wide"
          disabled={pending || blocked}
        >
          {importing === 1
            ? t.mobileImportOneRow
            : t.mobileImportRows.replace("{n}", formatInt(importing, locale))}
        </button>
      </div>
    </div>
  );
}
