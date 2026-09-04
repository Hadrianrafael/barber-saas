/**
 * Phone / contact normalisation for the SDR module. Keep this tiny and
 * dependency-free — leads come from messy spreadsheets.
 */

/** Digits only, drop a leading 00 / +, add BR country code (55) when it looks
 * like a bare local number. Returns "" when there aren't enough digits. */
export function normalizePhone(raw: string | null | undefined, defaultCountry = "55"): string {
  if (!raw) return "";
  let d = String(raw).replace(/\D/g, "");
  d = d.replace(/^0+/, "");
  if (d.length >= 10 && d.length <= 11 && !d.startsWith(defaultCountry)) {
    // bare BR number (with or without the 9th digit) → prepend 55
    d = defaultCountry + d;
  }
  return d.length >= 11 && d.length <= 15 ? d : "";
}

export function normalizeEmail(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Stable dedupe key for a lead: prefer whatsapp/phone, else email. */
export function dedupeKey(input: {
  whatsapp?: string | null;
  phone?: string | null;
  email?: string | null;
}): string | null {
  const wa = normalizePhone(input.whatsapp);
  if (wa) return `p:${wa}`;
  const ph = normalizePhone(input.phone);
  if (ph) return `p:${ph}`;
  const em = normalizeEmail(input.email);
  if (em && isEmail(em)) return `e:${em}`;
  return null;
}
