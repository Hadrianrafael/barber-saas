import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getFinanceOverview } from "@/features/finance/service";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();
const uniq = () => Math.random().toString(36).slice(2, 10);

const RANGE = {
  fromISO: new Date(Date.now() - 30 * 86400000).toISOString(),
  toISO: new Date(Date.now() + 86400000).toISOString(),
};

async function setup() {
  const t = await prisma.tenant.create({
    data: {
      slug: `fin-${uniq()}`,
      name: "Fin",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      status: "ACTIVE",
    },
  });
  const empA = await prisma.employee.create({
    data: {
      tenantId: t.id,
      name: "A",
      status: "ACTIVE",
      commissionType: "PERCENT",
      commissionBps: 4000,
      commissionFixedCents: 0,
    },
  });
  const empB = await prisma.employee.create({
    data: {
      tenantId: t.id,
      name: "B",
      status: "ACTIVE",
      commissionType: "FIXED",
      commissionBps: 0,
      commissionFixedCents: 1000,
    },
  });
  const cust = await prisma.customer.create({ data: { tenantId: t.id, name: "C" } });
  const svc = await prisma.service.create({
    data: {
      tenantId: t.id,
      name: "S",
      priceCents: 5000,
      currency: "BRL",
      durationMin: 30,
      status: "ACTIVE",
    },
  });
  return { t, empA, empB, cust, svc };
}

let apptSlot = 0;
function appt(
  tenantId: string,
  employeeId: string,
  customerId: string,
  serviceId: string,
  priceCents: number,
  status: "COMPLETED" | "PENDING",
) {
  // Stagger starts so the no-overlap exclusion constraint is never hit.
  const start = new Date(Date.now() - 5 * 86400000 + apptSlot++ * 3600000);
  return prisma.appointment.create({
    data: {
      tenantId,
      employeeId,
      customerId,
      serviceId,
      status,
      source: "DASHBOARD",
      startsAt: start,
      endsAt: new Date(start.getTime() + 1800000),
      serviceName: "S",
      durationMin: 30,
      bufferMin: 0,
      priceCents,
      currency: "BRL",
    },
  });
}

d("finance overview (DB)", () => {
  const cleanup: string[] = [];
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterAll(async () => {
    for (const id of cleanup) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("aggregates billed / received / pending / refunds / avg ticket / commissions", async () => {
    const { t, empA, empB, cust, svc } = await setup();
    cleanup.push(t.id);

    // 2 completed by A @5000, 1 completed by B @5000, 1 pending (not counted).
    const a1 = await appt(t.id, empA.id, cust.id, svc.id, 5000, "COMPLETED");
    await appt(t.id, empA.id, cust.id, svc.id, 5000, "COMPLETED");
    await appt(t.id, empB.id, cust.id, svc.id, 5000, "COMPLETED");
    await appt(t.id, empB.id, cust.id, svc.id, 9999, "PENDING");

    // One online payment for a1 (5000, fee 100), one standalone refund case.
    await prisma.payment.create({
      data: {
        tenantId: t.id,
        purpose: "CLIENT_PAYMENT",
        status: "SUCCEEDED",
        method: "CARD",
        amountCents: 5000,
        currency: "BRL",
        platformFeeCents: 100,
        netCents: 4900,
        provider: "stripe",
        appointmentId: a1.id,
        paidAt: new Date(),
      },
    });
    await prisma.payment.create({
      data: {
        tenantId: t.id,
        purpose: "CLIENT_PAYMENT",
        status: "PARTIALLY_REFUNDED",
        method: "CARD",
        amountCents: 3000,
        refundedCents: 1000,
        currency: "BRL",
        platformFeeCents: 60,
        netCents: 2940,
        provider: "stripe",
        paidAt: new Date(),
      },
    });

    const o = await getFinanceOverview(t.id, RANGE);
    expect(o.billedCents).toBe(15000); // 3 completed @5000
    expect(o.appointmentsCount).toBe(3);
    expect(o.avgTicketCents).toBe(5000);
    expect(o.grossReceivedCents).toBe(8000); // 5000 + 3000
    expect(o.refundedCents).toBe(1000);
    expect(o.netReceivedCents).toBe(7000);
    expect(o.platformFeesCents).toBe(160);
    // pending = billed - online captured for appointments (5000 for a1) = 10000
    expect(o.pendingCents).toBe(10000);

    // commissions: A 40% of 10000 = 4000; B fixed 1000/appt * 1 = 1000
    const byId = Object.fromEntries(o.commissions.map((c) => [c.employeeId, c]));
    expect(byId[empA.id]!.commissionCents).toBe(4000);
    expect(byId[empB.id]!.commissionCents).toBe(1000);
    expect(o.commissionsTotalCents).toBe(5000);
  });

  it("isolates tenants", async () => {
    const s1 = await setup();
    const s2 = await setup();
    cleanup.push(s1.t.id, s2.t.id);
    await appt(s1.t.id, s1.empA.id, s1.cust.id, s1.svc.id, 5000, "COMPLETED");
    const o2 = await getFinanceOverview(s2.t.id, RANGE);
    expect(o2.billedCents).toBe(0);
    expect(o2.appointmentsCount).toBe(0);
  });
});
