import "server-only";
import { sql } from "./index";

export type CustomerNote = {
  id: number;
  body: string;
  createdAt: string;
  /** The rep who wrote it; null when the admin did. */
  authorName: string | null;
};

/** Callers check access to the customer first; the notes themselves are not scoped. */
export async function listNotes(customerId: string): Promise<CustomerNote[]> {
  return sql<CustomerNote[]>`
    SELECT n.id, n.body, n.created_at AS "createdAt", r.name AS "authorName"
    FROM customer_notes n
    LEFT JOIN sales_reps r ON r.id = n.author_rep_id
    WHERE n.user_id = ${customerId}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 200
  `;
}

/**
 * Scoped in the insert itself: a note for someone else's customer selects no
 * row and inserts nothing. Append-only — there is no edit or delete.
 */
export async function addNoteForRep(repId: string, customerId: string, body: string): Promise<boolean> {
  const result = await sql`
    INSERT INTO customer_notes (user_id, author_rep_id, body)
    SELECT u.id, ${repId}, ${body} FROM users u WHERE u.id = ${customerId} AND u.rep_id = ${repId}
  `;
  return result.count === 1;
}

export async function addNoteAdmin(customerId: string, body: string): Promise<boolean> {
  const result = await sql`
    INSERT INTO customer_notes (user_id, author_rep_id, body)
    SELECT u.id, NULL, ${body} FROM users u WHERE u.id = ${customerId}
  `;
  return result.count === 1;
}
