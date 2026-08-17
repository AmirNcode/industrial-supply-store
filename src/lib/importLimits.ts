export const IMPORT_MAX_BYTES = 24_000_000;
export const IMPORT_MAX_ROWS = 20_000;

export function importTextTooLarge(text: string): boolean {
  if (new TextEncoder().encode(text).byteLength > IMPORT_MAX_BYTES) return true;
  let lineBreaks = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10 && ++lineBreaks > IMPORT_MAX_ROWS) return true;
  }
  return false;
}
