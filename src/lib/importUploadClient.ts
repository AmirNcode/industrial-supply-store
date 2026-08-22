/**
 * Supabase Storage uses a browser File's own MIME type for multipart uploads;
 * its `contentType` option applies only to non-Blob bodies. Files saved by
 * spreadsheet software can therefore arrive as an empty or Excel MIME type.
 */
export function csvFileForUpload(file: File): File {
  if (file.type.toLowerCase() === "text/csv") return file;
  return new File([file], file.name, {
    type: "text/csv",
    lastModified: file.lastModified,
  });
}
