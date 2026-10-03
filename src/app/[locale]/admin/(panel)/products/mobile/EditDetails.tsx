"use client";

import { useEffect, useState } from "react";
import type { AdminTaxonomyNode } from "@/lib/adminTaxonomy";
import { getDict } from "@/lib/i18n";
import { REQUEST_LIMITS } from "@/lib/requestLimits";
import type { TaxonomySaveResult } from "../actions";
import type { ContentEdit } from "../TaxonomyWorkbench";
import { nodeName, saveErrorText } from "../taxonomyText";
import type { MobileShared } from "./MobileWorkbench";
import { CheckRow, MoreButton, SectionHeading, ToggleRow, TopBar } from "./parts";

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * A node's names, image, visibility, description and diagram, on one page.
 *
 * Nothing here saves on its own. Every field writes into the workbench's
 * draft for this node — the same draft the desktop pane's description and
 * image edits use — so it counts as one pending change and goes out with Save
 * all, in the one `saveTaxonomyWorkbenchAction` transaction. Cancel undoes
 * this node's details edits and returns to the node; other pending work —
 * product edits, other nodes — is left as it was.
 */
export function EditDetails(
  props: MobileShared & { node: AdminTaxonomyNode; onCancel: () => void },
) {
  const { node, locale, demo } = props;
  const t = getDict(locale);
  const content = props.effectiveContent(node);
  const visible = props.effectiveVisibility(node);
  const change = (patch: Partial<ContentEdit>) => props.setNodeContent(node, { ...content, ...patch });

  function cancel() {
    // The stored values: the workbench drops a draft that matches them.
    props.setNodeContent(node, { aboutEn: node.aboutEn, aboutFa: node.aboutFa });
    if (visible !== node.isVisible) props.setNodeVisibility(node, node.isVisible);
    props.onCancel();
  }

  const failure =
    props.saveFailure &&
    props.saveFailure.kind === node.kind &&
    props.saveFailure.id === node.id &&
    props.saveResult &&
    props.saveResult !== "saved"
      ? { field: props.saveFailure.field, text: saveErrorText(props.saveResult as Exclude<TaxonomySaveResult, "saved">, t) }
      : null;

  const nameEn = content.nameEn ?? node.nameEn;
  const nameFa = content.nameFa ?? node.nameFa;
  const described = Boolean(
    content.aboutEn || content.aboutFa || content.diagramFile || (content.diagramUrl ?? node.diagramUrl),
  );
  const kindLabel =
    node.kind === "family"
      ? t.taxonomyProductFamily
      : node.depth === 0
        ? t.taxonomyCategory
        : t.taxonomySubcategory;

  return (
    <div className="mtx-screen is-form">
      <TopBar
        start={
          <button type="button" className="mtx-text-button" onClick={cancel}>
            {t.fxCancel}
          </button>
        }
        title={t.mobileEditTitle.replace("{name}", nodeName(node, locale))}
        kind={kindLabel}
        kindTone={node.kind === "family" ? "family" : undefined}
        end={
          !props.hasPending && (
            <MoreButton label={t.mobileMore} disabled={demo} onClick={() => props.openDelete(node)} />
          )
        }
      />
      <div className="mtx-banners">{props.banners}</div>

      <fieldset className="mtx-fieldset" disabled={demo}>
        <section className="mtx-section">
          <SectionHeading>{t.mobileNames}</SectionHeading>
          <div className="mtx-fields">
            <TextField
              id="mtx-name-en"
              label={t.catalogEditNameEn}
              value={nameEn}
              edited={nameEn !== node.nameEn}
              error={failure?.field === "name" && !nameEn.trim() ? failure.text : null}
              editedLabel={t.mobileEdited}
              dir="ltr"
              maxLength={160}
              onChange={(value) => change({ nameEn: value })}
            />
            <TextField
              id="mtx-name-fa"
              label={t.catalogEditNameFa}
              value={nameFa}
              edited={nameFa !== node.nameFa}
              error={failure?.field === "name" && !nameFa.trim() ? failure.text : null}
              editedLabel={t.mobileEdited}
              dir="rtl"
              maxLength={160}
              onChange={(value) => change({ nameFa: value })}
            />
          </div>
        </section>

        <section className="mtx-section">
          <SectionHeading>{t.editImage}</SectionHeading>
          <ImageSlot
            id="mtx-image"
            label={t.editImage}
            stored={node.imageUrl}
            file={content.file}
            url={content.imageUrl}
            remove={content.removeImage ?? false}
            removeLabel={t.catalogEditRemoveImage}
            error={failure?.field === "image" ? failure.text : null}
            locale={locale}
            onFile={(file) => change({ file })}
            onUrl={(imageUrl) => change({ imageUrl })}
            onRemove={(removeImage) => change({ removeImage: removeImage || undefined })}
          />
        </section>

        <section className="mtx-section">
          <ToggleRow
            label={t.catalogEditVisible}
            hint={t.mobileHidesFromCustomers}
            checked={visible}
            disabled={demo}
            onChange={(checked) => props.setNodeVisibility(node, checked)}
          />
        </section>

        <section className="mtx-section">
          <SectionHeading count={described ? t.catalogEditDescriptionSet : undefined}>
            {t.catalogEditDescription}
          </SectionHeading>
          <div className="mtx-fields">
            <TextField
              id="mtx-about-en"
              label={t.catalogEditAboutEn}
              value={content.aboutEn}
              edited={content.aboutEn !== node.aboutEn}
              editedLabel={t.mobileEdited}
              dir="ltr"
              multiline
              maxLength={REQUEST_LIMITS.catalogDescriptionChars}
              onChange={(aboutEn) => change({ aboutEn })}
            />
            <TextField
              id="mtx-about-fa"
              label={t.catalogEditAboutFa}
              value={content.aboutFa}
              edited={content.aboutFa !== node.aboutFa}
              editedLabel={t.mobileEdited}
              dir="rtl"
              multiline
              placeholder={t.catalogEditAboutFaHint}
              maxLength={REQUEST_LIMITS.catalogDescriptionChars}
              onChange={(aboutFa) => change({ aboutFa })}
            />
            <div className="mtx-field">
              <span className="mtx-field-label">{t.mobileDiagram}</span>
              <ImageSlot
                id="mtx-diagram"
                label={t.mobileDiagram}
                stored={node.diagramUrl}
                file={content.diagramFile}
                url={content.diagramUrl}
                remove={content.removeDiagram ?? false}
                removeLabel={t.catalogEditRemoveDiagram}
                error={failure?.field === "diagram" ? failure.text : null}
                locale={locale}
                onFile={(diagramFile) => change({ diagramFile })}
                onUrl={(diagramUrl) => change({ diagramUrl })}
                onRemove={(removeDiagram) => change({ removeDiagram: removeDiagram || undefined })}
              />
            </div>
          </div>
        </section>
      </fieldset>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  edited,
  editedLabel,
  error,
  dir,
  multiline = false,
  placeholder,
  maxLength,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  edited: boolean;
  editedLabel: string;
  error?: string | null;
  dir: "ltr" | "rtl";
  multiline?: boolean;
  placeholder?: string;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  const className = `mtx-input ${error ? "is-invalid" : edited ? "is-edited" : ""}`;
  const shared = {
    id,
    className,
    value,
    dir,
    placeholder,
    maxLength,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  };
  return (
    <div className="mtx-field">
      {/* The label is the name alone; the tag beside it is not part of what
          a screen reader announces as the field's name. */}
      <div className="mtx-field-label">
        <label htmlFor={id}>{label}</label>
        {edited && !error && <span className="mtx-tag">{editedLabel}</span>}
      </div>
      {multiline ? (
        <textarea {...shared} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input {...shared} type="text" autoComplete="off" onChange={(event) => onChange(event.target.value)} />
      )}
      {error && (
        <span id={`${id}-error`} className="mtx-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * One image slot — the node's image or its diagram. A chosen file wins over
 * a typed address, and Remove wins over both, the order the server reads them
 * in. The file input does not force the camera, so iOS offers the camera and
 * the photo library both.
 */
function ImageSlot({
  id,
  label,
  stored,
  file,
  url,
  remove,
  removeLabel,
  error,
  locale,
  onFile,
  onUrl,
  onRemove,
}: {
  id: string;
  label: string;
  stored: string;
  file?: File;
  url?: string;
  remove: boolean;
  removeLabel: string;
  error: string | null;
  locale: MobileShared["locale"];
  onFile: (file: File | undefined) => void;
  onUrl: (url: string) => void;
  onRemove: (remove: boolean) => void;
}) {
  const t = getDict(locale);
  const [showUrl, setShowUrl] = useState(url !== undefined && url !== stored);
  const preview = useObjectUrl(file);
  const shown = remove ? "" : preview ?? (url !== undefined ? url : stored);

  return (
    <div className={`mtx-image-slot ${error ? "is-invalid" : ""}`}>
      <div className="mtx-image-row">
        <span className={`mtx-thumb ${shown ? "" : "is-empty"}`}>
          {/* A local preview or an arbitrary typed address: neither is
              something next/image can optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {shown && <img src={shown} alt="" />}
        </span>
        <div className="mtx-image-actions">
          <label className="mtx-button mtx-ghost mtx-secondary mtx-file">
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                onFile(event.target.files?.[0]);
                // Cleared so choosing the same file again, after a Discard,
                // still registers as a choice.
                event.target.value = "";
              }}
            />
            <span className="mtx-file-name">{file?.name ?? t.mobileTakePhoto}</span>
          </label>
          {!showUrl && (
            <button type="button" className="mtx-link-button" onClick={() => setShowUrl(true)}>
              {t.mobilePasteUrl}
            </button>
          )}
        </div>
      </div>
      {showUrl && (
        <label className="mtx-field">
          <span className="sr-only">{`${label} — ${t.catalogEditImageUrl}`}</span>
          <input
            type="url"
            inputMode="url"
            dir="ltr"
            className={`mtx-input ${url !== undefined && url !== stored ? "is-edited" : ""}`}
            placeholder="https://…"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={url ?? stored}
            onChange={(event) => onUrl(event.target.value)}
          />
        </label>
      )}
      {stored && <CheckRow label={removeLabel} checked={remove} onChange={onRemove} />}
      {error && (
        <span id={`${id}-error`} className="mtx-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

/** A short-lived address for previewing a chosen file, released after use. */
function useObjectUrl(file: File | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}
