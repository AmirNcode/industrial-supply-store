"use server";

import { revalidatePath } from "next/cache";
import { assertAdminWrite } from "@/lib/admin";
import {
  catalogImageFileProblem,
  normalizeCatalogImageUrl,
} from "@/lib/catalogImages";
import { CatalogStorageError, uploadCatalogImage } from "@/lib/catalogStorage";
import { updateCatalogCategory, updateCatalogFamily } from "@/db/familyQueries";

export type CatalogMediaMessage =
  | "no-name"
  | "bad-url"
  | "bad-file-type"
  | "too-large"
  | "storage-missing"
  | "upload-failed"
  | "not-found";

export type CatalogMediaState =
  | { kind: "saved"; entity: "category" | "family"; id: number }
  | {
      kind: "error";
      entity: "category" | "family";
      id: number;
      message: CatalogMediaMessage;
    };

export async function saveCatalogMediaAction(
  _previous: CatalogMediaState | null,
  formData: FormData,
): Promise<CatalogMediaState> {
  await assertAdminWrite();

  const entity = formData.get("entity") === "family" ? "family" : "category";
  const id = Number(formData.get("id"));
  const error = (message: CatalogMediaMessage): CatalogMediaState => ({
    kind: "error",
    entity,
    id,
    message,
  });

  if (!Number.isInteger(id) || id <= 0) return error("not-found");

  const nameEn = String(formData.get("nameEn") ?? "").trim();
  const nameFa = String(formData.get("nameFa") ?? "").trim();
  if (!nameEn || !nameFa) return error("no-name");

  const rawUrl = String(formData.get("imageUrl") ?? "").trim();
  const selected = formData.get("imageFile");
  const file = selected instanceof File && selected.size > 0 ? selected : null;
  const removeImage = formData.get("removeImage") === "on";
  let imageUrl: string | undefined;

  if (file) {
    const problem = catalogImageFileProblem(file);
    if (problem === "file-type") return error("bad-file-type");
    if (problem === "file-too-large") return error("too-large");

    try {
      imageUrl = await uploadCatalogImage(entity, id, file);
    } catch (uploadError) {
      if (
        uploadError instanceof CatalogStorageError &&
        uploadError.problem === "not-configured"
      ) {
        return error("storage-missing");
      }
      return error("upload-failed");
    }
  } else if (removeImage) {
    imageUrl = "";
  } else if (rawUrl) {
    const normalized = normalizeCatalogImageUrl(rawUrl);
    if (normalized === null) return error("bad-url");
    imageUrl = normalized;
  }

  const input = {
    id,
    nameEn,
    nameFa,
    imageUrl,
    isVisible: formData.get("isVisible") === "on",
  };
  const saved =
    entity === "category"
      ? await updateCatalogCategory(input)
      : await updateCatalogFamily(input);
  if (!saved) return error("not-found");

  revalidatePath("/", "layout");
  return { kind: "saved", entity, id };
}
