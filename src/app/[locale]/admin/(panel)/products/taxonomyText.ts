import type { AdminTaxonomyNode } from "@/lib/adminTaxonomy";
import type { getDict, Locale } from "@/lib/i18n";
import type { TaxonomyCreateResult, TaxonomySaveResult } from "./actions";

/**
 * Words shared by the desktop workbench and the phone flow, so the two never
 * name a node or explain a refusal differently.
 */
export function nodeName(node: AdminTaxonomyNode, locale: Locale): string {
  return locale === "fa" ? node.nameFa || node.nameEn : node.nameEn;
}

export function createErrorText(
  message: Extract<TaxonomyCreateResult, { kind: "error" }>["message"],
  t: ReturnType<typeof getDict>,
): string {
  return message === "no-name"
    ? t.taxonomyCreateNoName
    : message === "has-families"
      ? t.taxonomyCreateHasFamilies
      : message === "has-subcategories"
        ? t.taxonomyCreateHasSubcategories
        : message === "duplicate-name"
          ? t.taxonomyCreateDuplicate
          : t.taxonomyCreateParentGone;
}

export function saveErrorText(
  result: Exclude<TaxonomySaveResult, "saved">,
  t: ReturnType<typeof getDict>,
): string {
  return result === "bad-file-type"
    ? t.catalogEditBadFileType
    : result === "too-large"
      ? t.catalogEditTooLarge
      : result === "storage-missing"
        ? t.catalogEditStorageMissing
        : result === "upload-failed"
          ? t.catalogEditUploadFailed
          : result === "bad-data"
            ? t.taxonomySaveBadData
            : result === "no-name"
              ? t.catalogEditNoName
              : result === "bad-url"
                ? t.catalogEditBadUrl
                : t.taxonomySaveStale;
}
