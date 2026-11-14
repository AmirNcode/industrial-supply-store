/**
 * The words of every email, in both languages. Pure: no database, no request —
 * the caller passes amounts already formatted, so these are testable and a
 * template can never disagree with the page about what is owed.
 *
 * Plain on purpose. One column, no images, no tracking: these land in the
 * inboxes of purchasing departments behind strict filters, and the Persian
 * versions must read right-to-left in clients that ignore stylesheets, hence
 * `dir` on the wrapper and nothing left to CSS.
 */
import type { Locale } from "./i18n";

export type EmailContent = { subject: string; text: string; html: string };

type Row = readonly [label: string, value: string];

type Block = {
  locale: Locale;
  subject: string;
  /** Paragraphs above the facts. */
  intro: string[];
  /** Label/value facts, printed as a small table. */
  rows?: Row[];
  /** The one thing to do next, as a link. */
  action?: { label: string; url: string };
  /** Paragraphs below the link. */
  outro?: string[];
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function render(block: Block): EmailContent {
  const rtl = block.locale === "fa";
  const brand = "TEMEX";
  const sign = rtl ? "تیمکس — ابزار، تجهیزات و مواد" : "TEMEX — Tools, Equipment & Materials";
  const text = [
    ...block.intro,
    ...(block.rows?.length ? [block.rows.map(([label, value]) => `${label}: ${value}`).join("\n")] : []),
    ...(block.action ? [`${block.action.label}:\n${block.action.url}`] : []),
    ...(block.outro ?? []),
    sign,
  ].join("\n\n");

  const p = (line: string) => `<p style="margin:0 0 14px">${escapeHtml(line)}</p>`;
  const align = rtl ? "right" : "left";
  const rows = block.rows?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;width:100%">${block.rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:6px 0;border-bottom:1px solid #e3e6ea;color:#55606e;text-align:${align}">${escapeHtml(label)}</td>` +
            `<td style="padding:6px 0;border-bottom:1px solid #e3e6ea;font-weight:bold;text-align:${rtl ? "left" : "right"}"><bdi>${escapeHtml(value)}</bdi></td></tr>`,
        )
        .join("")}</table>`
    : "";
  const action = block.action
    ? `<p style="margin:0 0 18px"><a href="${escapeHtml(block.action.url)}" style="display:inline-block;background:#1e3266;color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 18px">${escapeHtml(block.action.label)}</a></p>` +
      `<p style="margin:0 0 14px;font-size:12px;color:#55606e;word-break:break-all" dir="ltr">${escapeHtml(block.action.url)}</p>`
    : "";
  const html =
    `<!doctype html><html lang="${block.locale}" dir="${rtl ? "rtl" : "ltr"}"><body style="margin:0;background:#f4f5f7">` +
    `<div dir="${rtl ? "rtl" : "ltr"}" style="max-width:560px;margin:0 auto;padding:24px 20px;background:#ffffff;font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.7;color:#1a2230;text-align:${align}">` +
    `<p style="margin:0 0 18px;font-size:18px;font-weight:bold;color:#1e3266" dir="ltr">${brand}</p>` +
    block.intro.map(p).join("") +
    rows +
    action +
    (block.outro ?? []).map(p).join("") +
    `<p style="margin:18px 0 0;font-size:12px;color:#55606e">${escapeHtml(sign)}</p>` +
    `</div></body></html>`;
  return { subject: block.subject, text, html };
}

export type OrderFacts = {
  locale: Locale;
  ref: string;
  company: string;
  /** The total due with VAT, formatted with its currency. */
  total: string;
  /** The page for this one order: status, bank details, receipt upload. */
  payUrl: string;
};

/** Checkout issued a pish-factor: here is what to pay, where, and by when. */
export function pishFactorEmail(
  o: OrderFacts & { deadline: string; hours: number; documentUrl: string },
): EmailContent {
  return o.locale === "fa"
    ? render({
        locale: "fa",
        subject: `پیش‌فاکتور سفارش ${o.ref} — تیمکس`,
        intro: [
          `${o.company} عزیز،`,
          `سفارش شما ثبت شد و پیش‌فاکتور آن آماده است. کالاهای این سفارش تا ${o.hours} ساعت برای شما نگه داشته می‌شود.`,
        ],
        rows: [
          ["شماره سفارش", o.ref],
          ["مبلغ قابل پرداخت (با مالیات)", o.total],
          ["هزینه ارسال", "رایگان"],
          ["مهلت پرداخت", o.deadline],
        ],
        action: { label: "مشاهده اطلاعات حساب و بارگذاری رسید", url: o.payUrl },
        outro: [
          "پس از واریز، تصویر رسید را در همین صفحه بارگذاری کنید. اگر تا پایان مهلت رسیدی ثبت نشود، سفارش به‌طور خودکار لغو و کالا آزاد می‌شود.",
          `پیش‌فاکتور: ${o.documentUrl}`,
        ],
      })
    : render({
        locale: "en",
        subject: `Pro forma invoice for order ${o.ref} — TEMEX`,
        intro: [
          `Dear ${o.company},`,
          `Your order is placed and its pro forma invoice (pish-factor) is ready. The goods are held for you for ${o.hours} hours.`,
        ],
        rows: [
          ["Order", o.ref],
          ["Amount due (incl. VAT)", o.total],
          ["Delivery", "Free"],
          ["Pay by", o.deadline],
        ],
        action: { label: "Bank details and receipt upload", url: o.payUrl },
        outro: [
          "After the transfer, upload a photo of the receipt on that page. If no receipt arrives by the deadline, the order is cancelled automatically and the goods are released.",
          `Pro forma invoice: ${o.documentUrl}`,
        ],
      });
}

/** A request that needs staff: nothing to pay yet. */
export function quoteRequestEmail(o: Omit<OrderFacts, "total"> & { days: number }): EmailContent {
  return o.locale === "fa"
    ? render({
        locale: "fa",
        subject: `درخواست استعلام ${o.ref} دریافت شد — تیمکس`,
        intro: [
          `${o.company} عزیز،`,
          `درخواست شما ثبت شد. کارشناسان فروش قیمت و زمان تحویل را بررسی می‌کنند و حداکثر تا ${o.days} روز نتیجه را برای شما می‌فرستند. فعلاً نیازی به پرداخت نیست.`,
        ],
        rows: [["شماره درخواست", o.ref]],
        action: { label: "پیگیری درخواست", url: o.payUrl },
      })
    : render({
        locale: "en",
        subject: `Quote request ${o.ref} received — TEMEX`,
        intro: [
          `Dear ${o.company},`,
          `Your request is in. Our sales team is confirming price and lead time and will send your quote within ${o.days} days. There is nothing to pay yet.`,
        ],
        rows: [["Request", o.ref]],
        action: { label: "Follow this request", url: o.payUrl },
      });
}

/** Staff priced the request: accept to get the pish-factor. */
export function quoteReadyEmail(o: OrderFacts & { deadline: string }): EmailContent {
  return o.locale === "fa"
    ? render({
        locale: "fa",
        subject: `استعلام ${o.ref} آماده است — تیمکس`,
        intro: [`${o.company} عزیز،`, "قیمت درخواست شما آماده است. با تأیید آن، پیش‌فاکتور صادر می‌شود و می‌توانید پرداخت کنید."],
        rows: [
          ["شماره درخواست", o.ref],
          ["مبلغ (پیش از مالیات)", o.total],
          ["اعتبار استعلام تا", o.deadline],
        ],
        action: { label: "مشاهده و تأیید استعلام", url: o.payUrl },
        outro: ["مبلغ ریالی نهایی با نرخ روزِ تأیید محاسبه و در پیش‌فاکتور ثابت می‌شود."],
      })
    : render({
        locale: "en",
        subject: `Your quote ${o.ref} is ready — TEMEX`,
        intro: [`Dear ${o.company},`, "Your quote is ready. Accept it to receive the pro forma invoice and pay."],
        rows: [
          ["Request", o.ref],
          ["Amount (before VAT)", o.total],
          ["Quote valid until", o.deadline],
        ],
        action: { label: "View and accept the quote", url: o.payUrl },
        outro: ["The final rial amount is set at the exchange rate on the day you accept, and fixed on the pro forma invoice."],
      });
}

/** Payment confirmed: the numbered invoice now exists. */
export function paymentConfirmedEmail(o: OrderFacts & { invoiceNumber: string; documentUrl: string }): EmailContent {
  return o.locale === "fa"
    ? render({
        locale: "fa",
        subject: `پرداخت سفارش ${o.ref} تأیید شد — تیمکس`,
        intro: [`${o.company} عزیز،`, "پرداخت شما تأیید شد و فاکتور رسمی صادر گردید. سفارش در حال آماده‌سازی است."],
        rows: [
          ["شماره سفارش", o.ref],
          ["شماره فاکتور", o.invoiceNumber],
          ["مبلغ پرداخت‌شده", o.total],
        ],
        action: { label: "مشاهده فاکتور", url: o.documentUrl },
        outro: [`پیگیری سفارش: ${o.payUrl}`],
      })
    : render({
        locale: "en",
        subject: `Payment confirmed for order ${o.ref} — TEMEX`,
        intro: [`Dear ${o.company},`, "Your payment is confirmed and the official invoice has been issued. Your order is being prepared."],
        rows: [
          ["Order", o.ref],
          ["Invoice number", o.invoiceNumber],
          ["Amount paid", o.total],
        ],
        action: { label: "View the invoice", url: o.documentUrl },
        outro: [`Follow your order: ${o.payUrl}`],
      });
}

/** The deadline passed with nothing received. */
export function orderExpiredEmail(o: Omit<OrderFacts, "total"> & { was: "invoiced" | "quoted"; shopUrl: string }): EmailContent {
  const fa =
    o.was === "invoiced"
      ? "مهلت پرداخت این سفارش به پایان رسید و رسیدی دریافت نشد؛ سفارش لغو و کالا آزاد شد."
      : "اعتبار این استعلام به پایان رسید و تأیید نشد؛ درخواست بسته شد.";
  const en =
    o.was === "invoiced"
      ? "The payment window for this order closed with no receipt, so the order was cancelled and the goods released."
      : "This quote was not accepted before it lapsed, so the request was closed.";
  return o.locale === "fa"
    ? render({
        locale: "fa",
        subject: `سفارش ${o.ref} منقضی شد — تیمکس`,
        intro: [`${o.company} عزیز،`, fa, "اگر هنوز به این کالاها نیاز دارید، می‌توانید دوباره سفارش دهید."],
        rows: [["شماره سفارش", o.ref]],
        action: { label: "بازگشت به فروشگاه", url: o.shopUrl },
        outro: ["اگر پرداخت کرده‌اید و این پیام را دریافت کرده‌اید، لطفاً با ما تماس بگیرید."],
      })
    : render({
        locale: "en",
        subject: `Order ${o.ref} expired — TEMEX`,
        intro: [`Dear ${o.company},`, en, "If you still need these items you are welcome to order again."],
        rows: [["Order", o.ref]],
        action: { label: "Back to the store", url: o.shopUrl },
        outro: ["If you did pay and still received this message, please contact us."],
      });
}

/** The one-time sign-in code. */
export function loginCodeEmail(o: { locale: Locale; code: string; minutes: number }): EmailContent {
  return o.locale === "fa"
    ? render({
        locale: "fa",
        subject: "کد ورود به تیمکس",
        intro: ["برای ورود به حساب کاربری خود در تیمکس، این کد را وارد کنید:"],
        rows: [["کد ورود", o.code]],
        outro: [`این کد ${o.minutes} دقیقه اعتبار دارد و فقط یک بار قابل استفاده است. اگر شما درخواست نکرده‌اید، این پیام را نادیده بگیرید.`],
      })
    : render({
        locale: "en",
        subject: "Your TEMEX sign-in code",
        intro: ["Enter this code to sign in to your TEMEX account:"],
        rows: [["Sign-in code", o.code]],
        outro: [`The code works once and for ${o.minutes} minutes. If you did not ask for it, ignore this message.`],
      });
}

/** To staff, in Persian: the people reading the queue work in it. */
export function staffNewOrderEmail(o: {
  ref: string;
  company: string;
  contactName: string;
  phone: string;
  kind: "pish-factor" | "quote-request";
  total: string;
  adminUrl: string;
  quoteDays: number;
}): EmailContent {
  const isQuote = o.kind === "quote-request";
  return render({
    locale: "fa",
    subject: isQuote ? `استعلام جدید ${o.ref} — نیاز به قیمت‌گذاری` : `سفارش جدید ${o.ref} — پیش‌فاکتور صادر شد`,
    intro: [
      isQuote
        ? `یک درخواست استعلام جدید ثبت شده است. تا ${o.quoteDays} روز فرصت قیمت‌گذاری دارید؛ پس از آن کالای نگه‌داشته‌شده آزاد می‌شود.`
        : "یک سفارش جدید ثبت شد و پیش‌فاکتور آن به‌طور خودکار برای مشتری ارسال گردید. منتظر رسید پرداخت باشید.",
    ],
    rows: [
      ["شماره", o.ref],
      ["شرکت", o.company],
      ["نام", o.contactName],
      ["تلفن", o.phone],
      ["مبلغ (پیش از مالیات)", o.total],
    ],
    action: { label: "باز کردن صف سفارش‌ها", url: o.adminUrl },
  });
}

/**
 * To staff and the order's reps when a customer cancels before paying. In
 * Persian, like the other staff mail: it goes to the team, not the customer.
 */
export function orderCancelledByCustomerEmail(o: {
  ref: string;
  company: string;
  contactName: string;
  phone: string;
  reason: string;
  url: string;
}): EmailContent {
  return render({
    locale: "fa",
    subject: `سفارش ${o.ref} توسط مشتری لغو شد`,
    intro: ["مشتری این سفارش را پیش از ارسال رسید پرداخت لغو کرد. کالای نگه‌داشته‌شده برای آن آزاد شد."],
    rows: [
      ["شماره", o.ref],
      ["شرکت", o.company],
      ["نام", o.contactName],
      ["تلفن", o.phone],
      ["دلیل", o.reason || "—"],
    ],
    action: { label: "مشاهده سفارش", url: o.url },
  });
}
