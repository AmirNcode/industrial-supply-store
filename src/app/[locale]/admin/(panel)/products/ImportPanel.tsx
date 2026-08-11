"use client";

import { useActionState } from "react";
import Link from "next/link";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { importCsvAction, type ImportState } from "./actions";
import { ColumnReview } from "./ColumnReview";
import type { FamilyListRow } from "@/db/importQueries";

/**
 * One `useActionState` for the whole page rather than one per family.
 *
 * Every family's form posts to the same action, and the result carries the
 * family it came from, so it renders under the row that was submitted. A
 * hundred-odd families each holding their own state would be a hundred-odd
 * pieces of state to keep in step for a page where only one upload can be in
 * flight at a time.
 */

/** A long file can fail on thousands of rows; the first screenful is what
 *  someone acts on, and rendering all of them would lock the tab. */
const MAX_SHOWN = 200;

export function ImportPanel({
  families,
  locale,
  demo,
}: {
  families: FamilyListRow[];
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  const [state, formAction, isPending] = useActionState<ImportState | null, FormData>(
    importCsvAction,
    null,
  );

  const groups: { id: number; name: string; families: FamilyListRow[] }[] = [];
  for (const f of families) {
    const name = locale === "fa" ? f.categoryNameFa : f.categoryNameEn;
    const last = groups[groups.length - 1];
    if (last && last.id === f.categoryId) last.families.push(f);
    else groups.push({ id: f.categoryId, name, families: [f] });
  }

  return (
    <div className="grid gap-5">
      {groups.map((g) => (
        <section key={g.id}>
          <h2 className="mb-1 border-b border-[var(--color-rule)] pb-0.5 text-[13px] font-bold">
            {g.name}
          </h2>
          <div className="grid gap-1">
            {g.families.map((f) => (
              <div key={f.id} className="border-b border-[var(--color-rule-light)] py-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                  <span className="font-semibold">
                    {locale === "fa" ? f.nameFa : f.nameEn}
                  </span>
                  <span className="tech text-[11px] text-[var(--color-ink-muted)]">
                    {formatInt(f.productCount, locale)}
                  </span>
                  {/* Stock at a glance, in the same packs as every order line.
                      On-hold and sold are only shown when non-zero so a family
                      nobody has ordered stays quiet. */}
                  <span className="text-[11px] text-[var(--color-ink-muted)]">
                    {t.stockAvailable}:{" "}
                    <span className="tech font-semibold">
                      {formatInt(f.inventoryAvailable, locale)}
                    </span>
                    {f.inventoryOnHold > 0 && (
                      <>
                        {" · "}
                        {t.stockOnHold}:{" "}
                        <span className="tech">{formatInt(f.inventoryOnHold, locale)}</span>
                      </>
                    )}
                    {f.inventorySold > 0 && (
                      <>
                        {" · "}
                        {t.stockSold}:{" "}
                        <span className="tech">{formatInt(f.inventorySold, locale)}</span>
                      </>
                    )}
                  </span>
                  <a
                    className="text-[11px]"
                    href={`/api/admin/family/${f.id}/template`}
                    download
                  >
                    {t.downloadTemplate}
                  </a>
                  <a
                    className="text-[11px]"
                    href={`/api/admin/family/${f.id}/export`}
                    download
                  >
                    {t.exportProducts}
                  </a>
                  <Link className="text-[11px]" href={`/${locale}/admin/products/${f.id}/columns`}>
                    {t.editColumns}
                  </Link>

                  {/* The review panel lives inside this form on purpose: the
                      chosen file is still in the input, so confirming posts the
                      same bytes back with the decisions rather than asking for
                      the file a second time. */}
                  <form action={formAction} className="ms-auto flex flex-1 flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                      <input type="hidden" name="familyId" value={f.id} />
                      <input
                        type="file"
                        name="file"
                        accept=".csv,text/csv"
                        disabled={demo}
                        className="text-[11px]"
                      />
                      <button
                        type="submit"
                        className="btn-small"
                        disabled={demo || isPending}
                      >
                        {t.uploadCsv}
                      </button>
                    </div>

                    {state?.kind === "review" && state.familyId === f.id && (
                      <div className="w-full text-start">
                        <ColumnReview
                          // Remounting per upload throws away the decisions made
                          // about the previous file, which no longer describe
                          // this one.
                          key={state.headers.map((h) => h.plan.header).join("|")}
                          headers={state.headers}
                          missing={state.missing}
                          rowCount={state.rowCount}
                          problems={state.problems}
                          locale={locale}
                          pending={isPending}
                        />
                      </div>
                    )}
                  </form>
                </div>

                {state && state.kind !== "review" && state.familyId === f.id && (
                  <Result state={state} locale={locale} />
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Result({
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
    ].filter((s): s is string => Boolean(s));

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
            {/* Allowed — pricing happens on the phone — but the other way to
                arrive here is clearing the column by accident in Excel. */}
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
            {/* The upload was applied — it is the operator's stated intent, and
                refusing it would make a stale export impossible to correct.
                This is so the disagreement is noticed rather than absorbed. */}
            <p className="mb-1 text-[12px] font-bold">{t.importInventoryMismatch}</p>
            <ul className="grid gap-0.5 text-[11px]">
              {state.mismatches.slice(0, MAX_SHOWN).map((m, i) => (
                <li key={i}>
                  <span className="tech font-semibold">{m.partNumber}</span>{" "}
                  <span className="tech">{m.column}</span>:{" "}
                  <span className="tech">{formatInt(m.uploaded, locale)}</span> →{" "}
                  <span className="tech">{formatInt(m.computed, locale)}</span>{" "}
                  <span className="text-[var(--color-ink-muted)]">
                    ({t.importFromOrders})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  if (state.kind === "message") {
    const text =
      state.message === "no-file"
        ? t.importNoFile
        : state.message === "too-large"
          ? t.importTooLarge
          : state.message === "bad-plan"
            ? t.importBadPlan
            : t.importFamilyGone;
    return <Problem>{text}</Problem>;
  }

  if (state.kind === "conflicts" || state.kind === "case-variants") {
    return (
      <Problem>
        {state.kind === "conflicts" ? t.importWrongFamily : t.importCaseVariant}{" "}
        <span className="tech">{state.parts.slice(0, MAX_SHOWN).join(", ")}</span>
      </Problem>
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
          {shown.map((e, i) => (
            <tr key={i}>
              <td className="num tech tech-num">{formatInt(e.row, locale)}</td>
              <td className="tech">{e.column}</td>
              <td className="whitespace-normal">{e.message}</td>
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

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5 text-[12px] text-[var(--color-danger)]">
      {children}
    </p>
  );
}
