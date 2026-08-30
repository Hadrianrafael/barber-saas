import "server-only";
import { prisma } from "@/server/db/client";
import { commissionForAppointmentCents } from "./commission";

/**
 * Read-only financial reporting for a barbershop. All figures come from real
 * rows — `Appointment` (COMPLETED) for billed revenue, `Payment`
 * (CLIENT_PAYMENT) written by the Stripe Connect webhooks for what was actually
 * received, `Payment.platformFeeCents` for the platform's cut, and
 * `Employee` commission config for barber commissions. Nothing is fabricated.
 */

export interface FinanceRange {
  fromISO: string;
  toISO: string;
}

export async function getFinanceOverview(tenantId: string, range: FinanceRange) {
  const from = new Date(range.fromISO);
  const to = new Date(range.toISO);

  const [completed, payments, activeClientSubs] = await Promise.all([
    prisma.appointment.findMany({
      where: { tenantId, status: "COMPLETED", startsAt: { gte: from, lt: to } },
      select: {
        priceCents: true,
        currency: true,
        employeeId: true,
        employee: {
          select: {
            id: true,
            name: true,
            commissionType: true,
            commissionBps: true,
            commissionFixedCents: true,
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: {
        tenantId,
        purpose: "CLIENT_PAYMENT",
        createdAt: { gte: from, lt: to },
      },
      select: {
        amountCents: true,
        refundedCents: true,
        platformFeeCents: true,
        netCents: true,
        status: true,
        appointmentId: true,
      },
    }),
    prisma.subscription.count({
      where: { tenantId, scope: "CLIENT", status: "ACTIVE" },
    }),
  ]);

  const billedCents = completed.reduce((s, a) => s + a.priceCents, 0);
  const appointmentsCount = completed.length;
  const avgTicketCents = appointmentsCount > 0 ? Math.round(billedCents / appointmentsCount) : 0;

  const succeeded = payments.filter(
    (p) => p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED",
  );
  const grossReceivedCents = succeeded.reduce((s, p) => s + p.amountCents, 0);
  const refundedCents = payments.reduce((s, p) => s + p.refundedCents, 0);
  const netReceivedCents = grossReceivedCents - refundedCents;
  const platformFeesCents = succeeded.reduce((s, p) => s + p.platformFeeCents, 0);
  const payoutCents = succeeded.reduce(
    (s, p) => s + (p.netCents ?? p.amountCents - p.platformFeeCents),
    0,
  );

  // "Pending" = billed revenue not captured by a succeeded online payment tied
  // to an appointment (i.e. paid in cash / on site, or not yet paid).
  const onlineCapturedForAppointmentsCents = succeeded
    .filter((p) => p.appointmentId)
    .reduce((s, p) => s + (p.amountCents - p.refundedCents), 0);
  const pendingCents = Math.max(0, billedCents - onlineCapturedForAppointmentsCents);

  // Commissions per barber for the completed appointments in range.
  const byEmp = new Map<
    string,
    { name: string; appts: number; baseCents: number; commissionCents: number }
  >();
  for (const a of completed) {
    if (!a.employee) continue;
    const cur = byEmp.get(a.employee.id) ?? {
      name: a.employee.name,
      appts: 0,
      baseCents: 0,
      commissionCents: 0,
    };
    cur.appts += 1;
    cur.baseCents += a.priceCents;
    cur.commissionCents += commissionForAppointmentCents(a.employee, a.priceCents);
    byEmp.set(a.employee.id, cur);
  }
  const commissions = [...byEmp.entries()]
    .map(([employeeId, v]) => ({ employeeId, ...v }))
    .sort((x, y) => y.commissionCents - x.commissionCents);
  const commissionsTotalCents = commissions.reduce((s, c) => s + c.commissionCents, 0);

  return {
    billedCents,
    grossReceivedCents,
    netReceivedCents,
    pendingCents,
    refundedCents,
    platformFeesCents,
    payoutCents,
    appointmentsCount,
    avgTicketCents,
    activeClientSubs,
    commissionsTotalCents,
    commissions,
  };
}

export async function listFinancePayments(
  tenantId: string,
  range: FinanceRange,
  page = 1,
  pageSize = 30,
) {
  const where = {
    tenantId,
    purpose: "CLIENT_PAYMENT" as const,
    createdAt: { gte: new Date(range.fromISO), lt: new Date(range.toISO) },
  };
  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { name: true } },
        appointment: { select: { serviceName: true } },
      },
    }),
  ]);
  return { total, rows, page, pages: Math.ceil(total / pageSize) };
}

export async function getMonthlySeries(tenantId: string, months = 6) {
  const now = new Date();
  const out: { month: string; billedCents: number; receivedCents: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    const [billed, received] = await Promise.all([
      prisma.appointment.aggregate({
        where: { tenantId, status: "COMPLETED", startsAt: { gte: start, lt: end } },
        _sum: { priceCents: true },
      }),
      prisma.payment.aggregate({
        where: {
          tenantId,
          purpose: "CLIENT_PAYMENT",
          status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] },
          createdAt: { gte: start, lt: end },
        },
        _sum: { amountCents: true, refundedCents: true },
      }),
    ]);
    out.push({
      month: start.toISOString().slice(0, 7),
      billedCents: billed._sum.priceCents ?? 0,
      receivedCents: (received._sum.amountCents ?? 0) - (received._sum.refundedCents ?? 0),
    });
  }
  return out;
}
