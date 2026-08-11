"use client";

import { useActionState, useState } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { deleteCatalogAction, type DeleteState } from "./actions";

/**
 * Deleting a family, or a category and everything beneath it.
 *
 * Guarded by typing the word rather than by a confirm dialog. This button sits
 * in a list of a hundred rows, it is the only thing on the page that cannot be
 * undone, and a dialog next to a button is one mis-aimed click away from being
 * dismissed by the same gesture that opened it.
 *
 * The count of what would go is shown before the field appears, because
 * "delete Valves" and "delete Valves, 4 families, 558 products" are different
 * decisions.
 */
export function DeleteControl({
  what,
  id,
  name,
  products,
  families,
  ordered,
  locale,
  demo,
}: {
  what: "family" | "category";
  id: number;
  name: string;
  products: number;
  /** Only meaningful for a category. */
  families?: number;
  /** Products with a past order against them; they survive as order snapshots. */
  ordered: number;
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  const [state, formAction, isPending] = useActionState<DeleteState | null, FormData>(
    deleteCatalogAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  if (state?.kind === "deleted") {
    return (
      <span className="text-[11px] text-[var(--color-ink-muted)]">
        {t.deleteDone.replace("{name}", state.name)}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-tiny"
        disabled={demo}
        onClick={() => setOpen(true)}
      >
        {t.reviewDelete}
      </button>
    );
  }

  return (
    <form action={formAction} className="inline-flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="what" value={what} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="products" value={products} />

      <span className="text-[11px] text-[var(--color-danger)]">
        {(what === "category" ? t.deleteCategoryWarn : t.deleteFamilyWarn)
          .replace("{name}", name)
          .replace("{families}", formatInt(families ?? 0, locale))
          .replace("{products}", formatInt(products, locale))}
        {ordered > 0 && ` ${t.deleteOrdered.replace("{n}", formatInt(ordered, locale))}`}
      </span>

      <input
        name="confirm"
        className="admin-input w-24"
        placeholder={t.deleteType}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoFocus
      />
      <button
        type="submit"
        className="btn-tiny"
        disabled={demo || isPending || typed.trim().toUpperCase() !== "DELETE"}
      >
        {t.reviewDelete}
      </button>
      <button
        type="button"
        className="btn-tiny"
        onClick={() => {
          setOpen(false);
          setTyped("");
        }}
      >
        {t.fxCancel}
      </button>

      {state?.kind === "error" && (
        <span className="text-[11px] text-[var(--color-danger)]">
          {state.message === "not-found" ? t.importFamilyGone : t.deleteNotConfirmed}
        </span>
      )}
    </form>
  );
}
