"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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

export type CatalogMediaSection = {
  title: string;
  kind: "category" | "family";
  entities: CatalogMediaEntity[];
};

/** What one card can change. Absent fields are unedited and read from the entity. */
type Edit = Partial<{
  nameEn: string;
  nameFa: string;
  imageUrl: string;
  isVisible: boolean;
  removeImage: boolean;
}>;

const cardKey = (kind: string, id: number) => `${kind}-${id}`;

/**
 * The whole category page, saved by one button.
 *
 * It used to be a form per card, each with its own Save, which made "rename
 * four families and hide one" five separate presses — and five whole-site
 * cache purges. The page is one form now: every card writes into shared state,
 * the header button is enabled exactly when something differs from what the
 * database holds, and one press sends only the cards that changed.
 *
 * Edits are stored per card as the fields actually touched, rather than as a
 * copy of every card on the page. A page with forty families then holds
 * nothing until someone types, and "is this card changed?" stays a comparison
 * against the server's own values rather than a flag that can drift out of
 * step with them.
 */
export function CatalogMediaEditor({
  title,
  intro,
  sections,
  locale,
  demo,
}: {
  title: string;
  intro: string;
  sections: CatalogMediaSection[];
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  const [state, action, pending] = useActionState<CatalogMediaState | null, FormData>(
    saveCatalogMediaAction,
    null,
  );
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  /**
   * Chosen files, tracked separately: a file input is uncontrolled, and its
   * value cannot be set from state. `generation` remounts the inputs after a
   * save so a file already uploaded is not sitting there to be sent again.
   */
  const [files, setFiles] = useState<Record<string, string>>({});
  const [generation, setGeneration] = useState(0);

  /*
   * Clear the page's edits once a save has landed. The fields now match the
   * database again, so leaving them in state would keep every card marked as
   * changed; remounting the file inputs stops an image that has already been
   * uploaded from sitting there ready to be sent a second time.
   */
  const settled = useRef<CatalogMediaState | null>(null);
  useEffect(() => {
    if (state?.kind !== "saved" || settled.current === state) return;
    settled.current = state;
    setEdits({});
    setFiles({});
    setGeneration((g) => g + 1);
  }, [state]);

  const all = sections.flatMap((s) =>
    s.entities.map((entity) => ({ kind: s.kind, entity })),
  );

  function changed(kind: string, entity: CatalogMediaEntity): boolean {
    const key = cardKey(kind, entity.id);
    if (files[key]) return true;
    const edit = edits[key];
    if (!edit) return false;
    if (edit.removeImage) return true;
    if (edit.nameEn !== undefined && edit.nameEn !== entity.nameEn) return true;
    if (edit.nameFa !== undefined && edit.nameFa !== entity.nameFa) return true;
    if (edit.imageUrl !== undefined && edit.imageUrl !== entity.imageUrl) return true;
    if (edit.isVisible !== undefined && edit.isVisible !== entity.isVisible) return true;
    return false;
  }

  const dirty = all.filter(({ kind, entity }) => changed(kind, entity));

  const set = (kind: string, id: number, patch: Edit) =>
    setEdits((prev) => {
      const key = cardKey(kind, id);
      return { ...prev, [key]: { ...prev[key], ...patch } };
    });

  /** What a card should show: the edit if there is one, the database otherwise. */
  const view = (kind: string, entity: CatalogMediaEntity) => {
    const edit = edits[cardKey(kind, entity.id)] ?? {};
    return {
      nameEn: edit.nameEn ?? entity.nameEn,
      nameFa: edit.nameFa ?? entity.nameFa,
      imageUrl: edit.imageUrl ?? entity.imageUrl,
      isVisible: edit.isVisible ?? entity.isVisible,
      removeImage: edit.removeImage ?? false,
    };
  };

  /*
   * Only the changed cards are posted, and they are numbered as they are
   * written rather than by their position on the page — the action reads
   * `count` and walks `0..count-1`, so a page of forty families with one edit
   * sends one card.
   */
  function submit(formData: FormData) {
    const posting = dirty;
    formData.set("count", String(posting.length));
    posting.forEach(({ kind, entity }, i) => {
      const key = cardKey(kind, entity.id);
      const edit = edits[key] ?? {};
      formData.set(`entity_${i}`, kind);
      formData.set(`id_${i}`, String(entity.id));
      formData.set(`nameEn_${i}`, edit.nameEn ?? entity.nameEn);
      formData.set(`nameFa_${i}`, edit.nameFa ?? entity.nameFa);
      formData.set(`imageUrl_${i}`, edit.imageUrl ?? entity.imageUrl);
      if ((edit.isVisible ?? entity.isVisible) === true) formData.set(`isVisible_${i}`, "on");
      if (edit.removeImage) formData.set(`removeImage_${i}`, "on");

      // React has already collected the file inputs, which are the only named
      // controls on the page — everything else is React state.
      const chosen = formData.get(`file-${key}`);
      if (chosen instanceof File && chosen.size > 0) formData.set(`imageFile_${i}`, chosen);
    });

    // The per-card file entries have been copied to the numbered slots the
    // action reads; sending them as well would be the same image twice.
    for (const name of [...formData.keys()]) {
      if (name.startsWith("file-")) formData.delete(name);
    }

    action(formData);
  }

  const failureFor = (kind: string, id: number) =>
    state?.kind === "error"
      ? state.failures.find((f) => f.entity === kind && f.id === id)
      : undefined;

  return (
    <form action={submit}>
      {/* The button belongs to the page, so it sits with the page's heading —
          not at the bottom of a list the operator has already scrolled past. */}
      <div className="mb-1 flex flex-wrap items-center gap-3 border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">{title}</h1>
        <button
          type="submit"
          className="btn-small ms-auto"
          disabled={demo || pending || dirty.length === 0}
        >
          {t.catalogEditSave}
        </button>
      </div>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{intro}</p>

      {state?.kind === "saved" && state.count > 0 && (
        <p className="mb-4 border border-[#b6d7bb] bg-[#f0f8f1] px-2.5 py-1.5 text-[12px]">
          {t.catalogEditSaved}
        </p>
      )}
      {state?.kind === "error" && state.failures.length > 0 && (
        <p className="mb-4 border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5 text-[12px] text-[var(--color-danger)]">
          {t.catalogEditNothingSaved}
        </p>
      )}

      {sections.map((section) => (
        <section key={section.title} className="mb-5">
          <h2 className="mb-2 border-b border-[var(--color-rule)] pb-1 text-[14px] font-bold">
            {section.title}
          </h2>
          <div className="grid gap-2">
            {section.entities.map((entity) => (
              <Card
                key={cardKey(section.kind, entity.id)}
                entity={entity}
                kind={section.kind}
                locale={locale}
                generation={generation}
                changed={changed(section.kind, entity)}
                failure={failureFor(section.kind, entity.id)?.message}
                {...view(section.kind, entity)}
                onChange={(patch) => set(section.kind, entity.id, patch)}
                onFile={(name) =>
                  setFiles((prev) => {
                    const key = cardKey(section.kind, entity.id);
                    const next = { ...prev };
                    if (name) next[key] = name;
                    else delete next[key];
                    return next;
                  })
                }
              />
            ))}
          </div>
        </section>
      ))}
    </form>
  );
}

function Card({
  entity,
  kind,
  locale,
  generation,
  changed,
  failure,
  nameEn,
  nameFa,
  imageUrl,
  isVisible,
  removeImage,
  onChange,
  onFile,
}: {
  entity: CatalogMediaEntity;
  kind: "category" | "family";
  locale: Locale;
  generation: number;
  changed: boolean;
  failure: CatalogMediaMessage | undefined;
  nameEn: string;
  nameFa: string;
  imageUrl: string;
  isVisible: boolean;
  removeImage: boolean;
  onChange: (patch: Edit) => void;
  onFile: (name: string | null) => void;
}) {
  const t = getDict(locale);
  const key = cardKey(kind, entity.id);

  return (
    <div
      className={`catalog-media-card grid gap-3 border bg-white p-3 sm:grid-cols-[88px_minmax(0,1fr)] ${
        changed ? "border-[var(--color-navy-lift)]" : "border-[var(--color-rule)]"
      }`}
    >
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
              name={`card-nameEn-${key}`}
              value={nameEn}
              onChange={(e) => onChange({ nameEn: e.target.value })}
            />
          </label>
          <label className="grid gap-0.5 text-[11px]">
            {t.catalogEditNameFa}
            <input
              type="text"
              className="admin-input w-full"
              name={`card-nameFa-${key}`}
              value={nameFa}
              dir="rtl"
              onChange={(e) => onChange({ nameFa: e.target.value })}
            />
          </label>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-0.5 text-[11px]">
            {t.catalogEditImageUrl}
            <input
              className="admin-input w-full"
              name={`card-imageUrl-${key}`}
              type="url"
              inputMode="url"
              placeholder="https://…"
              dir="ltr"
              value={imageUrl}
              onChange={(e) => onChange({ imageUrl: e.target.value })}
            />
          </label>
          <label className="grid gap-0.5 text-[11px]">
            {t.catalogEditImageFile}
            <input
              key={`${key}-${generation}`}
              className="catalog-image-file text-[11px]"
              name={`file-${key}`}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              onChange={(e) => onFile(e.target.files?.[0]?.name ?? null)}
            />
          </label>
        </div>

        <p className="text-[10.5px] text-[var(--color-ink-muted)]">{t.catalogEditImageHelp}</p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
            <input
              name={`card-isVisible-${key}`}
              type="checkbox"
              checked={isVisible}
              onChange={(e) => onChange({ isVisible: e.target.checked })}
            />
            {t.catalogEditVisible}
          </label>
          {entity.imageUrl && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-ink-muted)]">
              <input
                name={`card-removeImage-${key}`}
                type="checkbox"
                checked={removeImage}
                onChange={(e) => onChange({ removeImage: e.target.checked })}
              />
              {t.catalogEditRemoveImage}
            </label>
          )}
        </div>

        {failure && (
          <p className="border border-[#e0b4b0] bg-[#fdf2f1] px-2.5 py-1.5 text-[11px] text-[var(--color-danger)]">
            {errorText(failure, t)}
          </p>
        )}
      </div>
    </div>
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
