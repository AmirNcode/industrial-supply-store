import { getDict, type Locale } from "@/lib/i18n";
import { formatPersianDate } from "@/lib/persianCalendar";
import type { CustomerNote } from "@/db/noteQueries";

/**
 * A customer's notes, newest first, with the form that adds one. Shared by the
 * rep's customer page and the admin's, which differ only in the action and the
 * hidden fields that identify the customer. Append-only by design: a note is a
 * record of what was said, so there is nothing to edit or delete.
 */
export function CustomerNotes({
  locale,
  notes,
  action,
  hidden,
  disabled,
}: {
  locale: Locale;
  notes: CustomerNote[];
  action: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  disabled?: boolean;
}) {
  const t = getDict(locale);
  return (
    <section id="notes" className="mb-4 border border-[var(--color-rule)] p-3">
      <h2 className="mb-1 text-[13px] font-bold">{t.customerNotes}</h2>
      <p className="mb-2 text-[11px] text-[var(--color-ink-muted)]">{t.customerNotesHint}</p>
      <form action={action} className="mb-3 grid max-w-[680px] gap-2">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <textarea
          name="body"
          rows={3}
          maxLength={2000}
          required
          aria-label={t.customerNotes}
          disabled={disabled}
        />
        <button type="submit" className="btn-small justify-self-start" disabled={disabled}>
          {t.addNote}
        </button>
      </form>
      {notes.length === 0 ? (
        <p className="text-[12px] text-[var(--color-ink-muted)]">{t.noNotesYet}</p>
      ) : (
        <ol className="grid gap-2">
          {notes.map((note) => (
            <li key={note.id} className="border-t border-[var(--color-rule)] pt-2 text-[12px]">
              <p className="whitespace-pre-line">{note.body}</p>
              <p className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">
                {note.authorName ?? t.noteByAdmin} · {formatPersianDate(note.createdAt, locale)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
