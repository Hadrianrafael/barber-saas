import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createCustomer,
  updateCustomer,
  anonymizeCustomer,
  setConsent,
  getCrmMetrics,
  listCustomers,
} from "@/features/crm/service";
import { createAppointment, completeAppointment } from "@/features/scheduling/appointments";
import { wallClockToUtc } from "@/features/scheduling/time";
import { listFiltersSchema } from "@/features/crm/schema";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();
const actor = { userId: null as string | null, label: "test" };
const uniq = () => Math.random().toString(36).slice(2, 10);
const F = (o: Record<string, unknown> = {}) => listFiltersSchema.parse(o);

async function tenant() {
  return prisma.tenant.create({
    data: {
      slug: `crm-${uniq()}`,
      name: "CRM",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      status: "ACTIVE",
    },
  });
}

d("CRM (DB)", () => {
  const cleanup: string[] = [];
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterAll(async () => {
    for (const id of cleanup) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const input = (over: Record<string, unknown> = {}) =>
    ({
      name: `Cliente ${uniq()}`,
      email: `${uniq()}@x.com`,
      phone: `+551199${Math.floor(1000000 + Math.random() * 8999999)}`,
      whatsapp: "",
      locale: "pt-BR" as const,
      birthDate: "",
      notes: "",
      tags: [],
      preferredEmployeeId: "",
      status: "ACTIVE" as const,
      ...over,
    }) as Parameters<typeof createCustomer>[1];

  it("creates, rejects duplicates, updates", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const a = await createCustomer(t.id, input({ email: "dup@x.com" }), actor);
    await expect(createCustomer(t.id, input({ email: "dup@x.com" }), actor)).rejects.toMatchObject({
      name: "ConflictError",
    });
    await updateCustomer(t.id, a.id, input({ name: "Renamed", email: "dup@x.com" }), actor);
    const after = await prisma.customer.findUnique({ where: { id: a.id } });
    expect(after?.name).toBe("Renamed");
  });

  it("isolates tenants", async () => {
    const t1 = await tenant();
    const t2 = await tenant();
    cleanup.push(t1.id, t2.id);
    const c = await createCustomer(t1.id, input(), actor);
    await expect(updateCustomer(t2.id, c.id, input(), actor)).rejects.toMatchObject({
      name: "NotFoundError",
    });
  });

  it("consent opt-in then opt-out is reflected in metrics", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const c = await createCustomer(t.id, input(), actor);
    await setConsent(t.id, { customerId: c.id, channel: "WHATSAPP", granted: true }, actor);
    expect((await getCrmMetrics(t.id)).optInWhatsapp).toBe(1);
    await setConsent(t.id, { customerId: c.id, channel: "WHATSAPP", granted: false }, actor);
    expect((await getCrmMetrics(t.id)).optInWhatsapp).toBe(0);
  });

  it("anonymize erases PII but keeps appointment history", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const emp = await prisma.employee.create({
      data: { tenantId: t.id, name: "B", status: "ACTIVE" },
    });
    const svc = await prisma.service.create({
      data: {
        tenantId: t.id,
        name: "Corte",
        priceCents: 5000,
        currency: "BRL",
        durationMin: 30,
        status: "ACTIVE",
        employees: { create: { employeeId: emp.id } },
      },
    });
    await prisma.businessHour.create({
      data: { tenantId: t.id, weekday: 1, startMin: 540, endMin: 1080 },
    });
    const c = await createCustomer(t.id, input(), actor);

    const now = new Date();
    const monday = new Date(now.getTime() + ((8 - now.getUTCDay()) % 7 || 7) * 86400000);
    const iso = monday.toISOString().slice(0, 10);
    const appt = await createAppointment({
      tenantId: t.id,
      serviceId: svc.id,
      employeeId: emp.id,
      customerId: c.id,
      startsAt: wallClockToUtc(iso, 600, "America/Sao_Paulo"),
      source: "DASHBOARD",
      actor,
    });

    await anonymizeCustomer(t.id, c.id, actor);
    const erased = await prisma.customer.findUnique({ where: { id: c.id } });
    expect(erased?.email).toBeNull();
    expect(erased?.anonymizedAt).not.toBeNull();
    const stillThere = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(stillThere).not.toBeNull();
    expect(await prisma.communicationConsent.count({ where: { customerId: c.id } })).toBe(0);
  });

  it("completing an appointment rolls up customer stats", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const emp = await prisma.employee.create({
      data: { tenantId: t.id, name: "B2", status: "ACTIVE" },
    });
    const svc = await prisma.service.create({
      data: {
        tenantId: t.id,
        name: "Barba",
        priceCents: 3000,
        currency: "BRL",
        durationMin: 20,
        status: "ACTIVE",
        employees: { create: { employeeId: emp.id } },
      },
    });
    await prisma.businessHour.create({
      data: { tenantId: t.id, weekday: 2, startMin: 540, endMin: 1080 },
    });
    const c = await createCustomer(t.id, input(), actor);
    const now = new Date();
    const tuesday = new Date(now.getTime() + ((9 - now.getUTCDay()) % 7 || 7) * 86400000);
    const appt = await createAppointment({
      tenantId: t.id,
      serviceId: svc.id,
      employeeId: emp.id,
      customerId: c.id,
      startsAt: wallClockToUtc(tuesday.toISOString().slice(0, 10), 600, "America/Sao_Paulo"),
      source: "DASHBOARD",
      actor,
    });
    await completeAppointment(t.id, appt.id, actor);
    const rolled = await prisma.customer.findUnique({ where: { id: c.id } });
    expect(rolled?.visitsCount).toBe(1);
    expect(rolled?.totalSpentCents).toBe(3000);
    expect(rolled?.lastVisitAt).not.toBeNull();
  });

  it("paginates and segments", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    for (let i = 0; i < 5; i++) await createCustomer(t.id, input(), actor);
    const p1 = await listCustomers(t.id, F({ pageSize: "2", page: "1" }));
    const p2 = await listCustomers(t.id, F({ pageSize: "2", page: "2" }));
    expect(p1.total).toBe(5);
    expect(p1.rows).toHaveLength(2);
    expect(p2.rows[0]!.id).not.toBe(p1.rows[0]!.id);
    const recurring = await listCustomers(t.id, F({ segment: "recurring" }));
    expect(recurring.total).toBe(0);
  });
});
