import "server-only";
import type { PayoutAccountStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { paymentProvider } from "@/server/payments";

/**
 * Stripe Connect onboarding + status for a barbershop's own account. This is the
 * **client → barbershop** money flow — entirely separate from the SaaS
 * subscription billing (src/features/billing). Never mixed.
 */

export function mapAccountStatus(a: {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirements: unknown;
}): PayoutAccountStatus {
  const req = (a.requirements ?? {}) as {
    disabled_reason?: string | null;
    currently_due?: string[];
    past_due?: string[];
    pending_verification?: string[];
  };
  if (req.disabled_reason) {
    return req.disabled_reason.startsWith("rejected") ? "DISABLED" : "RESTRICTED";
  }
  if (a.chargesEnabled && a.payoutsEnabled) return "ENABLED";
  if ((req.past_due?.length ?? 0) > 0 || (req.currently_due?.length ?? 0) > 0) {
    return "PENDING_VERIFICATION";
  }
  if ((req.pending_verification?.length ?? 0) > 0) return "PENDING_VERIFICATION";
  return "ONBOARDING";
}

async function ensurePayoutAccount(tenantId: string) {
  return prisma.payoutAccount.upsert({
    where: { tenantId },
    create: { tenantId, provider: "stripe", status: "NOT_CONNECTED" },
    update: {},
  });
}

export async function startConnectOnboarding(
  tenantId: string,
  locale: string,
): Promise<{ url: string }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { country: true, email: true, name: true },
  });
  if (!tenant) throw new Error("tenant not found");

  const acct = await ensurePayoutAccount(tenantId);
  const base = `${env.APP_URL}/${locale}/payments`;
  const { accountId, onboardingUrl } = await paymentProvider.createConnectOnboarding({
    tenantId,
    country: tenant.country || "BR",
    email: tenant.email ?? `owner+${tenantId}@example.com`,
    refreshUrl: `${base}?connect=refresh`,
    returnUrl: `${base}?connect=return`,
    existingAccountId: acct.providerAccountId ?? undefined,
  });

  await prisma.payoutAccount.update({
    where: { tenantId },
    data: {
      providerAccountId: accountId,
      status: acct.status === "NOT_CONNECTED" ? "ONBOARDING" : acct.status,
    },
  });
  logger.info({ tenantId, accountId }, "connect.onboarding.started");
  return { url: onboardingUrl };
}

export async function refreshConnectStatus(tenantId: string) {
  const acct = await prisma.payoutAccount.findUnique({ where: { tenantId } });
  if (!acct?.providerAccountId) return null;

  const status = await paymentProvider.getConnectAccountStatus(acct.providerAccountId);
  const mapped = mapAccountStatus(status);
  const updated = await prisma.payoutAccount.update({
    where: { tenantId },
    data: {
      status: mapped,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
      requirements: (status.requirements ?? undefined) as object | undefined,
      onboardedAt: mapped === "ENABLED" && !acct.onboardedAt ? new Date() : acct.onboardedAt,
    },
  });
  logger.info({ tenantId, status: mapped }, "connect.status.refreshed");
  return updated;
}

/** Handles `account.updated` from the Connect webhook. */
export async function applyAccountUpdate(account: {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: unknown;
}) {
  const acct = await prisma.payoutAccount.findFirst({
    where: { providerAccountId: account.id },
  });
  if (!acct) return;
  const mapped = mapAccountStatus({
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    requirements: account.requirements,
  });
  await prisma.payoutAccount.update({
    where: { tenantId: acct.tenantId },
    data: {
      status: mapped,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      requirements: (account.requirements ?? undefined) as object | undefined,
      onboardedAt: mapped === "ENABLED" && !acct.onboardedAt ? new Date() : acct.onboardedAt,
    },
  });
}

export async function getPayoutAccount(tenantId: string) {
  return prisma.payoutAccount.findUnique({ where: { tenantId } });
}

export async function requireEnabledAccount(tenantId: string) {
  const acct = await prisma.payoutAccount.findUnique({ where: { tenantId } });
  if (!acct?.providerAccountId || !acct.chargesEnabled) {
    const e = new Error("connect_account_not_ready");
    e.name = "ConnectNotReadyError";
    throw e;
  }
  return acct;
}
