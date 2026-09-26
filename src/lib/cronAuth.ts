import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a request to a scheduled-job route came from the scheduler.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` on every cron call when
 * that variable is set, and any other scheduler (see DEPLOYMENT.md on moving
 * off Vercel) can send the same header. The route is otherwise public, so
 * this is all that stops a stranger from running the job on demand.
 *
 * Fails closed: an unset or short secret refuses everything rather than
 * letting an empty header match an empty secret. Both sides are hashed first
 * so the comparison takes the same time whatever length was sent.
 */
export const MIN_CRON_SECRET_LENGTH = 16;

export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH || !header) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
