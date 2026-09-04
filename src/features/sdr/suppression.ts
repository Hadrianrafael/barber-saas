import "server-only";
import { prisma } from "@/server/db/client";
import { normalizeEmail, normalizePhone, isEmail } from "./phone";

/**
 * Do-not-contact list. Anything here is never messaged again, on any channel,
 * by any campaign. Populated by opt-out keywords, bounces, complaints and manual
 * admin action. LGPD / Meta opt-out compliance depends on this being checked
 * before every send — see `guard.assertContactable`.
 */

export type SuppressionKind = "PHONE" | "EMAIL";

function keyFor(recipient: string): { kind: SuppressionKind; value: string } | null {
  if (isEmail(recipient)) {
    const v = normalizeEmail(recipient);
    return v ? { kind: "EMAIL", value: v } : null;
  }
  const v = normalizePhone(recipient);
  return v ? { kind: "PHONE", value: v } : null;
}

export async function isSuppressed(recipient: string): Promise<boolean> {
  const k = keyFor(recipient);
  if (!k) return true; // unparseable → do not send
  const hit = await prisma.salesSuppression.findUnique({
    where: { kind_value: { kind: k.kind, value: k.value } },
  });
  return !!hit;
}

export async function addSuppression(
  recipient: string,
  reason: string,
  source: string,
): Promise<void> {
  const k = keyFor(recipient);
  if (!k) return;
  await prisma.salesSuppression.upsert({
    where: { kind_value: { kind: k.kind, value: k.value } },
    create: { kind: k.kind, value: k.value, reason, source },
    update: { reason, source },
  });
}

export async function removeSuppression(recipient: string): Promise<void> {
  const k = keyFor(recipient);
  if (!k) return;
  await prisma.salesSuppression
    .delete({ where: { kind_value: { kind: k.kind, value: k.value } } })
    .catch(() => undefined);
}

// Opt-out intent detection on inbound messages. Conservative — a lead only needs
// to say it once. Matches whole words / short phrases in pt/en/es.
const OPT_OUT_PATTERNS = [
  /\bpar[ae]\b/i,
  /\bparar?\b/i,
  /n[aã]o\s+(quero|tenho\s+interesse|me\s+manda|envie)/i,
  /\bdescadastr/i,
  /\bsair\s+da\s+lista\b/i,
  /\bme\s+tir[ae]\b/i,
  /\bn[aã]o\s+perturbe\b/i,
  /\bstop\b/i,
  /\bunsubscribe\b/i,
  /\bopt[\s-]?out\b/i,
  /\bremove\s+me\b/i,
  /\bdo\s+not\s+contact\b/i,
  /\bd[ae]j[ae]\s+de\b/i,
  /\bno\s+(me\s+)?(escrib|contact|interesa)/i,
  /\bbaja\b/i,
];

export function detectOptOut(text: string): boolean {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return false;
  if (t.length <= 40 && /^(par[ae]|parar|stop|sair|baja)\b/.test(t)) return true;
  return OPT_OUT_PATTERNS.some((re) => re.test(t));
}
