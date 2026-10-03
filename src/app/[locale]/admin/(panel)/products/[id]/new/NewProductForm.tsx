"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import type { FamilySpecDef } from "@/db/importQueries";
import { createProductAction, type CreateProductState } from "./actions";
import { UnsavedOrderGuard } from "../../UnsavedOrderGuard";
import { useTaxonomyMobile } from "../../useTaxonomyMobile";
import { Banner, SectionHeading, TopBar } from "../../mobile/parts";

/**
 * The technical fields come from the family's own columns, so this form needs
 * no code of its own when a family gains or loses one — the same rule the spec
 * table and the importer already follow.
 *
 * Phones get their own layout of the same form — same fields, same action,
 * same error wording — below the width where the products page switches to
 * its phone flow.
 */
export function NewProductForm({
  familyId,
  familyName,
  backHref,
  defs,
  locale,
  demo,
}: {
  familyId: number;
  familyName: string;
  backHref: string;
  defs: FamilySpecDef[];
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  const mobile = useTaxonomyMobile();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<CreateProductState | null>(null);
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);

  async function create(data: FormData): Promise<CreateProductState> {
    const result = await createProductAction(familyId, data);
    setState(result);
    // Clearing only on success keeps a rejected entry on screen to correct,
    // and makes the next similar product one edit rather than a full retype.
    if (result.kind === "ok") {
      formRef.current?.reset();
      setDirty(false);
    }
    return result;
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      await create(data);
      // The outcome banner sits at the top of the phone layout.
      if (mobile) window.scrollTo(0, 0);
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

  if (mobile) {
    return (
      <MobileNewProduct
        formRef={formRef}
        familyName={familyName}
        backHref={backHref}
        defs={defs}
        locale={locale}
        demo={demo}
        pending={pending}
        state={state}
        problem={problem}
        dirty={dirty}
        onDirty={setDirty}
        onSubmit={submit}
        onGuardSave={async () => {
          if (!formRef.current) return false;
          const result = await create(new FormData(formRef.current));
          return result.kind === "ok";
        }}
      />
    );
  }

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

/** Which input a refusal is about, so the phone can mark it. */
function fieldInError(state: CreateProductState | null): string | null {
  if (state?.kind !== "error") return null;
  switch (state.message) {
    case "bad-number":
      return state.column ? `spec.${state.column}` : null;
    case "bad-price":
      return "price_usd";
    case "bad-pack":
      return "pack_qty";
    case "bad-lead":
      return "lead_days";
    case "bad-inventory":
      return "inventory_available";
    case "bad-image":
      return "image_url";
    case "already-exists":
    case "reserved":
    case "wrong-family":
    case "case-variant":
      return "part_number";
    default:
      return null;
  }
}

/** Whether anything differs from the form's starting values. */
function formIsDirty(form: HTMLFormElement): boolean {
  for (const element of Array.from(form.elements)) {
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" ? element.checked !== element.defaultChecked : element.value !== element.defaultValue) {
        return true;
      }
    }
  }
  return false;
}

/**
 * "Add a product" on a phone: a top bar with Cancel, the same fields in
 * thumb-sized inputs, and the button pinned to the bottom. Cancel, Back or a
 * tab with anything typed goes through the same Save / Discard / Stay sheet
 * as the products page — where Save adds the product, then leaves.
 */
function MobileNewProduct({
  formRef,
  familyName,
  backHref,
  defs,
  locale,
  demo,
  pending,
  state,
  problem,
  dirty,
  onDirty,
  onSubmit,
  onGuardSave,
}: {
  formRef: React.RefObject<HTMLFormElement | null>;
  familyName: string;
  backHref: string;
  defs: FamilySpecDef[];
  locale: Locale;
  demo: boolean;
  pending: boolean;
  state: CreateProductState | null;
  problem: string | null;
  dirty: boolean;
  onDirty: (dirty: boolean) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onGuardSave: () => Promise<boolean>;
}) {
  const t = getDict(locale);
  const guardRequest = useRef<((go: () => void) => void) | null>(null);
  const bad = fieldInError(state);
  const inputClass = (name: string, mono = false) =>
    `mtx-input ${bad === name ? "is-invalid" : ""} ${mono ? "mtx-mono" : ""}`;
  const describedBy = (name: string, hint?: string) =>
    [hint, bad === name ? "mtx-new-error" : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="mtx is-deep mtx-new-product">
      <UnsavedOrderGuard
        dirtyCount={dirty && !demo ? 1 : 0}
        locale={locale}
        requestRef={guardRequest}
        variant="sheet"
        onSave={onGuardSave}
        onDiscard={() => {
          formRef.current?.reset();
          onDirty(false);
        }}
        copy={{ title: t.productsUnsavedTitle, body: t.taxonomyUnsavedBody, scope: t.taxonomyPendingOne }}
      />
      <TopBar
        start={
          <Link className="mtx-text-button mtx-text-link" href={backHref}>
            {t.fxCancel}
          </Link>
        }
        title={t.mobileNewProduct}
        kind={t.mobileInFamily.replace("{family}", familyName)}
      />
      <div className="mtx-banners">
        {state?.kind === "ok" && (
          <Banner tone="ok">
            <strong>{t.newProductCreated.replace("{part}", state.partNumber)}</strong>{" "}
            <span>{t.mobileAddedReady}</span>
          </Banner>
        )}
        {problem && (
          <Banner tone="error">
            <span id="mtx-new-error">{problem}</span>
          </Banner>
        )}
      </div>

      <form
        ref={formRef}
        onSubmit={onSubmit}
        onInput={(event) => onDirty(formIsDirty(event.currentTarget))}
        onChange={(event) => onDirty(formIsDirty(event.currentTarget))}
      >
        <fieldset className="mtx-fieldset" disabled={demo || pending}>
          <section className="mtx-section">
            <div className="mtx-field">
              <label className="mtx-field-label" htmlFor="part_number">
                {t.partNumber}
              </label>
              <input
                id="part_number"
                name="part_number"
                dir="ltr"
                className={inputClass("part_number", true)}
                aria-describedby={describedBy("part_number", "part_number_hint")}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              <span id="part_number_hint" className="mtx-hint">
                {t.newProductPartNumberHint}
              </span>
            </div>
          </section>

          {defs.length > 0 && (
            <section className="mtx-section">
              <SectionHeading
                count={t.mobileSpecsFromFamily.replace("{n}", formatInt(defs.length, locale))}
              >
                {t.newProductSpecs}
              </SectionHeading>
              <div className="mtx-fields">
                {defs.map((def) => (
                  <div key={def.key} className="mtx-field">
                    <div className="mtx-field-label">
                      <label htmlFor={`new-spec-${def.key}`}>
                        {locale === "fa" ? def.labelFa || def.labelEn : def.labelEn}
                      </label>
                      {def.unit && <span className="mtx-field-unit">({def.unit})</span>}
                    </div>
                    <input
                      id={`new-spec-${def.key}`}
                      name={`spec.${def.key}`}
                      dir="ltr"
                      className={inputClass(`spec.${def.key}`)}
                      aria-describedby={describedBy(`spec.${def.key}`)}
                      inputMode={def.kind === "number" ? "decimal" : undefined}
                      autoComplete="off"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mtx-section">
            <SectionHeading>{t.newProductCommercial}</SectionHeading>
            <div className="mtx-fields">
              <div className="mtx-field">
                {/* The label is the name alone, the unit beside it: the field is
                    announced, and found, as "Price". */}
                <div className="mtx-field-label">
                  <label htmlFor="price_usd">{t.price}</label>
                  <span className="mtx-field-unit">(USD)</span>
                </div>
                <input
                  id="price_usd"
                  name="price_usd"
                  dir="ltr"
                  className={inputClass("price_usd", true)}
                  inputMode="decimal"
                  aria-describedby={describedBy("price_usd", "price_usd_hint")}
                  autoComplete="off"
                />
                <span id="price_usd_hint" className="mtx-hint">
                  {t.newProductPriceHint}
                </span>
              </div>
              <div className="mtx-pair">
                <label className="mtx-field">
                  <span className="mtx-field-label">{t.packQty}</span>
                  <input
                    name="pack_qty"
                    dir="ltr"
                    className={inputClass("pack_qty", true)}
                    aria-describedby={describedBy("pack_qty")}
                    inputMode="numeric"
                    defaultValue="1"
                  />
                </label>
                <label className="mtx-field">
                  <span className="mtx-field-label">{t.leadTime}</span>
                  <input
                    name="lead_days"
                    dir="ltr"
                    className={inputClass("lead_days", true)}
                    aria-describedby={describedBy("lead_days")}
                    inputMode="numeric"
                    defaultValue="0"
                  />
                </label>
              </div>
              <label className="mtx-field">
                <span className="mtx-field-label">{t.stockAvailable}</span>
                <input
                  name="inventory_available"
                  dir="ltr"
                  className={inputClass("inventory_available", true)}
                  aria-describedby={describedBy("inventory_available")}
                  inputMode="numeric"
                  defaultValue="0"
                />
              </label>
              <label className="mtx-field">
                <span className="mtx-field-label">{t.newProductImage}</span>
                <input
                  name="image_url"
                  type="url"
                  dir="ltr"
                  className={inputClass("image_url")}
                  aria-describedby={describedBy("image_url")}
                  inputMode="url"
                  placeholder="https://…"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>
              <label className="mtx-toggle-row">
                <span className="mtx-toggle-text">
                  <span className="mtx-toggle-label">{t.inStock}</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  name="in_stock"
                  className="mtx-switch-input"
                  defaultChecked
                />
                <span className="mtx-switch" aria-hidden="true" />
              </label>
            </div>
          </section>
        </fieldset>

        <div className="mtx-bottom-bar">
          <div className="mtx-bottom-actions">
            <button type="submit" className="mtx-button mtx-primary" disabled={demo || pending}>
              {t.newProduct}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
