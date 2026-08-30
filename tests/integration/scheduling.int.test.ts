/**
 * End-to-end scheduling domain tests against a real Postgres.
 *
 * Gated: runs only when RUN_DB_TESTS=1 (CI sets this; `npm test` locally skips
 * it when there is no database). It exercises the paths that cannot be verified
 * without the DB — the serializable transaction, the GiST exclusion constraint,
 * concurrency, timezone persistence and cross-tenant isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createAppointment,
  cancelAppointment,
  markNoShow,
  rescheduleAppointment,
} from "@/features/scheduling/appointments";
import { getAvailableSlots } from "@/features/scheduling/availability";
import { isSchedulingError } from "@/features/scheduling/errors";
import { wallClockToUtc } from "@/features/scheduling/time";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;

const prisma = new PrismaClient();
const actor = { userId: null, label: "test" };
const uniq = () => Math.random().toString(36).slice(2, 10);

async function makeTenant(tz: string) {
  const slug = `t-${uniq()}`;
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: slug,
      timezone: tz,
      currency: "BRL",
      status: "ACTIVE",
      businessHours: {
        create: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          startMin: 9 * 60,
          endMin: 18 * 60,
        })),
      },
    },
  });
  const employee = await prisma.employee.create({
    data: { tenantId: tenant.id, name: `emp-${uniq()}`, status: "ACTIVE" },
  });
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: "Corte",
      priceCents: 4000,
      currency: "BRL",
      durationMin: 30,
      bufferMin: 0,
      status: "ACTIVE",
      employees: { create: { employeeId: employee.id } },
    },
  });
  const customer = await prisma.customer.create({
    data: { tenantId: tenant.id, name: `cust-${uniq()}` },
  });
  return { tenant, employee, service, customer };
}

async function cleanup(tenantId: string) {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
}

d("scheduling (DB)", () => {
  const tenants: string[] = [];

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterAll(async () => {
    for (const id of tenants) await cleanup(id);
    await prisma.$disconnect();
  });

  // Next Monday 10:00 in the tenant's tz.
  function mondayAt(tz: string, hour: number) {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = (day.getUTCDay() + 6) % 7;
    const monday = new Date(day.getTime() + (7 - dow) * 86400000);
    const iso = monday.toISOString().slice(0, 10);
    return { at: wallClockToUtc(iso, hour * 60, tz), iso };
  }

  it("creates an appointment and snapshots the service", async () => {
    const { tenant, employee, service, customer } = await makeTenant("America/Sao_Paulo");
    tenants.push(tenant.id);
    const { at } = mondayAt(tenant.timezone, 10);

    const appt = await createAppointment({
      tenantId: tenant.id,
      serviceId: service.id,
      employeeId: employee.id,
      customerId: customer.id,
      startsAt: at,
      source: "DASHBOARD",
      actor,
    });
    expect(appt.serviceName).toBe("Corte");
    expect(appt.durationMin).toBe(30);
    expect(appt.priceCents).toBe(4000);
    expect(appt.endsAt.getTime() - appt.startsAt.getTime()).toBe(30 * 60_000);
  });

  it("rejects booking an archived service", async () => {
    const { tenant, employee, service, customer } = await makeTenant("America/Sao_Paulo");
    tenants.push(tenant.id);
    await prisma.service.update({ where: { id: service.id }, data: { status: "ARCHIVED" } });
    const { at } = mondayAt(tenant.timezone, 11);
    await expect(
      createAppointment({
        tenantId: tenant.id,
        serviceId: service.id,
        employeeId: employee.id,
        customerId: customer.id,
        startsAt: at,
        source: "DASHBOARD",
        actor,
      }),
    ).rejects.toMatchObject({ code: "SERVICE_INACTIVE" });
  });

  it("rejects a second overlapping booking for the same barber", async () => {
    const { tenant, employee, service, customer } = await makeTenant("America/Sao_Paulo");
    tenants.push(tenant.id);
    const { at } = mondayAt(tenant.timezone, 12);
    await createAppointment({
      tenantId: tenant.id,
      serviceId: service.id,
      employeeId: employee.id,
      customerId: customer.id,
      startsAt: at,
      source: "DASHBOARD",
      actor,
    });
    await expect(
      createAppointment({
        tenantId: tenant.id,
        serviceId: service.id,
        employeeId: employee.id,
        customerId: customer.id,
        startsAt: new Date(at.getTime() + 10 * 60_000),
        source: "DASHBOARD",
        actor,
      }),
    ).rejects.toMatchObject({ code: "SLOT_TAKEN" });
  });

  it("only one of two concurrent bookings for the same slot succeeds", async () => {
    const { tenant, employee, service, customer } = await makeTenant("America/Sao_Paulo");
    tenants.push(tenant.id);
    const { at } = mondayAt(tenant.timezone, 13);
    const c2 = await prisma.customer.create({
      data: { tenantId: tenant.id, name: `c2-${uniq()}` },
    });

    const results = await Promise.allSettled([
      createAppointment({
        tenantId: tenant.id,
        serviceId: service.id,
        employeeId: employee.id,
        customerId: customer.id,
        startsAt: at,
        source: "DASHBOARD",
        actor,
      }),
      createAppointment({
        tenantId: tenant.id,
        serviceId: service.id,
        employeeId: employee.id,
        customerId: c2.id,
        startsAt: at,
        source: "DASHBOARD",
        actor,
      }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(isSchedulingError((failed[0] as PromiseRejectedResult).reason)).toBe(true);

    const count = await prisma.appointment.count({
      where: { tenantId: tenant.id, employeeId: employee.id, startsAt: at },
    });
    expect(count).toBe(1);
  });

  it("cancel and no-show free the slot for rebooking", async () => {
    const { tenant, employee, service, customer } = await makeTenant("America/Sao_Paulo");
    tenants.push(tenant.id);
    const { at } = mondayAt(tenant.timezone, 14);
    const a1 = await createAppointment({
      tenantId: tenant.id,
      serviceId: service.id,
      employeeId: employee.id,
      customerId: customer.id,
      startsAt: at,
      source: "DASHBOARD",
      actor,
    });
    await cancelAppointment(tenant.id, a1.id, actor, "test");
    const a2 = await createAppointment({
      tenantId: tenant.id,
      serviceId: service.id,
      employeeId: employee.id,
      customerId: customer.id,
      startsAt: at,
      source: "DASHBOARD",
      actor,
    });
    await markNoShow(tenant.id, a2.id, actor);
    const a3 = await createAppointment({
      tenantId: tenant.id,
      serviceId: service.id,
      employeeId: employee.id,
      customerId: customer.id,
      startsAt: at,
      source: "DASHBOARD",
      actor,
    });
    expect(a3.id).toBeTruthy();
  });

  it("reschedule moves the appointment and re-checks conflicts", async () => {
    const { tenant, employee, service, customer } = await makeTenant("America/Sao_Paulo");
    tenants.push(tenant.id);
    const { at } = mondayAt(tenant.timezone, 15);
    const a = await createAppointment({
      tenantId: tenant.id,
      serviceId: service.id,
      employeeId: employee.id,
      customerId: customer.id,
      startsAt: at,
      source: "DASHBOARD",
      actor,
    });
    const moved = await rescheduleAppointment({
      tenantId: tenant.id,
      appointmentId: a.id,
      startsAt: new Date(at.getTime() + 60 * 60_000),
      actor,
    });
    expect(moved.startsAt.getTime()).toBe(at.getTime() + 60 * 60_000);
  });

  it("availability respects an existing booking", async () => {
    const { tenant, employee, service, customer } = await makeTenant("America/Sao_Paulo");
    tenants.push(tenant.id);
    const { at, iso } = mondayAt(tenant.timezone, 10);
    await createAppointment({
      tenantId: tenant.id,
      serviceId: service.id,
      employeeId: employee.id,
      customerId: customer.id,
      startsAt: at,
      source: "DASHBOARD",
      actor,
    });
    const result = await getAvailableSlots({
      tenantId: tenant.id,
      serviceId: service.id,
      dateISO: iso,
      now: new Date(at.getTime() - 86400000),
    });
    const taken = result.byEmployee[0]!.slots.map((s) => s.startsAt);
    expect(taken).not.toContain(at.toISOString());
  });

  it("persists the same wall-clock as different instants per tenant timezone", async () => {
    const sp = await makeTenant("America/Sao_Paulo");
    const ny = await makeTenant("America/New_York");
    tenants.push(sp.tenant.id, ny.tenant.id);
    const spAt = mondayAt("America/Sao_Paulo", 10).at;
    const nyAt = mondayAt("America/New_York", 10).at;

    const a = await createAppointment({
      tenantId: sp.tenant.id,
      serviceId: sp.service.id,
      employeeId: sp.employee.id,
      customerId: sp.customer.id,
      startsAt: spAt,
      source: "DASHBOARD",
      actor,
    });
    const b = await createAppointment({
      tenantId: ny.tenant.id,
      serviceId: ny.service.id,
      employeeId: ny.employee.id,
      customerId: ny.customer.id,
      startsAt: nyAt,
      source: "DASHBOARD",
      actor,
    });
    expect(a.startsAt.toISOString()).not.toBe(b.startsAt.toISOString());
  });

  it("isolates tenants — cannot act on another tenant's appointment", async () => {
    const a = await makeTenant("America/Sao_Paulo");
    const b = await makeTenant("America/Sao_Paulo");
    tenants.push(a.tenant.id, b.tenant.id);
    const { at } = mondayAt("America/Sao_Paulo", 16);
    const appt = await createAppointment({
      tenantId: a.tenant.id,
      serviceId: a.service.id,
      employeeId: a.employee.id,
      customerId: a.customer.id,
      startsAt: at,
      source: "DASHBOARD",
      actor,
    });
    await expect(cancelAppointment(b.tenant.id, appt.id, actor)).rejects.toMatchObject({
      code: "APPOINTMENT_NOT_FOUND",
    });
    const still = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(still?.status).toBe("PENDING");
  });
});
