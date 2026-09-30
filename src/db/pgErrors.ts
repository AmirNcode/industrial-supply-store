/**
 * The constraint a unique violation (SQLSTATE 23505) hit, or null for any
 * other error. The unique indexes decide clashes — never a lookup first — so
 * callers turn this into "email taken", "username taken" and the like.
 */
export function uniqueViolation(err: unknown): string | null {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === "23505" ? (e.constraint_name ?? "") : null;
}
