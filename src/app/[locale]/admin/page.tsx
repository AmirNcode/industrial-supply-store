import { notFound, redirect } from "next/navigation";
import { sql } from "@/db";
import { isAdmin, signInAdmin, signOutAdmin } from "@/lib/admin";
import { DEMO_MODE } from "@/lib/demo";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { formatPrice, formatInt } from "@/lib/money";
import { getFxSettings, getFxRate } from "@/lib/fx";
import { envFxRate } from "@/lib/fxRate";
import { FxRatePanel } from "@/components/FxRatePanel";
import { saveFxAction } from "./actions";
import type { SpecBag } from "@/db/schema";
import type { OrderStatus } from "@/lib/orders";

type OrderRow = {
  id: number;
  ref: string;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  poNumber: string;
  city: string;
  country: string;
  notes: string;
  status: OrderStatus;
  locale: string;
  currency: string;
  totalCents: number;
  createdAt: string;
  itemCount: number;
};

type OrderItemRow = {
  id: number;
  orderId: number;
  partNumber: string;
  familyName: string;
  qty: number;
  unitPriceCents: number;
  requestedUnitPriceCents: number;
  specsSnapshot: SpecBag;
};

async function loginAction(formData: FormData) {
  "use server";
  const locale = String(formData.get("locale") || "en");
  const ok = await signInAdmin(String(formData.get("password") ?? ""));
  redirect(`/${locale}/admin${ok ? "" : "?error=1"}`);
}

async function logoutAction(formData: FormData) {
  "use server";
  const locale = String(formData.get("locale") || "en");
  await signOutAdmin();
  redirect(`/${locale}/admin`);
}

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; fx?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);
  const { error, fx } = await searchParams;

  // In demo mode the inbox is deliberately open so it can be shown without
  // handing out a credential. Everything that reaches this page is generated
  // demo data, and the RFQ form warns before anything is submitted.
  const authorised = DEMO_MODE || (await isAdmin());

  if (!authorised) {
    return (
      <main className="mx-auto max-w-[360px] px-3 pt-16">
        <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[15px] font-bold">
          {t.admin}
        </h1>
        {error && (
          <p className="mb-2 text-[12px] text-[#a3312a]">{t.wrongPassword}</p>
        )}
        <form action={loginAction}>
          <input type="hidden" name="locale" value={l} />
          <label className="block text-[12px]">
            <span className="mb-0.5 block font-bold">{t.password}</span>
            <input type="password" name="password" className="w-full" autoFocus />
          </label>
          <button type="submit" className="btn-primary mt-3 w-full">
            {t.signIn}
          </button>
        </form>
      </main>
    );
  }

  const [fxSettings, rate] = await Promise.all([getFxSettings(), getFxRate()]);

  const orders = await sql<OrderRow[]>`
    SELECT q.id, q.ref, q.company, q.contact_name AS "contactName", q.email,
           q.phone, q.po_number AS "poNumber", q.city, q.country, q.notes,
           q.status, q.locale, q.currency, q.total_cents AS "totalCents",
           q.created_at AS "createdAt",
           (SELECT count(*)::int FROM order_items i WHERE i.order_id = q.id) AS "itemCount"
    FROM orders q ORDER BY q.created_at DESC LIMIT 200
  `;

  const items = orders.length
    ? await sql<OrderItemRow[]>`
        SELECT id, order_id AS "orderId", part_number AS "partNumber",
               family_name AS "familyName", qty,
               unit_price_cents AS "unitPriceCents",
               requested_unit_price_cents AS "requestedUnitPriceCents",
               specs_snapshot AS "specsSnapshot"
        FROM order_items WHERE order_id = ANY(${orders.map((q) => q.id)})
        ORDER BY id
      `
    : [];

  const byOrder = new Map<number, OrderItemRow[]>();
  for (const i of items) {
    if (!byOrder.has(i.orderId)) byOrder.set(i.orderId, []);
    byOrder.get(i.orderId)!.push(i);
  }

  return (
    <main className="mx-auto max-w-[1100px] px-3 pt-3">
      <div className="mb-3 flex items-baseline justify-between border-b border-[var(--color-ink)] pb-1">
        <h1 className="text-[17px] font-bold">
          {t.quoteRequests}{" "}
          <span className="text-[12px] font-normal text-[var(--color-ink-muted)] tech">
            {formatInt(orders.length, l)}
          </span>
        </h1>
        {!DEMO_MODE && (
          <form action={logoutAction}>
            <input type="hidden" name="locale" value={l} />
            <button type="submit" className="text-[11px] underline">
              {t.signOut}
            </button>
          </form>
        )}
      </div>

      <form action={saveFxAction} id="fx-save" className="hidden">
        <input type="hidden" name="locale" value={l} />
      </form>

      {fx === "saved" && (
        <p className="mb-2 border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-3 py-2 text-[12px] text-[var(--color-ok)]">
          {t.exchangeRate}: {formatInt(rate, l)} {t.fxPerUsd}
        </p>
      )}
      {fx === "range" && (
        <p className="mb-2 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
          {t.fxOutOfRange}
        </p>
      )}
      {fx === "invalid" && (
        <p className="mb-2 border border-[#e0b4b0] bg-[#fdf2f1] px-3 py-2 text-[12px] text-[#a3312a]">
          {t.fxInvalid}
        </p>
      )}

      <FxRatePanel
        locale={l}
        mode={fxSettings.mode}
        manualRate={fxSettings.manualRate}
        envRate={envFxRate()}
        effectiveRate={rate}
        disabled={DEMO_MODE}
      />

      {DEMO_MODE && (
        <p className="mb-3 border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px] text-[var(--color-warn)]">
          {t.demoAdminPublic}
        </p>
      )}

      {orders.length === 0 && (
        <p className="py-8 text-[13px] text-[var(--color-ink-muted)]">{t.noQuotes}</p>
      )}

      {orders.map((q) => (
        <details key={q.id} className="mb-2 border border-[var(--color-rule)]">
          <summary className="flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-[var(--color-panel-alt)] px-3 py-2 text-[12px] cursor-pointer">
            <strong className="tech">{q.ref}</strong>
            <span>{q.company}</span>
            <span className="text-[var(--color-ink-muted)]">{q.contactName}</span>
            <span className="tech text-[var(--color-ink-muted)]">{q.email}</span>
            <span className="ms-auto tech text-[var(--color-ink-faint)]">
              {new Date(q.createdAt).toISOString().slice(0, 16).replace("T", " ")}
            </span>
            <span className="tech font-bold">
              {formatPrice(q.totalCents, q.locale === "fa" ? "fa" : "en", rate)}
            </span>
          </summary>

          <div className="px-3 py-2">
            <dl className="mb-2 grid gap-x-6 gap-y-0.5 text-[11px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
              {q.phone && <Row label={t.phone} value={q.phone} tech />}
              {q.poNumber && <Row label={t.poNumber} value={q.poNumber} tech />}
              {q.city && <Row label={t.city} value={q.city} />}
              {q.country && <Row label={t.country} value={q.country} />}
              <Row label={t.status} value={q.status} />
            </dl>
            {q.notes && (
              <p className="mb-2 whitespace-pre-wrap border-s-2 border-[var(--color-rule)] ps-2 text-[11px] text-[var(--color-ink-muted)]">
                {q.notes}
              </p>
            )}
            <table className="spec-table">
              <thead>
                <tr>
                  <th>{t.partNumber}</th>
                  <th>{t.products}</th>
                  <th className="num">{t.qty}</th>
                  <th className="num">{t.unitPrice}</th>
                  <th className="num">{t.lineTotal}</th>
                </tr>
              </thead>
              <tbody>
                {(byOrder.get(q.id) ?? []).map((i, idx) => (
                  <tr key={`${i.partNumber}-${idx}`}>
                    <td className="tech font-bold">{i.partNumber}</td>
                    <td className="whitespace-normal">{i.familyName}</td>
                    <td className="num tech tech-num">{i.qty}</td>
                    <td className="num tech tech-num">
                      {formatPrice(i.unitPriceCents, q.locale === "fa" ? "fa" : "en", rate)}
                    </td>
                    <td className="num tech tech-num">
                      {formatPrice(i.unitPriceCents * i.qty, q.locale === "fa" ? "fa" : "en", rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </main>
  );
}

function Row({ label, value, tech }: { label: string; value: string; tech?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <dt className="font-bold">{label}:</dt>
      <dd className={tech ? "tech" : undefined}>{value}</dd>
    </div>
  );
}
