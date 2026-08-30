import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { sendMessage, retryDueMessages } from "@/features/messaging/dispatch";
import { canContact } from "@/features/messaging/consent";
import { notifyAppointment } from "@/features/messaging/notify";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();
const uniq = () => Math.random().toString(36).slice(2, 10);

async function tenant() {
  return prisma.tenant.create({
    data: {
      slug: `msg-${uniq()}`,
      name: "Msg",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      status: "ACTIVE",
    },
  });
}

d("messaging (DB)", () => {
  const cleanup: string[] = [];
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterAll(async () => {
    for (const id of cleanup) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("EMAIL via the console transport is recorded as SENT", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const m = await sendMessage({
      tenantId: t.id,
      channel: "EMAIL",
      locale: "pt-BR",
      to: "x@example.com",
      subject: "Hi",
      text: "Body",
    });
    expect(m!.status).toBe("SENT");
    expect(m!.provider).toBe("console");
  });

  it("WHATSAPP without keys → FAILED + scheduled retry; retry keeps failing but increments attempts", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const m = await sendMessage({
      tenantId: t.id,
      channel: "WHATSAPP",
      locale: "pt-BR",
      to: "5511999998888",
      text: "Oi",
    });
    expect(m!.status).toBe("FAILED");
    expect(m!.attempts).toBe(1);
    expect(m!.nextAttemptAt).not.toBeNull();
    expect(m!.error?.toLowerCase()).toContain("not configured");

    await prisma.message.update({
      where: { id: m!.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    const n = await retryDueMessages(10);
    expect(n).toBeGreaterThanOrEqual(1);
    const after = await prisma.message.findUnique({ where: { id: m!.id } });
    expect(after!.attempts).toBe(2);
  });

  it("consent policy", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const c = await prisma.customer.create({
      data: { tenantId: t.id, name: "C", email: "c@x.com", whatsapp: "5511999990000" },
    });
    // email transactional allowed by default
    expect((await canContact(c.id, "EMAIL", "transactional")).ok).toBe(true);
    // whatsapp needs opt-in
    expect((await canContact(c.id, "WHATSAPP", "transactional")).ok).toBe(false);
    await prisma.communicationConsent.create({
      data: { customerId: c.id, channel: "WHATSAPP", granted: true, grantedAt: new Date() },
    });
    expect((await canContact(c.id, "WHATSAPP", "transactional")).ok).toBe(true);
    // email opt-out blocks even transactional
    await prisma.communicationConsent.create({
      data: { customerId: c.id, channel: "EMAIL", granted: false, revokedAt: new Date() },
    });
    expect((await canContact(c.id, "EMAIL", "transactional")).ok).toBe(false);
  });

  it("notifyAppointment falls through to a working channel", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const emp = await prisma.employee.create({
      data: { tenantId: t.id, name: "B", status: "ACTIVE" },
    });
    const svc = await prisma.service.create({
      data: {
        tenantId: t.id,
        name: "Corte",
        priceCents: 4000,
        currency: "BRL",
        durationMin: 30,
        status: "ACTIVE",
      },
    });
    const c = await prisma.customer.create({
      data: {
        tenantId: t.id,
        name: "Cli",
        email: "cli@x.com",
        whatsapp: "5511988887777",
        locale: "pt-BR",
      },
    });
    await prisma.communicationConsent.create({
      data: { customerId: c.id, channel: "WHATSAPP", granted: true, grantedAt: new Date() },
    });
    const start = new Date(Date.now() + 3 * 86400000);
    const appt = await prisma.appointment.create({
      data: {
        tenantId: t.id,
        customerId: c.id,
        employeeId: emp.id,
        serviceId: svc.id,
        status: "CONFIRMED",
        source: "DASHBOARD",
        startsAt: start,
        endsAt: new Date(start.getTime() + 1800000),
        serviceName: "Corte",
        durationMin: 30,
        bufferMin: 0,
        priceCents: 4000,
        currency: "BRL",
      },
    });

    const res = await notifyAppointment(appt.id, "appointment_confirmation");
    expect(res.sent).toBe(1); // whatsapp failed (no keys) → email console SENT

    const msgs = await prisma.message.findMany({
      where: { tenantId: t.id, customerId: c.id },
      orderBy: { createdAt: "asc" },
    });
    expect(msgs.map((m) => m.channel)).toEqual(["WHATSAPP", "EMAIL"]);
    expect(msgs[0]!.status).toBe("FAILED");
    expect(msgs[1]!.status).toBe("SENT");
    expect(msgs[1]!.templateKey).toBe("appointment_confirmation");
  });
});
