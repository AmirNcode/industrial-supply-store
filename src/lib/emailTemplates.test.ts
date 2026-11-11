import { test } from "node:test";
import assert from "node:assert/strict";
import { loginCodeEmail, pishFactorEmail, staffNewOrderEmail } from "./emailTemplates";

const facts = {
  ref: "ORD-ABC234",
  company: "Pars <Pump> & Co",
  total: "1,200,000 IRR",
  payUrl: "https://temex.ir/en/pay/abc",
  deadline: "12 Nov 2026, 14:00",
  hours: 24,
  documentUrl: "https://temex.ir/en/invoice/ORD-ABC234?key=abc",
};

test("the pish-factor email carries the amount, deadline and pay link in both forms", () => {
  const mail = pishFactorEmail({ ...facts, locale: "en" });
  for (const body of [mail.text, mail.html]) {
    assert.match(body, /ORD-ABC234/);
    assert.match(body, /1,200,000 IRR/);
    assert.match(body, /12 Nov 2026, 14:00/);
    assert.match(body, /https:\/\/temex\.ir\/en\/pay\/abc/);
    assert.match(body, /Delivery[\s\S]*Free/);
  }
});

test("typed text is escaped in the HTML and left alone in the plain text", () => {
  const mail = pishFactorEmail({ ...facts, locale: "en" });
  assert.match(mail.html, /Pars &lt;Pump&gt; &amp; Co/);
  assert.doesNotMatch(mail.html, /<Pump>/);
  assert.match(mail.text, /Pars <Pump> & Co/);
});

test("the Persian version is right-to-left", () => {
  const mail = pishFactorEmail({ ...facts, locale: "fa" });
  assert.match(mail.html, /<html lang="fa" dir="rtl">/);
  assert.match(mail.subject, /پیش‌فاکتور/);
});

// The subject is stored in email_log even when the body is withheld, and the
// admin email log is readable with the shared admin password — a code there
// would let staff sign in as the customer. It also shows in lock-screen previews.
test("the sign-in code is in the body but never the subject", () => {
  for (const locale of ["en", "fa"] as const) {
    const mail = loginCodeEmail({ locale, code: "482913", minutes: 10 });
    assert.doesNotMatch(mail.subject, /482913/);
    assert.match(mail.text, /482913/);
  }
});

test("the staff alert says which kind of order it is", () => {
  const base = { ref: "ORD-X", company: "A", contactName: "B", phone: "1", total: "$1", adminUrl: "u", quoteDays: 5 };
  assert.match(staffNewOrderEmail({ ...base, kind: "quote-request" }).subject, /استعلام/);
  assert.match(staffNewOrderEmail({ ...base, kind: "pish-factor" }).subject, /پیش‌فاکتور/);
});
