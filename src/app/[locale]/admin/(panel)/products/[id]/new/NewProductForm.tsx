"use client";

import { useRef, useState, useTransition } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import type { FamilySpecDef } from "@/db/importQueries";
import { createProductAction, type CreateProductState } from "./actions";

/**
 * The technical fields come from the family's own columns, so this form needs
 * no code of its own when a family gains or loses one — the same rule the spec
 * table and the importer already follow.
 */
export function NewProductForm({
  familyId,
  defs,
  locale,
  demo,
}: {
  familyId: number;
  defs: FamilySpecDef[];
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<CreateProductState | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createProductAction(familyId, data);
      setState(result);
      // Clearing only on success keeps a rejected entry on screen to correct,
      // and makes the next similar product one edit rather than a full retype.
      if (result.kind === "ok") formRef.current?.reset();
    });
  }

  const problem =
    state?.kind === "error"
      ? state.message === "bad-number"
        ? t.newProductBadNumber.replace("{column}", state.column ?? "")
        : state.message === "bad-price"
          ? t.newProductBadPrice
          : state.message === "bad-pack"
            ? t.newProductBadPack
            : state.message === "bad-lead" || state.message === "bad-inventory"
              ? t.newProductBadCount
              : state.message === "bad-image"
                ? t.newProductBadImage
                : state.message === "wrong-family"
                  ? t.importWrongFamily
                  : state.message === "already-exists"
                    ? t.newProductAlreadyExists
                  : state.message === "reserved"
                    ? t.importReservedNumber
                  : state.message === "numbers-exhausted"
                    ? t.importNumbersExhausted
                  : state.message === "case-variant"
                    ? t.importCaseVariant
                    : t.newProductFailed
      : null;

  return (
    <form ref={formRef} onSubmit={submit} className="max-w-2xl">
      <fieldset disabled={demo || pending} className="grid gap-3">
        <div className="grid gap-0.5 text-[12px]">
          <label className="font-bold" htmlFor="part_number">
            {t.partNumber}
          </label>
          <input
            id="part_number"
            name="part_number"
            className="admin-input"
            aria-describedby="part_number_hint"
            autoComplete="off"
          />
          <span id="part_number_hint" className="text-[11px] text-[var(--color-ink-muted)]">
            {t.newProductPartNumberHint}
          </span>
        </div>

        {defs.length > 0 && (
          <section className="grid gap-2">
            <h2 className="text-[13px] font-bold">{t.newProductSpecs}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {defs.map((def) => (
                <label key={def.key} className="grid gap-0.5 text-[12px]">
                  <span className="font-bold">
                    {locale === "fa" ? def.labelFa : def.labelEn}
                    {def.unit && (
                      <span className="tech font-normal text-[var(--color-ink-muted)]">
                        {" "}
                        ({def.unit})
                      </span>
                    )}
                  </span>
                  <input
                    name={`spec.${def.key}`}
                    className="admin-input"
                    inputMode={def.kind === "number" ? "decimal" : undefined}
                    autoComplete="off"
                  />
                </label>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-2">
          <h2 className="text-[13px] font-bold">{t.newProductCommercial}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-0.5 text-[12px]">
              <label className="font-bold" htmlFor="price_usd">
                {t.price}
              </label>
              <input
                id="price_usd"
                name="price_usd"
                className="admin-input"
                inputMode="decimal"
                aria-describedby="price_usd_hint"
                autoComplete="off"
              />
              <span id="price_usd_hint" className="text-[11px] text-[var(--color-ink-muted)]">
                {t.newProductPriceHint}
              </span>
            </div>
            <label className="grid gap-0.5 text-[12px]">
              <span className="font-bold">{t.packQty}</span>
              <input name="pack_qty" className="admin-input" inputMode="numeric" defaultValue="1" />
            </label>
            <label className="grid gap-0.5 text-[12px]">
              <span className="font-bold">{t.leadTime}</span>
              <input name="lead_days" className="admin-input" inputMode="numeric" defaultValue="0" />
            </label>
            <label className="grid gap-0.5 text-[12px]">
              <span className="font-bold">{t.stockAvailable}</span>
              <input
                name="inventory_available"
                className="admin-input"
                inputMode="numeric"
                defaultValue="0"
              />
            </label>
            <label className="grid gap-0.5 text-[12px] sm:col-span-2">
              <span className="font-bold">{t.newProductImage}</span>
              <input name="image_url" className="admin-input" autoComplete="off" />
            </label>
            <label className="flex items-center gap-1.5 text-[12px] font-bold">
              <input type="checkbox" name="in_stock" defaultChecked />
              {t.inStock}
            </label>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-small">
            {t.newProduct}
          </button>
          {state?.kind === "ok" && (
            <p className="text-[12px] font-bold">
              {t.newProductCreated.replace("{part}", state.partNumber)}
            </p>
          )}
          {problem && <p className="text-[12px] text-[var(--color-danger)]">{problem}</p>}
        </div>
      </fieldset>
    </form>
  );
}
