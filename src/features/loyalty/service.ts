import "server-only";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { generateToken } from "@/lib/crypto";
import { parseLoyaltyConfig, pointsForVisit } from "./config";

export class LoyaltyError extends Error {
  code: "DISABLED" | "NOT_FOUND" | "INSUFFICIENT_POINTS" | "INVALID";
  constructor(code: LoyaltyError["code"], message?: string) {
    super(message ?? code);
    this.name = "LoyaltyError";
    this.code = code;
  }
}

interface Actor {
  userId: string | null;
  label: string;
}

/**
 * Guard: the customer must belong to this tenant. Every points mutation runs
 * this first so a crafted request with another tenant's customerId is rejected
 * server-side (the UI only ever surfaces same-tenant customers, but the UI is
 * not the authority).
 */
async function assertCustomerInTenant(tenantId: string, customerId: string) {
  const n = await prisma.customer.count({ where: { id: customerId, tenantId } });
  if (n === 0) throw new LoyaltyError("NOT_FOUND", "customer not in tenant");
}

/**
 * Award points for a completed appointment. Idempotent: the unique
 * `(appointmentId, reason)` index means a second call (e.g. re-complete) is a
 * no-op. Called from the scheduling `transition` COMPLETED handler.
 */
export async function earnForCompletedAppointment(tenantId: string, appointmentId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { loyaltyConfig: true },
  });
  const cfg = parseLoyaltyConfig(tenant?.loyaltyConfig);
  if (!cfg.enabled) return;

  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId },
    select: { customerId: true, priceCents: true, serviceId: true },
  });
  if (!appt) return;
  const svc = await prisma.service.findUnique({
    where: { id: appt.serviceId },
    select: { loyaltyPoints: true },
  });

  const points = pointsForVisit(cfg, appt.priceCents, svc?.loyaltyPoints);
  if (points <= 0) return;

  const already = await prisma.loyaltyTransaction.findFirst({
    where: { appointmentId, reason: "appointment_completed" },
    select: { id: true },
  });
  if (already) return;

  try {
    await prisma.$transaction([
      prisma.loyaltyTransaction.create({
        data: {
          tenantId,
          customerId: appt.customerId,
          points,
          reason: "appointment_completed",
          appointmentId,
        },
      }),
      prisma.loyaltyAccount.upsert({
        where: { customerId: appt.customerId },
        create: { tenantId, customerId: appt.customerId, points },
        update: { points: { increment: points } },
      }),
    ]);
    logger.info({ tenantId, appointmentId, points }, "loyalty.earned");
  } catch (e) {
    // Unique violation = already earned for this appointment → fine.
    if (e instanceof Error && /Unique constraint|P2002/.test(e.message)) return;
    throw e;
  }
}

export async function getLoyaltySummary(tenantId: string, customerId: string) {
  await assertCustomerInTenant(tenantId, customerId);
  const [account, txs] = await Promise.all([
    prisma.loyaltyAccount.findUnique({ where: { customerId } }),
    prisma.loyaltyTransaction.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return { points: account?.points ?? 0, transactions: txs };
}

export async function adjustPoints(
  tenantId: string,
  customerId: string,
  delta: number,
  note: string,
  actor: Actor,
) {
  if (!Number.isInteger(delta) || delta === 0) throw new LoyaltyError("INVALID");
  await assertCustomerInTenant(tenantId, customerId);
  const account = await prisma.loyaltyAccount.findUnique({ where: { customerId } });
  const current = account?.points ?? 0;
  if (current + delta < 0) throw new LoyaltyError("INSUFFICIENT_POINTS");

  await prisma.$transaction([
    prisma.loyaltyTransaction.create({
      data: {
        tenantId,
        customerId,
        points: delta,
        reason: "adjustment",
        note: note.slice(0, 200),
        createdById: actor.userId,
      },
    }),
    prisma.loyaltyAccount.upsert({
      where: { customerId },
      create: { tenantId, customerId, points: Math.max(0, delta) },
      update: { points: { increment: delta } },
    }),
  ]);
}

// ---- rewards -------------------------------------------------------------

export function listRewards(tenantId: string, includeInactive = true) {
  return prisma.loyaltyReward.findMany({
    where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: { pointsCost: "asc" },
  });
}

export async function createReward(
  tenantId: string,
  input: {
    name: string;
    description?: string | null;
    pointsCost: number;
    kind: "discount" | "free_service" | "custom";
    amountOffCents?: number | null;
    percentOff?: number | null;
    serviceId?: string | null;
  },
) {
  return prisma.loyaltyReward.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description ?? null,
      pointsCost: input.pointsCost,
      kind: input.kind,
      amountOffCents: input.amountOffCents ?? null,
      percentOff: input.percentOff ?? null,
      serviceId: input.kind === "free_service" ? (input.serviceId ?? null) : null,
    },
  });
}

export async function setRewardActive(tenantId: string, id: string, isActive: boolean) {
  await prisma.loyaltyReward.updateMany({ where: { id, tenantId }, data: { isActive } });
}

/**
 * Redeem a reward: debit points and mint a single-use Coupon carrying the
 * reward's discount, to be applied at the till / next payment link.
 */
export async function redeemReward(
  tenantId: string,
  customerId: string,
  rewardId: string,
  actor: Actor,
) {
  await assertCustomerInTenant(tenantId, customerId);
  const [reward, account, tenant] = await Promise.all([
    prisma.loyaltyReward.findFirst({ where: { id: rewardId, tenantId, isActive: true } }),
    prisma.loyaltyAccount.findUnique({ where: { customerId } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { loyaltyConfig: true } }),
  ]);
  if (!parseLoyaltyConfig(tenant?.loyaltyConfig).enabled) throw new LoyaltyError("DISABLED");
  if (!reward) throw new LoyaltyError("NOT_FOUND");
  if ((account?.points ?? 0) < reward.pointsCost) throw new LoyaltyError("INSUFFICIENT_POINTS");

  const code = `LOYAL-${generateToken(4)
    .replace(/[^A-Z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase()}`;

  const [, , coupon] = await prisma.$transaction([
    prisma.loyaltyTransaction.create({
      data: {
        tenantId,
        customerId,
        points: -reward.pointsCost,
        reason: "reward_redeemed",
        rewardId: reward.id,
        note: reward.name,
        createdById: actor.userId,
      },
    }),
    prisma.loyaltyAccount.update({
      where: { customerId },
      data: { points: { decrement: reward.pointsCost } },
    }),
    prisma.coupon.create({
      data: {
        tenantId,
        code,
        description: `Loyalty: ${reward.name}`,
        percentOff: reward.kind === "discount" ? reward.percentOff : null,
        amountOffCents: reward.kind === "discount" ? reward.amountOffCents : null,
        maxRedemptions: 1,
        isActive: true,
      },
    }),
  ]);
  logger.info({ tenantId, customerId, rewardId, code }, "loyalty.redeemed");
  return { couponCode: coupon.code };
}
