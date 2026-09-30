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
 * The allowance goes by address, and Next runs an action posted to any page
 * (forwarding it to the page that owns it), so a stranger can still send
 * 4.25 MB by posting to a pay-link address. That cannot be closed here: the
 * pay page takes receipts from customers who have no account. What this does
 * is keep every other page's forms at 1 MB.
 *
 * No imports, so the rule is testable on its own.
 */
export const SMALL_ACTION_BYTES = 1_048_576;

/**
 * Pages whose actions carry a file: admin artwork, and receipts. Not the
 * admin sign-in page, which is public and whose one action takes a password:
 * matching it gave anyone the large allowance (fix review, 2026-09-30).
 */
const UPLOAD_PAGES = /^\/(?:en|fa)\/(?:admin(?:\/(?!login(?:\/|$))|$)|pay\/|account\/orders\/|rep\/orders\/)/;

export function actionBodyAllowed(pathname: string, contentLength: string | null): boolean {
  if (UPLOAD_PAGES.test(pathname)) return true;
  if (contentLength === null || !/^\d{1,12}$/.test(contentLength)) return false;
  return Number(contentLength) <= SMALL_ACTION_BYTES;
}
