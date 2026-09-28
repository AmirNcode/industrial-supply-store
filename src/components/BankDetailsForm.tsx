"use client";

import { useState } from "react";
import { validateBankFields, type BankFields, type BankProblem } from "@/lib/bankDetails";

const FIELDS: { field: keyof BankFields; input: string; kind: "text" | "number" | "note"; dir: "ltr" | "rtl" }[] = [
  { field: "nameFa", input: "bankNameFa", kind: "text", dir: "rtl" },
  { field: "nameEn", input: "bankNameEn", kind: "text", dir: "ltr" },
  { field: "holderFa", input: "bankHolderFa", kind: "text", dir: "rtl" },
  { field: "holderEn", input: "bankHolderEn", kind: "text", dir: "ltr" },
  { field: "card", input: "bankCard", kind: "number", dir: "ltr" },
  { field: "sheba", input: "bankSheba", kind: "number", dir: "ltr" },
  { field: "account", input: "bankAccount", kind: "number", dir: "ltr" },
  { field: "noteFa", input: "bankNoteFa", kind: "note", dir: "rtl" },
  { field: "noteEn", input: "bankNoteEn", kind: "note", dir: "ltr" },
];

export type BankFormLabels = {
  fields: Record<keyof BankFields, string>;
  problems: Record<BankProblem, string>;
  save: string;
};

/**
 * Checked in the browser with the very function the server runs again, so a
 * mistyped card number is caught while the other eight fields are still on
 * screen instead of after a round trip that clears them. Invalid input never
 * leaves the page; valid input goes to the Server Action, which re-validates.
 */
export function BankDetailsForm({
  action,
  locale,
  initial,
  labels,
  disabled,
}: {
  action: (formData: FormData) => Promise<void>;
  locale: string;
  initial: BankFields;
  labels: BankFormLabels;
  disabled: boolean;
}) {
  const [problems, setProblems] = useState<BankProblem[]>([]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const values = Object.fromEntries(
      FIELDS.map(({ field, input }) => [field, String(data.get(input) ?? "")]),
    ) as BankFields;
    const result = validateBankFields(values);
    if (!result.ok) {
      event.preventDefault();
      setProblems(result.problems);
    } else {
      setProblems([]);
    }
  }

  return (
    <form action={action} onSubmit={onSubmit} className="grid max-w-[680px] gap-3 sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      {problems.length > 0 && (
        <ul
          role="alert"
          className="border border-[var(--color-danger)] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[var(--color-danger)] sm:col-span-2"
        >
          {problems.map((problem) => (
            <li key={problem}>{labels.problems[problem]}</li>
          ))}
        </ul>
      )}
      {FIELDS.map(({ field, input, kind, dir }) => (
        <label
          key={field}
          className={`grid gap-0.5 text-[11px] font-semibold ${kind === "note" ? "sm:col-span-2" : ""}`}
        >
          {labels.fields[field]}
          {kind === "note" ? (
            <textarea name={input} rows={3} maxLength={1000} dir={dir} defaultValue={initial[field]} disabled={disabled} />
          ) : (
            <input
              type="text"
              name={input}
              dir={dir}
              defaultValue={initial[field]}
              maxLength={kind === "number" ? 40 : 200}
              inputMode={field === "card" || field === "account" ? "numeric" : undefined}
              autoComplete="off"
              disabled={disabled}
            />
          )}
        </label>
      ))}
      <button type="submit" className="btn-small justify-self-start sm:col-span-2" disabled={disabled}>
        {labels.save}
      </button>
    </form>
  );
}
