import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { DEMO_MODE } from "@/lib/demo";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { listEmailLog } from "@/lib/email";
import { formatDeadline } from "@/lib/orderFlow";

/**
 * Every email the site tried to send, newest first.
 *
 * With no mail-provider key this is the inbox: nothing leaves the server and
 * the full text is recorded here, so a pish-factor mail can be read in local
 * development. With a key it answers "did the customer get it?".
 *
 * Not on the public demo: its panel is open to anyone, and a message carries
 * the customer's pay link.
 */
export default async function AdminEmailsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  await requireAdmin(l);
  if (DEMO_MODE) notFound();
  const t = getDict(l);
  const rows = await listEmailLog(100);
  const statusLabel = {
    sent: t.emailStatusSent,
    logged: t.emailStatusLogged,
    failed: t.emailStatusFailed,
  } as const;

  return (
    <>
      <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">{t.emailLogTitle}</h1>

      {!process.env.RESEND_API_KEY && (
        <p className="mb-3 border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px]">
          {t.emailLoggedNote}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="py-8 text-[13px] text-[var(--color-ink-muted)]">{t.emailLogEmpty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="spec-table">
            <thead>
              <tr>
                <th>{t.emailWhen}</th>
                <th>{t.emailKind}</th>
                <th>{t.emailTo}</th>
                <th>{t.emailSubject}</th>
                <th>{t.reference}</th>
                <th>{t.emailStatus}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap">{formatDeadline(row.createdAt, l)}</td>
                  <td className="tech">{row.kind}</td>
                  <td className="tech" dir="ltr">
                    {row.toEmail}
                  </td>
                  <td className="whitespace-normal">
                    {row.subject}
                    {row.bodyText && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] underline">{t.emailShowBody}</summary>
                        <pre dir="auto" className="mt-1 whitespace-pre-wrap text-[11px]">
                          {row.bodyText}
                        </pre>
                      </details>
                    )}
                  </td>
                  <td className="tech" dir="ltr">
                    {row.orderRef}
                  </td>
                  <td className="whitespace-normal">
                    {statusLabel[row.status]}
                    {row.status === "failed" && row.error && (
                      <span className="block text-[11px] text-[#a3312a]" dir="auto">
                        {row.error}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
