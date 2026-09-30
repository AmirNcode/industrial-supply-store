import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { sql as appSql } from "./index";

/**
 * The audit trail (review finding M-11): who changed money or order state.
 *
 * Append-only — nothing updates or deletes a row. Every writer passes the
 * transaction its change runs in, so the record and the change commit or roll
 * back together; a single-statement change records itself with the
 * `auditInsert` fragment in a CTE instead. The admin is one shared password,
 * so an admin row says "admin" and no more — until named staff accounts exist.
 */
export type AuditActor =
  | { kind: "admin" }
  | { kind: "rep"; id: string }
  | { kind: "customer"; id: string | null }
  | { kind: "system" };

export type AuditEntry = {
  actor: AuditActor;
  action: string;
  subject: { kind: "order" | "customer" | "rep" | "payout"; id: string | number };
  detail?: Record<string, unknown>;
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Db = Sql<{}> | TransactionSql<{}>;

function actorId(actor: AuditActor): string | null {
  return actor.kind === "rep" || actor.kind === "customer" ? actor.id : null;
}

export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  // Sent as text and cast: the shared client's type handling (drizzle wraps
  // it) does not serialise a jsonb parameter reliably inside a transaction.
  await db`
    INSERT INTO audit_log (actor_kind, actor_id, action, subject_kind, subject_id, detail)
    VALUES (${entry.actor.kind}, ${actorId(entry.actor)}, ${entry.action},
            ${entry.subject.kind}, ${String(entry.subject.id)}, ${JSON.stringify(entry.detail ?? {})}::jsonb)
  `;
}

export type AuditRow = {
  at: string;
  actorKind: string;
  actorId: string | null;
  action: string;
  detail: Record<string, unknown>;
};

/** One subject's history, newest first. */
export async function listAudit(
  subject: AuditEntry["subject"],
  db: Db = appSql,
): Promise<AuditRow[]> {
  return db<AuditRow[]>`
    SELECT at, actor_kind AS "actorKind", actor_id AS "actorId", action, detail
    FROM audit_log
    WHERE subject_kind = ${subject.kind} AND subject_id = ${String(subject.id)}
    ORDER BY at DESC, id DESC
  `;
}
