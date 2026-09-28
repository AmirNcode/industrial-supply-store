import { latinDigits } from "./digits";
import type { Locale } from "./i18n";

/**
 * The business's bank account, shown to customers paying by transfer.
 *
 * Pure, so the admin form can run exactly the checks the server runs, before
 * anything is sent. Card and Sheba numbers carry check digits; checking them
 * is what stops a one-digit typo from being printed on every pay page and
 * sending customers' money nowhere.
 */
export type BankFields = {
  nameEn: string;
  nameFa: string;
  holderEn: string;
  holderFa: string;
  card: string;
  sheba: string;
  account: string;
  noteEn: string;
  noteFa: string;
};

export const BANK_SETTING_KEYS: Record<keyof BankFields, string> = {
  nameEn: "bank_name_en",
  nameFa: "bank_name_fa",
  holderEn: "bank_holder_en",
  holderFa: "bank_holder_fa",
  card: "bank_card",
  sheba: "bank_sheba",
  account: "bank_account",
  noteEn: "bank_note_en",
  noteFa: "bank_note_fa",
};

export const EMPTY_BANK_FIELDS: BankFields = {
  nameEn: "", nameFa: "", holderEn: "", holderFa: "",
  card: "", sheba: "", account: "", noteEn: "", noteFa: "",
};

const TEXT_MAX = 200;
const NOTE_MAX = 1000;

export function normalizeCard(raw: string): string {
  return latinDigits(raw).replace(/[\s-]/g, "");
}

/** Sixteen digits passing the Luhn check every Shetab card number carries. */
export function isValidCard(value: string): boolean {
  if (!/^\d{16}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let digit = Number(value[15 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Upper-case, no spaces; 24 bare digits get their IR prefix. */
export function normalizeSheba(raw: string): string {
  const value = latinDigits(raw).replace(/[\s-]/g, "").toUpperCase();
  return /^\d{24}$/.test(value) ? `IR${value}` : value;
}

/** IR and 24 digits passing the ISO 13616 mod-97 check (I = 18, R = 27). */
export function isValidSheba(value: string): boolean {
  if (!/^IR\d{24}$/.test(value)) return false;
  const rearranged = `${value.slice(4)}1827${value.slice(2, 4)}`;
  let remainder = 0;
  for (const ch of rearranged) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

export function normalizeAccount(raw: string): string {
  return latinDigits(raw).replace(/\s+/g, "");
}

/** Banks format account numbers differently; 4–30 digits with - or . between. */
export function isValidAccount(value: string): boolean {
  const digits = value.replace(/[.-]/g, "");
  return /^[0-9][0-9.-]*[0-9]$/.test(value) && digits.length >= 4 && digits.length <= 30;
}

export type BankProblem = "card" | "sheba" | "account" | "length";

export function validateBankFields(
  raw: BankFields,
): { ok: true; values: BankFields } | { ok: false; problems: BankProblem[] } {
  const values: BankFields = {
    nameEn: raw.nameEn.trim(),
    nameFa: raw.nameFa.trim(),
    holderEn: raw.holderEn.trim(),
    holderFa: raw.holderFa.trim(),
    card: normalizeCard(raw.card),
    sheba: normalizeSheba(raw.sheba),
    account: normalizeAccount(raw.account),
    noteEn: raw.noteEn.trim(),
    noteFa: raw.noteFa.trim(),
  };
  const problems: BankProblem[] = [];
  if (values.card && !isValidCard(values.card)) problems.push("card");
  if (values.sheba && !isValidSheba(values.sheba)) problems.push("sheba");
  if (values.account && !isValidAccount(values.account)) problems.push("account");
  const texts = [values.nameEn, values.nameFa, values.holderEn, values.holderFa];
  if (
    texts.some((text) => text.length > TEXT_MAX) ||
    values.noteEn.length > NOTE_MAX ||
    values.noteFa.length > NOTE_MAX
  ) {
    problems.push("length");
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, values };
}

export type BankDetails = {
  name: string;
  holder: string;
  card: string;
  sheba: string;
  account: string;
  note: string;
};

/** The reader's language first, the other one when theirs is blank; null when nothing is filled. */
export function resolveBankDetails(values: BankFields, locale: Locale): BankDetails | null {
  const text = (en: string, fa: string) => (locale === "fa" ? fa || en : en || fa);
  const details: BankDetails = {
    name: text(values.nameEn, values.nameFa),
    holder: text(values.holderEn, values.holderFa),
    card: values.card,
    sheba: values.sheba,
    account: values.account,
    note: text(values.noteEn, values.noteFa),
  };
  return Object.values(details).some((value) => value !== "") ? details : null;
}

/** Display only; stored numbers have no spaces. */
export function groupInFours(value: string): string {
  return value.replace(/(.{4})(?=.)/g, "$1 ");
}
