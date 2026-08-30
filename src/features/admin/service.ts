import "server-only";
import { prisma } from "@/server/db/client";

/** Platform-wide metrics for the admin dashboard. */
export async function platformMetrics() {
  const [byStatus, users, customers, appts, activeSubs, payAgg, msgAgg, failedMsgs, campaigns] =
    await Promise.all([
      prisma.tenant.groupBy({ by: ["status"], _count: true }),
      prisma.user.count(),
      prisma.customer.count(),
      prisma.appointment.count(),
      prisma.subscription.findMany({
        where: { scope: "PLATFORM", status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
        select: { status: true, plan: { select: { priceCents: true, currency: true } } },
      }),
      prisma.payment.aggregate({
        where: { purpose: "CLIENT_PAYMENT", status: "SUCCEEDED" },
        _sum: { amountCents: true, platformFeeCents: true },
        _count: true,
      }),
      prisma.message.groupBy({ by: ["status"], _count: true }),
      prisma.message.count({ where: { status: "FAILED" } }),
      prisma.campaign.count(),
    ]);

  const mrrCents = activeSubs
    .filter((s) => s.status === "ACTIVE")
    .reduce((sum, s) => sum + (s.plan?.priceCents ?? 0), 0);

  return {
    tenantsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
    tenantsTotal: byStatus.reduce((s, r) => s + r._count, 0),
    users,
    customers,
    appointments: appts,
    subscriptions: { active: activeSubs.filter((s) => s.status === "ACTIVE").length, mrrCents },
    clientPayments: {
      count: payAgg._count,
      grossCents: payAgg._sum.amountCents ?? 0,
      platformFeeCents: payAgg._sum.platformFeeCents ?? 0,
    },
    messages: Object.fromEntries(msgAgg.map((r) => [r.status, r._count])),
    failedMessages: failedMsgs,
    campaigns,
  };
}

export async function listTenants(opts: { q?: string; status?: string; page?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = 25;
  const where = {
    ...(opts.status ? { status: opts.status as never } : {}),
    ...(opts.q
      ? {
          OR: [
            { name: { contains: opts.q, mode: "insensitive" as const } },
            { slug: { contains: opts.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        country: true,
        currency: true,
        createdAt: true,
        _count: { select: { members: true, customers: true, appointments: true } },
        subscriptions: {
          where: { scope: "PLATFORM" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, plan: { select: { name: true } } },
        },
        payoutAccount: { select: { status: true, chargesEnabled: true } },
      },
    }),
    prisma.tenant.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getTenantDetail(id: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, disabledAt: true } } },
      },
      subscriptions: {
        where: { scope: "PLATFORM" },
        orderBy: { createdAt: "desc" },
        take: 3,
        include: { plan: { select: { name: true, priceCents: true, currency: true } } },
      },
      payoutAccount: true,
      _count: {
        select: {
          customers: true,
          employees: true,
          services: true,
          appointments: true,
          campaigns: true,
        },
      },
    },
  });
  if (!tenant) return null;

  const [recentPayments, recentMessages, usage] = await Promise.all([
    prisma.payment.findMany({
      where: { tenantId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        purpose: true,
        status: true,
        amountCents: true,
        currency: true,
        createdAt: true,
      },
    }),
    prisma.message.findMany({
      where: { tenantId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, channel: true, status: true, category: true, createdAt: true },
    }),
    prisma.message.groupBy({
      by: ["status"],
      where: { tenantId: id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      _count: true,
    }),
  ]);

  return {
    tenant,
    recentPayments,
    recentMessages,
    usage30d: Object.fromEntries(usage.map((u) => [u.status, u._count])),
  };
}

/** Pick a member to impersonate (prefer an OWNER). */
export async function pickImpersonationTarget(tenantId: string) {
  const owner = await prisma.tenantMember.findFirst({
    where: { tenantId, role: "OWNER", user: { disabledAt: null } },
    select: { userId: true, user: { select: { email: true } } },
  });
  return owner ?? null;
}

export async function listPlatformAudit(opts: { action?: string; page?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = 40;
  const where = opts.action ? { action: { contains: opts.action } } : {};
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        actorLabel: true,
        actorType: true,
        tenantId: true,
        targetType: true,
        targetId: true,
        ip: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}
