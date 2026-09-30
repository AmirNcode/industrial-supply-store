/**
 * How large a Server Action request may be, by the page it is posted to.
 *
 * Next's `serverActions.bodySizeLimit` is one number for every action, and it
 * is 4.25 MB because catalog artwork and payment receipts travel through
 * actions. So every anonymous action — cart, checkout, sign-up, sign-in —
 * also had a 4.25 MB body buffered before its own validation ran (review
 * finding M-16). `src/proxy.ts` applies this first: the large allowance only
 * on the pages that upload files, 1 MB everywhere else, and no body without a
 * declared length (a browser always declares one).
 *
 * No imports, so the rule is testable on its own.
 */
export const SMALL_ACTION_BYTES = 1_048_576;

/** Pages whose actions carry a file: admin artwork, and receipts. */
const UPLOAD_PAGES = /^\/(?:en|fa)\/(?:admin(?:\/|$)|pay\/|account\/orders\/|rep\/orders\/)/;

export function actionBodyAllowed(pathname: string, contentLength: string | null): boolean {
  if (UPLOAD_PAGES.test(pathname)) return true;
  if (contentLength === null || !/^\d{1,12}$/.test(contentLength)) return false;
  return Number(contentLength) <= SMALL_ACTION_BYTES;
}
