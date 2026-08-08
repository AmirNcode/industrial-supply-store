"use client";

import Link from "next/link";
import { useActionState } from "react";
import { quickOrderAction, type QuickOrderResult } from "@/app/actions";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";

/**
 * Procurement teams paste straight out of a spreadsheet, so the result panel
 * has to report both halves honestly: what went in the cart, and what did not
 * match. Silently dropping unmatched lines would be the worst possible failure
 * mode for a buyer working from a bill of materials.
 */
export function QuickOrderForm({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const [state, formAction, pending] = useActionState<QuickOrderResult | null, FormData>(
    quickOrderAction,
    null,
  );

  return (
    <>
      <form action={formAction}>
        <textarea
          name="lines"
          rows={10}
          placeholder={t.quickOrderPlaceholder}
          spellCheck={false}
          dir="ltr"
          className="tech w-full font-mono text-[12px]"
        />
        <div className="mt-2 flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "…" : t.addAllToOrder}
          </button>
          <Link href={`/${locale}/cart`} className="text-[12px]">
            {t.yourOrder}
          </Link>
        </div>
      </form>

      {state && (
        <div className="mt-4 border-t border-[var(--color-rule)] pt-3">
          {state.added.length > 0 && (
            <div className="mb-3">
              <h2 className="mb-1 text-[13px] font-bold text-[var(--color-navy)]">
                {t.added} — <span className="tech">{formatInt(state.added.length, locale)}</span>
              </h2>
              <ul className="text-[12px]">
                {state.added.map((a) => (
                  <li key={a.partNumber} className="tech">
                    {a.partNumber} × {a.qty}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.notFound.length > 0 && (
            <div>
              <h2 className="mb-1 text-[13px] font-bold text-[#a3312a]">
                {t.notFound} — <span className="tech">{formatInt(state.notFound.length, locale)}</span>
              </h2>
              <ul className="text-[12px]">
                {state.notFound.map((pn) => (
                  <li key={pn} className="tech">
                    {pn}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
