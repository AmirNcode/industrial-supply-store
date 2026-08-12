"use client";

import { useActionState } from "react";
import { CatalogImage } from "@/components/CatalogImage";
import { getDict, type Locale } from "@/lib/i18n";
import {
  saveCatalogMediaAction,
  type CatalogMediaMessage,
  type CatalogMediaState,
} from "./actions";

export type CatalogMediaEntity = {
  id: number;
  nameEn: string;
  nameFa: string;
  icon: string;
  imageUrl: string;
  isVisible: boolean;
};

export function CatalogMediaForm({
  entity,
  kind,
  locale,
  demo,
}: {
  entity: CatalogMediaEntity;
  kind: "category" | "family";
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  const [state, action, pending] = useActionState<CatalogMediaState | null, FormData>(
    saveCatalogMediaAction,
    null,
  );

  return (
    <form
      action={action}
      className="catalog-media-card grid gap-3 border border-[var(--color-rule)] bg-white p-3 sm:grid-cols-[88px_minmax(0,1fr)]"
    >
      <input type="hidden" name="entity" value={kind} />
      <input type="hidden" name="id" value={entity.id} />

      <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-[4px] border border-[var(--color-rule-light)] bg-[var(--color-panel-alt)]">
        <CatalogImage
          imageUrl={entity.imageUrl}
          icon={entity.icon}
          alt={locale === "fa" ? entity.nameFa : entity.nameEn}
          size={76}
          className="max-h-[76px] max-w-[76px]"
        />
      </div>

      <div className="grid min-w-0 gap-2">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-0.5 text-[11px]">
            {t.catalogEditNameEn}
            <input
              type="text"
              className="admin-input w-full"
              name="nameEn"
              defaultValue={entity.nameEn}
              required
            />
          </label>
          <label className="grid gap-0.5 text-[11px]">
            {t.catalogEditNameFa}
            <input
              type="text"
              className="admin-input w-full"
              name="nameFa"
              defaultValue={entity.nameFa}
              dir="rtl"
              required
            />
          </label>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-0.5 text-[11px]">
            {t.catalogEditImageUrl}
            <input
              className="admin-input w-full"
              name="imageUrl"
              type="url"
              inputMode="url"
              placeholder="https://…"
              dir="ltr"
              defaultValue={entity.imageUrl}
            />
          </label>
          <label className="grid gap-0.5 text-[11px]">
            {t.catalogEditImageFile}
            <input
              className="catalog-image-file text-[11px]"
              name="imageFile"
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            />
          </label>
        </div>

        <p className="text-[10.5px] text-[var(--color-ink-muted)]">
          {t.catalogEditImageHelp}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
            <input
              name="isVisible"
              type="checkbox"
              defaultChecked={entity.isVisible}
            />
            {t.catalogEditVisible}
          </label>
          {entity.imageUrl && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-ink-muted)]">
              <input name="removeImage" type="checkbox" />
              {t.catalogEditRemoveImage}
            </label>
          )}
          <button className="btn-small ms-auto" type="submit" disabled={demo || pending}>
            {t.catalogEditSave}
          </button>
        </div>

        {state?.kind === "saved" && state.id === entity.id && (
          <p className="border border-[#b6d7bb] bg-[#f0f8f1] px-2.5 py-1.5 text-[11px]">
            {t.catalogEditSaved}
          </p>
        )}
        {state?.kind === "error" && state.id === entity.id && (
          <p className="border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5 text-[11px] text-[var(--color-danger)]">
            {errorText(state.message, t)}
          </p>
        )}
      </div>
    </form>
  );
}

function errorText(message: CatalogMediaMessage, t: ReturnType<typeof getDict>): string {
  if (message === "no-name") return t.catalogEditNoName;
  if (message === "bad-url") return t.catalogEditBadUrl;
  if (message === "bad-file-type") return t.catalogEditBadFileType;
  if (message === "too-large") return t.catalogEditTooLarge;
  if (message === "storage-missing") return t.catalogEditStorageMissing;
  if (message === "upload-failed") return t.catalogEditUploadFailed;
  return t.catalogEditNotFound;
}
