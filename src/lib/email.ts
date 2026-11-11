import "server-only";
import { sql } from "@/db";
import { DEMO_MODE } from "./demo";
import { siteOrigin } from "./siteOrigin";

/**
 * The one door every email leaves by.
 *
 * Sent through Resend's HTTP API with `fetch` — no SDK, so nothing new for
 * `audit:prod` to watch. Every attempt is recorded in `email_log` whether or
 * not it went anywhere, because "did the customer get their pish-factor?" is
 * the first question staff are asked and there was nowhere to look.
 *
 * With no `RESEND_API_KEY` (local development) nothing is sent: the message is
 * recorded as `logged` with its full text, and `/admin/emails` is the inbox.
 * With a key, a message marked `secret` (a sign-in code) is recorded without
 * its body, so the log is never a way into someone's account.
 *
 * Never throws. An order that committed must not turn into an error page
 * because a mail provider was slow; the failure is in the log instead.
 */
export type EmailMessage = {
  /** What it is, for the log: "pish-factor", "login-code", "staff-new-order" … */
  kind: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  orderId?: number;
  secret?: boolean;
};

export type EmailOutcome = "sent" | "logged" | "failed";

/** Only this subdomain is set up for sending; the apex is deliberately not used. */
const DEFAULT_FROM = "TEMEX <orders@mail.temexpro.com>";
const SEND_TIMEOUT_MS = 8_000;

export function emailFrom(env: NodeJS.ProcessEnv = process.env): string {
  return env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

/**
 * The address links in an email point at. A link in someone's inbox carries
 * pay tokens and sign-in codes, so in production it never comes from the
 * request's Host header — which whoever sends the request controls — but
 * from configuration. Locally the request's own origin is right and harmless.
 */
export async function emailOrigin(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const configured = env.SITE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (env.NODE_ENV !== "production") return siteOrigin();
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : "https://temex.ir";
}

export async function sendEmail(message: EmailMessage): Promise<EmailOutcome> {
  // The public demo takes real-looking orders from strangers; it must never
  // mail the addresses they type, whatever keys the deployment carries.
  const key = DEMO_MODE ? undefined : process.env.RESEND_API_KEY?.trim();
  let status: EmailOutcome = "logged";
  let providerId = "";
  let error = "";
  if (key) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: emailFrom(),
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (response.ok && body?.id) {
        status = "sent";
        providerId = body.id;
      } else {
        status = "failed";
        error = `${response.status} ${body?.message ?? ""}`.trim().slice(0, 500);
      }
    } catch (err) {
      status = "failed";
      error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    }
  }
  try {
    await sql`
      INSERT INTO email_log (kind, to_email, subject, body_text, order_id, status, provider_id, error)
      VALUES (${message.kind}, ${message.to}, ${message.subject},
              ${key && message.secret ? "" : message.text},
              ${message.orderId ?? null}, ${status}, ${providerId}, ${error})
    `;
  } catch (err) {
    // The log is a record, not a gate: losing a row must not fail the request.
    console.error("email_log insert failed", err);
  }
  return status;
}

export type EmailLogRow = {
  id: number;
  kind: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  orderRef: string | null;
  status: EmailOutcome;
  error: string;
  createdAt: string;
};

/** The newest messages, for /admin/emails. */
export async function listEmailLog(limit = 100): Promise<EmailLogRow[]> {
  return sql<EmailLogRow[]>`
    SELECT e.id, e.kind, e.to_email AS "toEmail", e.subject, e.body_text AS "bodyText",
           o.ref AS "orderRef", e.status, e.error, e.created_at AS "createdAt"
    FROM email_log e LEFT JOIN orders o ON o.id = e.order_id
    ORDER BY e.id DESC
    LIMIT ${Math.max(1, Math.min(500, limit))}
  `;
}
