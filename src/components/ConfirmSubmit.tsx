"use client";

import { useRef, useState } from "react";
import { useModalFocus } from "@/lib/useModalFocus";

/**
 * A confirmation step in front of a form that is already filled in.
 *
 * Every button this wraps does something a customer sees and staff cannot take
 * back from the queue: finalizing an invoice, recording a payment, marking
 * goods shipped. The summary is built from the form's own current values at
 * the moment of the click, not from props alone, so what it shows is what will
 * actually be submitted — including the tracking number someone just typed.
 *
 * The overlay is a plain element rendered inside the form rather than a
 * <dialog>. That keeps Continue an ordinary submit button belonging to the
 * enclosing form, so the Server Action fires exactly as it would without this
 * component in the way, and there is no portal to move focus or values across.
 */

export type ConfirmDetail = { label: string; value: string; tech?: boolean };
/** A field to read off the form and show, e.g. the tracking number just typed. */
export type ConfirmEcho = { name: string; label: string; tech?: boolean };

export function ConfirmSubmit({
  label,
  title,
  continueLabel,
  discardLabel,
  disabled,
  details = [],
  echo = [],
  className = "btn-small",
}: {
  label: string;
  title: string;
  continueLabel: string;
  discardLabel: string;
  disabled?: boolean;
  details?: ConfirmDetail[];
  echo?: ConfirmEcho[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<ConfirmDetail[]>([]);
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocus(open, dialogRef, openerRef, () => setOpen(false));

  const review = () => {
    const form = openerRef.current?.form;
    if (!form) return;
    // Let the browser's own validation run first. A summary of a form that
    // cannot submit is a confirmation of something that will not happen.
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    setLive(
      echo
        .map((f) => ({ label: f.label, value: String(data.get(f.name) ?? "").trim(), tech: f.tech }))
        .filter((d) => d.value !== ""),
    );

    setOpen(true);
  };

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className={className}
        disabled={disabled}
        onClick={review}
      >
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          // A click on the backdrop is a discard, like Escape. Clicks inside
          // the panel must not bubble out and close it.
          onClick={() => setOpen(false)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className="max-h-[80vh] w-full max-w-[460px] overflow-auto border border-[var(--color-ink)] bg-white p-4 text-start"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 border-b border-[var(--color-rule)] pb-1 text-[14px] font-bold">
              {title}
            </h2>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
              {[...details, ...live].map((d, i) => (
                <div key={i} className="contents">
                  <dt className="font-bold">{d.label}</dt>
                  <dd className={d.tech ? "tech break-all" : "break-words"}>{d.value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 flex justify-end gap-2 border-t border-[var(--color-rule)] pt-3">
              <button
                data-dialog-initial-focus
                type="button"
                className="btn-small"
                onClick={() => setOpen(false)}
              >
                {discardLabel}
              </button>
              {/* An ordinary submit button for the enclosing form — this is
                  what makes the Server Action fire unchanged. */}
              <button type="submit" className="btn-primary">
                {continueLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
