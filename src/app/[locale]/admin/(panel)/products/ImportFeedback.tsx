"use client";

import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import type { ImportState } from "@/lib/catalogImport";

const MAX_SHOWN = 200;

/** The existing import result surface, shared by the old list and workbench. */
export function ImportFeedback({
  state,
  locale,
}: {
  state: Exclude<ImportState, { kind: "review" }>;
  locale: Locale;
}) {
  const t = getDict(locale);

  if (state.kind === "ok") {
    const columnNotes = [
      state.addedColumns > 0 &&
        t.importAddedColumns.replace("{n}", formatInt(state.addedColumns, locale)),
      state.droppedColumns > 0 &&
        t.importDroppedColumns.replace("{n}", formatInt(state.droppedColumns, locale)),
      state.removed > 0 &&
        t.importRemoved.replace("{n}", formatInt(state.removed, locale)),
      state.skipped.length > 0 &&
        t.importSkipped.replace(
          "{n}",
          formatInt(new Set(state.skipped.map((error) => error.row)).size, locale),
        ),
    ].filter((note): note is string => Boolean(note));

    return (
      <>
        <p className="mt-1.5 border border-[#b6d7bb] bg-[#f0f8f1] px-2.5 py-1.5 text-[12px]">
          {t.importSummary
            .replace("{inserted}", formatInt(state.inserted, locale))
            .replace("{updated}", formatInt(state.updated, locale))}
          {columnNotes.length > 0 && ` ${columnNotes.join(" · ")}.`}
        </p>
        {state.priceless.length > 0 && (
          <div className="mt-1.5 border border-[var(--color-warn-line)] bg-[var(--color-warn-soft)] px-2.5 py-1.5">
            <p className="mb-1 text-[12px] font-bold">{t.importPriceless}</p>
            <p className="tech text-[11px]">
              {state.priceless.slice(0, MAX_SHOWN).join(", ")}
              {state.priceless.length > MAX_SHOWN &&
                ` + ${formatInt(state.priceless.length - MAX_SHOWN, locale)}`}
            </p>
          </div>
        )}
        {state.mismatches.length > 0 && (
          <div className="mt-1.5 border border-[var(--color-warn-line)] bg-[var(--color-warn-soft)] px-2.5 py-1.5">
            <p className="mb-1 text-[12px] font-bold">{t.importInventoryMismatch}</p>
            <ul className="grid gap-0.5 text-[11px]">
              {state.mismatches.slice(0, MAX_SHOWN).map((mismatch, index) => (
                <li key={index}>
                  <span className="tech font-semibold">{mismatch.partNumber}</span>{" "}
                  <span className="tech">{mismatch.column}</span>:{" "}
                  <span className="tech">{formatInt(mismatch.uploaded, locale)}</span> →{" "}
                  <span className="tech">{formatInt(mismatch.computed, locale)}</span>{" "}
                  <span className="text-[var(--color-ink-muted)]">({t.importFromOrders})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  if (state.kind === "message") {
    const message =
      state.message === "no-file"
        ? t.importNoFile
        : state.message === "too-large"
          ? t.importTooLarge
          : state.message === "storage-missing"
            ? t.importStorageMissing
            : state.message === "upload-failed"
              ? t.importUploadFailed
              : state.message === "rate-limit"
                ? t.rateLimited
                : state.message === "bad-plan"
                  ? t.importBadPlan
                  : state.message === "all-rows-skipped"
                    ? t.importAllSkipped
                    : t.importFamilyGone;
    return <ImportProblem>{message}</ImportProblem>;
  }

  if (state.kind === "conflicts" || state.kind === "case-variants") {
    return (
      <ImportProblem>
        {state.kind === "conflicts" ? t.importWrongFamily : t.importCaseVariant}{" "}
        <span className="tech">{state.parts.slice(0, MAX_SHOWN).join(", ")}</span>
      </ImportProblem>
    );
  }

  const shown = state.errors.slice(0, MAX_SHOWN);
  return (
    <div className="mt-1.5 border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5">
      <p className="mb-1 text-[12px] font-bold text-[var(--color-danger)]">
        {t.importNothingWritten}
      </p>
      <table className="spec-table">
        <thead>
          <tr>
            <th className="num">{t.importRow}</th>
            <th>{t.importColumn}</th>
            <th>{t.importProblem}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((error, index) => (
            <tr key={index}>
              <td className="num tech tech-num">{formatInt(error.row, locale)}</td>
              <td className="tech">{error.column}</td>
              <td className="whitespace-normal">{error.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.errors.length > shown.length && (
        <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
          + {formatInt(state.errors.length - shown.length, locale)}
        </p>
      )}
    </div>
  );
}

function ImportProblem({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5 text-[12px] text-[var(--color-danger)]">
      {children}
    </p>
  );
}
