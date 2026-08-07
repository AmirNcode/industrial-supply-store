"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A confirmation step in front of a form that is already filled in.
 *
 * Every button this wraps does something a customer sees and staff cannot take
 * back from the queue: issuing an invoice, recording a payment, marking goods
 * shipped. The summary is built from the form's own current values at the
 * moment of the click, not from props alone, so what it shows is what will
 * actually be submitted — including the prices someone just typed.
 *
 * The overlay is a plain element rendered inside the form rather than a
 * <dialog>. That keeps Continue an ordinary submit button belonging to the
 * enclosing form, so the Server Action fires exactly as it would without this
 * component in the way, and there is no portal to move focus or values across.
 */

export type ConfirmDetail = { label: string; value: string; tech?: boolean };
/** A field to read off the form and show, e.g. the payment link just pasted. */
export type ConfirmEcho = { name: string; label: string; tech?: boolean };
/** Lines whose `price_<id>` inputs are totalled for the summary. */
export type ConfirmLine = { id: number; qty: number };

export function ConfirmSubmit({
  label,
  title,
  continueLabel,
  discardLabel,
  disabled,
  details = [],
  echo = [],
  lines = [],
  totalLabel,
  className = "btn-small",
}: {
  label: string;
  title: string;
  continueLabel: string;
  discardLabel: string;
  disabled?: boolean;
  details?: ConfirmDetail[];
  echo?: ConfirmEcho[];
  lines?: ConfirmLine[];
  totalLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<ConfirmDetail[]>([]);
  const [total, setTotal] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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

    if (lines.length > 0) {
      // Mirrors the server: cents per unit, rounded once, then multiplied.
      const cents = lines.reduce((sum, ln) => {
        const price = Number(data.get(`price_${ln.id}`) ?? 0);
        return sum + (Number.isFinite(price) ? Math.round(price * 100) * ln.qty : 0);
      }, 0);
      setTotal((cents / 100).toFixed(2));
    }
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
            role="dialog"
            aria-modal="true"
            aria-label={title}
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
              {total !== null && totalLabel && (
                <div className="contents">
                  <dt className="border-t border-[var(--color-rule)] pt-1 font-bold">
                    {totalLabel}
                  </dt>
                  <dd className="tech border-t border-[var(--color-rule)] pt-1 font-bold">
                    ${total}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-4 flex justify-end gap-2 border-t border-[var(--color-rule)] pt-3">
              <button type="button" className="btn-small" onClick={() => setOpen(false)}>
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
