import { ShareButton } from "./ShareButton";
import { groupInFours, type BankDetails } from "@/lib/bankDetails";
import { getDict, type Locale } from "@/lib/i18n";

/**
 * Card-to-card and Sheba transfers are made from a banking app on the same
 * phone, so every number has a Copy control: typing 16 to 26 digits by hand
 * is where payments go astray. Numbers read left to right in Latin digits,
 * like part numbers, and are grouped in fours only here.
 */
export function BankDetailsPanel({ locale, bank }: { locale: Locale; bank: BankDetails }) {
  const t = getDict(locale);
  const rows: { label: string; value: string; copy?: string }[] = [];
  if (bank.name) rows.push({ label: t.bankName, value: bank.name });
  if (bank.holder) rows.push({ label: t.bankHolder, value: bank.holder });
  if (bank.card) rows.push({ label: t.bankCard, value: groupInFours(bank.card), copy: bank.card });
  if (bank.sheba) rows.push({ label: t.bankSheba, value: groupInFours(bank.sheba), copy: bank.sheba });
  if (bank.account) rows.push({ label: t.bankAccount, value: bank.account, copy: bank.account });

  return (
    <section aria-labelledby="bank-heading" className="mb-4 border border-[var(--color-rule)] p-3 text-[12px]">
      <h2 id="bank-heading" className="mb-2 text-[13px] font-bold">{t.payByTransfer}</h2>
      <dl className="grid gap-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-center gap-x-3">
            <dt className="font-bold">{row.label}</dt>
            <dd className={row.copy ? "tech" : undefined} dir={row.copy ? "ltr" : undefined}>{row.value}</dd>
            {row.copy && (
              <ShareButton text={row.copy} label={t.copy} copiedLabel={t.copied} copyOnly className="text-[11px] underline" />
            )}
          </div>
        ))}
      </dl>
      {bank.note &&
        bank.note.split(/\n{2,}/).map((paragraph, i) => (
          <p key={i} className="mt-2 whitespace-pre-line">{paragraph}</p>
        ))}
    </section>
  );
}
