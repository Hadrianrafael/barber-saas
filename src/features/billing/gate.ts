import "server-only";
import { prisma } from "@/server/db/client";
import {
  parsePlanLimits,
  TRIAL_LIMITS,
  type PlanLimits,
  type LimitedResource,
  type GatedFeature,
} from "./plan-limits";

export type BillingBlockReason =
  null | "TRIAL_EXPIRED" | "PAST_DUE_GRACE_OVER" | "CANCELED" | "UNPAID";

export interface Entitlements {
  planCode: string | null;
  planName: string | null;
  status: string; // TRIALING | ACTIVE | PAST_DUE | CANCELED | UNPAID | INCOMPLETE | NONE
  limits: PlanLimits;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  inGrace: boolean;
  blocked: boolean;
  blockReason: BillingBlockReason;
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

export async function getEntitlements(tenantId: string): Promise<Entitlements> {
  const [tenant, sub] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { trialEndsAt: true, status: true },
    }),
    prisma.subscription.findFirst({
      where: { tenantId, scope: "PLATFORM" },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    }),
  ]);

  const now = Date.now();
  const trialEndsAt = tenant?.trialEndsAt ?? null;

  if (!sub) {
    const trialExpired = !!trialEndsAt && trialEndsAt.getTime() < now;
    return {
      planCode: null,
      planName: null,
      status: "TRIALING",
      limits: TRIAL_LIMITS,
      currentPeriodEnd: trialEndsAt,
      trialEndsAt,
      cancelAtPeriodEnd: false,
      inGrace: false,
      blocked: trialExpired,
      blockReason: trialExpired ? "TRIAL_EXPIRED" : null,
    };
  }

  const limits = sub.plan ? parsePlanLimits(sub.plan.limits) : TRIAL_LIMITS;
  const inGrace =
    sub.status === "PAST_DUE" && !!sub.gracePeriodEndsAt && sub.gracePeriodEndsAt.getTime() > now;

  let blocked = false;
  let blockReason: BillingBlockReason = null;
  if (sub.status === "CANCELED") {
    blocked = true;
    blockReason = "CANCELED";
  } else if (sub.status === "UNPAID") {
    blocked = true;
    blockReason = "UNPAID";
  } else if (sub.status === "PAST_DUE" && !inGrace) {
    blocked = true;
    blockReason = "PAST_DUE_GRACE_OVER";
  } else if (sub.status === "TRIALING" && !!trialEndsAt && trialEndsAt.getTime() < now) {
    blocked = true;
    blockReason = "TRIAL_EXPIRED";
  }

  return {
    planCode: sub.plan?.code ?? null,
    planName: sub.plan?.name ?? null,
    status: sub.status,
    limits,
    currentPeriodEnd: sub.currentPeriodEnd,
    trialEndsAt,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    inGrace,
    blocked,
    blockReason,
  };
}

export class PlanLimitError extends Error {
  code: "LIMIT_EXCEEDED" | "FEATURE_UNAVAILABLE" | "BILLING_BLOCKED";
  resource?: string;
  constructor(code: PlanLimitError["code"], resource?: string, message?: string) {
    super(message ?? code);
    this.name = "PlanLimitError";
    this.code = code;
    this.resource = resource;
  }
}
export function isPlanLimitError(e: unknown): e is PlanLimitError {
  return e instanceof PlanLimitError;
}

async function currentCount(tenantId: string, resource: LimitedResource): Promise<number> {
  switch (resource) {
    case "employees":
      return prisma.employee.count({ where: { tenantId, status: { not: "INACTIVE" } } });
    case "services":
      return prisma.service.count({ where: { tenantId, status: "ACTIVE" } });
    case "customers":
      return prisma.customer.count({ where: { tenantId, anonymizedAt: null } });
    case "appointmentsThisMonth":
      return prisma.appointment.count({
        where: { tenantId, createdAt: { gte: monthStart() } },
      });
    case "campaignsThisMonth":
      return prisma.campaign.count({
        where: { tenantId, createdAt: { gte: monthStart() } },
      });
    case "messagesThisMonth":
      return prisma.message.count({
        where: { tenantId, direction: "OUTBOUND", createdAt: { gte: monthStart() } },
      });
  }
}

const RESOURCE_LIMIT_KEY: Record<LimitedResource, keyof PlanLimits> = {
  employees: "maxEmployees",
  services: "maxServices",
  customers: "maxCustomers",
  appointmentsThisMonth: "maxMonthlyAppointments",
  campaignsThisMonth: "maxCampaignsPerMonth",
  messagesThisMonth: "maxMonthlyMessages",
};

/** Throws PlanLimitError if the tenant is billing-blocked or at the cap. */
export async function assertWithinLimit(
  tenantId: string,
  resource: LimitedResource,
  ent?: Entitlements,
): Promise<void> {
  const e = ent ?? (await getEntitlements(tenantId));
  if (e.blocked) throw new PlanLimitError("BILLING_BLOCKED", resource, e.blockReason ?? undefined);
  const cap = e.limits[RESOURCE_LIMIT_KEY[resource]] as number;
  if (cap <= 0) throw new PlanLimitError("FEATURE_UNAVAILABLE", resource);
  const count = await currentCount(tenantId, resource);
  if (count >= cap) throw new PlanLimitError("LIMIT_EXCEEDED", resource);
}

export async function assertFeature(
  tenantId: string,
  feature: GatedFeature,
  ent?: Entitlements,
): Promise<void> {
  const e = ent ?? (await getEntitlements(tenantId));
  if (e.blocked) throw new PlanLimitError("BILLING_BLOCKED", feature, e.blockReason ?? undefined);
  if (!e.limits[feature]) throw new PlanLimitError("FEATURE_UNAVAILABLE", feature);
}
