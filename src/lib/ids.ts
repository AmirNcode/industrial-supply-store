const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checked before any id from a form or URL reaches a query. Postgres rejects
 * a malformed uuid with an error, which would surface as a 500 rather than
 * the not-found the page means.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
