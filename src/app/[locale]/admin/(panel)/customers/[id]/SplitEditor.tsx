"use client";

import { useEffect, useRef, useState } from "react";
import { leadRepId, MAX_ACCOUNT_REPS, parseSharePercent } from "@/lib/commissionSplit";
import type { Dict } from "@/lib/i18n";

export type SplitRepOption = { id: string; name: string; active: boolean; rateLabel: string };
export type SplitInitialRow = { repId: string; share: string };

type Row = SplitInitialRow & { key: number };

/**
 * The account's reps, shares and rate. Rows are arranged here and posted ONCE
 * through the plain form below; the server validates again and is the only
 * authority, so the running total is a convenience. Every control is a native
 * select, input or button (keyboard works as is), and the rows the page was
 * rendered with still post if this script never loads.
 *
 * Reps import nothing from `repAccount` here: that module pulls in node:crypto,
 * which has no place in a client bundle, so the rate labels arrive formatted.
 */
export function SplitEditor({
  action,
  hidden,
  reps,
  initialRows,
  initialRate,
  locale,
  labels,
  disabled,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hidden: Record<string, string>;
  reps: SplitRepOption[];
  initialRows: SplitInitialRow[];
  initialRate: string;
  locale: "en" | "fa";
  labels: Pick<
    Dict,
    | "adminSharePercent"
    | "adminShareHint"
    | "adminAccountRate"
    | "adminAccountRateHint"
    | "adminSplitAppliesHint"
    | "adminAddRep"
    | "adminRemoveRep"
    | "adminShareTotal"
    | "adminChooseRep"
    | "adminNoRepsState"
    | "adminInactiveShareTag"
    | "repStatusInactive"
    | "repName"
    | "save"
  >;
  disabled: boolean;
}) {
  const nextKey = useRef(initialRows.length);
  const [rows, setRows] = useState<Row[]>(() => initialRows.map((row, i) => ({ ...row, key: i })));
  const focusKey = useRef<number | null>(null);
  const byId = new Map(reps.map((rep) => [rep.id, rep]));

  // A row added by keyboard should leave focus where the next thing to type is.
  useEffect(() => {
    if (focusKey.current === null) return;
    document.querySelector<HTMLSelectElement>(`[data-row-key="${focusKey.current}"] select`)?.focus();
    focusKey.current = null;
  }, [rows.length]);

  const update = (key: number, patch: Partial<SplitInitialRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const add = () => {
    const key = nextKey.current++;
    focusKey.current = key;
    setRows((current) => [...current, { key, repId: "", share: "" }]);
  };
  const remove = (key: number) => setRows((current) => current.filter((row) => row.key !== key));

  // A row with no rep chosen is refused by the server; it does not count toward the total here.
  const chosen = rows.filter((row) => row.repId !== "");
  const parsed = chosen.map((row) => parseSharePercent(row.share));
  const anyFilled = parsed.some((share) => share !== null);
  const total = parsed.reduce<number>((sum, share) => sum + (typeof share === "number" ? share / 100 : 0), 0);
  const lead = leadRepId(
    chosen.map((row, i) => ({ repId: row.repId, shareBp: typeof parsed[i] === "number" ? parsed[i] : null })),
  );
  const leadRep = lead ? byId.get(lead) : undefined;
  const number = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US");

  return (
    <form action={action} className="grid max-w-[680px] gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {rows.length === 0 ? (
        <p className="border border-[var(--color-rule)] p-2 text-[12px]" data-testid="split-unassigned">
          {labels.adminNoRepsState}
        </p>
      ) : (
        <div className="grid gap-1.5">
          <div className="grid grid-cols-[1fr_110px_auto] gap-2 text-[11px] font-semibold">
            <span>{labels.repName}</span>
            <span>{labels.adminSharePercent}</span>
            <span aria-hidden="true" />
          </div>
          {rows.map((row) => {
            const rep = byId.get(row.repId);
            return (
              <div key={row.key} data-row-key={row.key} className="grid grid-cols-[1fr_110px_auto] items-center gap-2">
                <div className="grid gap-0.5">
                  <select
                    name="repId"
                    value={row.repId}
                    onChange={(event) => update(row.key, { repId: event.target.value })}
                    aria-label={labels.repName}
                    required
                    disabled={disabled}
                  >
                    <option value="">{labels.adminChooseRep}</option>
                    {reps.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.active ? option.name : `${option.name} (${labels.repStatusInactive})`}
                      </option>
                    ))}
                  </select>
                  {rep && !rep.active && (
                    <span className="text-[11px] text-[var(--color-ink-muted)]">{labels.adminInactiveShareTag}</span>
                  )}
                </div>
                <input
                  type="text"
                  name="share"
                  value={row.share}
                  onChange={(event) => update(row.key, { share: event.target.value })}
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={6}
                  aria-label={labels.adminSharePercent}
                  disabled={disabled}
                />
                <button type="button" className="btn-small" onClick={() => remove(row.key)} disabled={disabled}>
                  {labels.adminRemoveRep}
                </button>
              </div>
            );
          })}
          <p className="text-[11px]" data-testid="split-total" aria-live="polite">
            {labels.adminShareTotal}: {anyFilled ? number.format(total) : "—"}
          </p>
        </div>
      )}

      {rows.length < MAX_ACCOUNT_REPS && (
        <button type="button" className="btn-small justify-self-start" onClick={add} disabled={disabled}>
          {labels.adminAddRep}
        </button>
      )}
      <p className="text-[11px] text-[var(--color-ink-muted)]">{labels.adminShareHint}</p>

      <label className="grid max-w-[260px] gap-0.5 text-[11px] font-semibold">
        {labels.adminAccountRate}
        <input
          type="text"
          name="rate"
          defaultValue={initialRate}
          inputMode="decimal"
          dir="ltr"
          maxLength={8}
          disabled={disabled}
        />
      </label>
      {leadRep && (
        <p className="text-[11px] text-[var(--color-ink-muted)]" data-testid="split-rate-hint">
          {labels.adminAccountRateHint.replace("{name}", leadRep.name).replace("{rate}", leadRep.rateLabel)}
        </p>
      )}
      <p className="text-[11px] text-[var(--color-ink-muted)]">{labels.adminSplitAppliesHint}</p>

      <button type="submit" className="btn-small justify-self-start" disabled={disabled}>
        {labels.save}
      </button>
    </form>
  );
}
