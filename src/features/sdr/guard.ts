import "server-only";
import type { SalesLead } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { isTestMode, inAllowlist, getSdrSettings } from "./settings";
import { isSuppressed } from "./suppression";
import { normalizePhone, normalizeEmail } from "./phone";

/**
 * The single choke point for outbound sales contact. NOTHING sends without
 * passing `assertContactable`. Order matters:
 *
 *   1. suppression list  (opt-out / bounce / manual)   — hard block
 *   2. lead already opted out / not-interested          — hard block
 *   3. TEST MODE  → recipient must be in the allowlist  — block otherwise
 *   4. PRODUCTION → lead must have a recorded consent    — block otherwise
 *      basis (OPT_IN / LEGITIMATE_INTEREST / EXISTING_RELATIONSHIP)
 *   5. global daily cap not exceeded
 *
 * (4) is what keeps this compliant: importing a spreadsheet does NOT make a
 * lead contactable in production — a human must record a lawful basis first.
 */

export type ContactChannel = "WHATSAPP" | "EMAIL";

export interface ContactDecision {
  ok: boolean;
  reason?: string;
  recipient: string;
}

function recipientFor(lead: Pick<SalesLead, "whatsapp" | "phone" | "email">, channel: ContactChannel) {
  if (channel === "EMAIL") return normalizeEmail(lead.email);
  return normalizePhone(lead.whatsapp) || normalizePhone(lead.phone);
}

export async function assertContactable(
  lead: SalesLead,
  channel: ContactChannel,
): Promise<ContactDecision> {
  const recipient = recipientFor(lead, channel);
  if (!recipient) return { ok: false, reason: "no valid recipient for channel", recipient: "" };

  if (lead.status === "OPT_OUT" || lead.optOutAt) {
    return { ok: false, reason: "lead opted out", recipient };
  }
  if (lead.status === "SEM_INTERESSE") {
    return { ok: false, reason: "lead marked not interested", recipient };
  }
  if (await isSuppressed(recipient)) {
    return { ok: false, reason: "recipient on suppression list", recipient };
  }

  if (await isTestMode()) {
    if (!(await inAllowlist(recipient))) {
      return { ok: false, reason: "TEST MODE: recipient not in allowlist", recipient };
    }
    return { ok: true, recipient };
  }

  // production
  if (!lead.consentBasis) {
    return {
      ok: false,
      reason: "PRODUCTION: no lawful contact basis recorded for this lead",
      recipient,
    };
  }
  const settings = await getSdrSettings();
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const sentToday = await prisma.salesMessage.count({
    where: { direction: "OUTBOUND", createdAt: { gte: since }, status: { not: "FAILED" } },
  });
  if (sentToday >= settings.dailyGlobalCap) {
    return { ok: false, reason: "global daily cap reached", recipient };
  }

  return { ok: true, recipient };
}

/** Cheap check for the UI (does not enforce the daily cap). */
export async function previewContactable(lead: SalesLead, channel: ContactChannel) {
  const d = await assertContactable(lead, channel);
  return d;
}
