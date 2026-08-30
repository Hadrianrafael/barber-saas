/**
 * Chatbot tool + conversation plumbing against a real Postgres. Gated on
 * RUN_DB_TESTS=1. The Anthropic call itself is never made here (no API key in
 * tests) — these tests pin the SECURITY model: every tool is hard-scoped to the
 * conversation's tenant and its one identified customer, and reuses the
 * scheduling domain.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runTool, type ChatToolContext } from "@/features/chatbot/tools";
import {
  startWebConversation,
  postWebCustomerMessage,
  takeOverConversation,
} from "@/features/chatbot/service";
import { wallClockToUtc } from "@/features/scheduling/time";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();
const uniq = () => Math.random().toString(36).slice(2, 10);

async function shop() {
  const slug = `cb-${uniq()}`;
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: slug,
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      status: "ACTIVE",
      businessHours: {
        create: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMin: 540, endMin: 1080 })),
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
      priceCents: 6000,
      currency: "BRL",
      durationMin: 30,
      bufferMin: 0,
      status: "ACTIVE",
      employees: { create: { employeeId: employee.id } },
    },
  });
  const conv = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      channel: "WEBCHAT",
      status: "OPEN",
      handledBy: "AI",
      locale: "pt-BR",
    },
  });
  return { tenant, employee, service, conv };
}
const weekdayISO = (n: number) => {
  const dt = new Date(Date.now() + n * 86_400_000);
  while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
};

d("chatbot tools (DB)", () => {
  const tenants: string[] = [];
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterAll(async () => {
    for (const id of tenants) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("list_services / check_availability are scoped to the conversation tenant", async () => {
    const a = await shop();
    const b = await shop();
    tenants.push(a.tenant.id, b.tenant.id);
    const ctx: ChatToolContext = {
      tenantId: a.tenant.id,
      conversationId: a.conv.id,
      locale: "pt-BR",
      customerId: null,
    };
    const svc = (await runTool("list_services", {}, ctx)) as { services: { id: string }[] };
    expect(svc.services).toHaveLength(1);
    expect(svc.services[0]!.id).toBe(a.service.id);

    const avail = (await runTool(
      "check_availability",
      { serviceId: a.service.id, dateISO: weekdayISO(7) },
      ctx,
    )) as { slots: unknown[] };
    expect(Array.isArray(avail.slots)).toBe(true);
    expect(avail.slots.length).toBeGreaterThan(0);
  });

  it("blocks appointment tools until identify_customer, then scopes to that customer", async () => {
    const a = await shop();
    tenants.push(a.tenant.id);
    const ctx: ChatToolContext = {
      tenantId: a.tenant.id,
      conversationId: a.conv.id,
      locale: "pt-BR",
      customerId: null,
    };

    expect((await runTool("my_appointments", {}, ctx)) as { error?: string }).toMatchObject({
      error: "not_identified",
    });

    const id = (await runTool(
      "identify_customer",
      { name: "João", email: `j-${uniq()}@x.com` },
      ctx,
    )) as {
      customerId: string;
    };
    expect(id.customerId).toBeTruthy();
    expect(ctx.customerId).toBe(id.customerId);
    const conv = await prisma.conversation.findUnique({ where: { id: a.conv.id } });
    expect(conv!.customerId).toBe(id.customerId);

    const startsAt = wallClockToUtc(weekdayISO(7), 600, a.tenant.timezone).toISOString();
    const booked = (await runTool(
      "book_appointment",
      { serviceId: a.service.id, startsAt },
      ctx,
    )) as { ok?: boolean; appointmentId?: string };
    expect(booked.ok).toBe(true);

    const appt = await prisma.appointment.findUnique({ where: { id: booked.appointmentId! } });
    expect(appt!.customerId).toBe(id.customerId);
    expect(appt!.source).toBe("CHATBOT");
  });

  it("cannot cancel another customer's appointment", async () => {
    const a = await shop();
    tenants.push(a.tenant.id);
    const other = await prisma.customer.create({
      data: { tenantId: a.tenant.id, name: "Other", email: `o-${uniq()}@x.com` },
    });
    const start = wallClockToUtc(weekdayISO(8), 600, a.tenant.timezone);
    const foreign = await prisma.appointment.create({
      data: {
        tenantId: a.tenant.id,
        customerId: other.id,
        employeeId: a.employee.id,
        serviceId: a.service.id,
        status: "CONFIRMED",
        source: "DASHBOARD",
        startsAt: start,
        endsAt: new Date(start.getTime() + 1800_000),
        serviceName: "Corte",
        durationMin: 30,
        bufferMin: 0,
        priceCents: 6000,
        currency: "BRL",
      },
    });

    const ctx: ChatToolContext = {
      tenantId: a.tenant.id,
      conversationId: a.conv.id,
      locale: "pt-BR",
      customerId: null,
    };
    await runTool("identify_customer", { name: "Ana", email: `a-${uniq()}@x.com` }, ctx);
    const res = (await runTool("cancel_appointment", { appointmentId: foreign.id }, ctx)) as {
      error?: string;
    };
    expect(res.error).toBe("not_found");
    const still = await prisma.appointment.findUnique({ where: { id: foreign.id } });
    expect(still!.status).toBe("CONFIRMED");
  });

  it("handoff_to_human flips the conversation to PENDING_HUMAN", async () => {
    const a = await shop();
    tenants.push(a.tenant.id);
    const ctx: ChatToolContext = {
      tenantId: a.tenant.id,
      conversationId: a.conv.id,
      locale: "pt-BR",
      customerId: null,
    };
    const r = (await runTool("handoff_to_human", { reason: "quer falar com gerente" }, ctx)) as {
      handedOff?: boolean;
    };
    expect(r.handedOff).toBe(true);
    const conv = await prisma.conversation.findUnique({ where: { id: a.conv.id } });
    expect(conv!.status).toBe("PENDING_HUMAN");
  });

  it("with AI disabled, a web message just queues for a human", async () => {
    const a = await shop();
    tenants.push(a.tenant.id);
    // chatbotConfig defaults to enabled:false
    const started = await startWebConversation(a.tenant.slug, "pt-BR");
    expect(started).not.toBeNull();
    const out = await postWebCustomerMessage(
      started!.conversationId,
      started!.sessionToken,
      "Olá, vcs abrem domingo?",
    );
    expect(out.ok).toBe(true);
    // only the customer echo comes back — no assistant reply was generated
    expect(out.messages!.every((m) => m.role === "customer")).toBe(true);
    const conv = await prisma.conversation.findUnique({ where: { id: started!.conversationId } });
    expect(conv!.status).toBe("PENDING_HUMAN");
  });

  it("a bad session token is rejected", async () => {
    const a = await shop();
    tenants.push(a.tenant.id);
    const started = await startWebConversation(a.tenant.slug, "pt-BR");
    const out = await postWebCustomerMessage(started!.conversationId, "wrong-token-value", "hi");
    expect(out.ok).toBe(false);
    expect(out.code).toBe("not_found");
  });

  it("takeOver blocks the AI from replying even if it were enabled", async () => {
    const a = await shop();
    tenants.push(a.tenant.id);
    const started = await startWebConversation(a.tenant.slug, "pt-BR");
    await takeOverConversation(a.tenant.id, started!.conversationId, "user-1");
    const out = await postWebCustomerMessage(
      started!.conversationId,
      started!.sessionToken,
      "ainda aí?",
    );
    expect(out.messages!.every((m) => m.role === "customer")).toBe(true);
  });
});
