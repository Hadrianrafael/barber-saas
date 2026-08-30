import "server-only";
import { prisma } from "@/server/db/client";

export type Channel = "EMAIL" | "WHATSAPP" | "SMS";
export type Category = "transactional" | "marketing";

/**
 * Consent policy:
 * - anonymized / blocked customer → never
 * - WhatsApp / SMS → require an explicit granted opt-in (revokedAt null), for
 *   BOTH transactional and marketing (platform policy + safety)
 * - Email → transactional allowed unless the customer explicitly opted OUT;
 *   marketing requires opt-in
 */
export async function canContact(
  customerId: string,
  channel: Channel,
  category: Category,
): Promise<{ ok: boolean; reason?: string }> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      status: true,
      anonymizedAt: true,
      consents: true,
      email: true,
      phone: true,
      whatsapp: true,
    },
  });
  if (!customer) return { ok: false, reason: "customer_not_found" };
  if (customer.anonymizedAt || customer.status === "BLOCKED") {
    return { ok: false, reason: "customer_unavailable" };
  }

  const consent = customer.consents.find((c) => c.channel === channel);
  const optedIn = !!consent?.granted && !consent.revokedAt;
  const optedOut = !!consent && (!consent.granted || !!consent.revokedAt);

  if (channel === "EMAIL") {
    if (!customer.email) return { ok: false, reason: "no_address" };
    if (category === "marketing" && !optedIn) return { ok: false, reason: "no_opt_in" };
    if (optedOut) return { ok: false, reason: "opted_out" };
    return { ok: true };
  }

  // WhatsApp / SMS
  const addr = channel === "WHATSAPP" ? (customer.whatsapp ?? customer.phone) : customer.phone;
  if (!addr) return { ok: false, reason: "no_address" };
  if (!optedIn) return { ok: false, reason: "no_opt_in" };
  return { ok: true };
}
