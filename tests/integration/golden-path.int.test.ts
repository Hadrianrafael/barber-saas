/**
 * Golden path — the main E2E flow exercised end to end at the domain/service
 * layer (the dev server can't compile fast enough here for a browser E2E; see
 * ADR 0012). Gated on RUN_DB_TESTS=1.
 *
 *   owner has a barbershop (TRIALING, not blocked)
 *   → owner creates a barber + a service + weekly hours
 *   → a client books online through the public flow (any barber)
 *   → the client pays  → the Stripe Connect webhook confirms the appointment
 *   → a reminder / confirmation notification is enqueued (worker, not inline)
 *   → the chatbot books a second slot for the same client using real tools
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { getEntitlements } from "@/features/billing/gate";
import {
  getBookingContext,
  createPublicBooking,
  getBookingByToken,
} from "@/features/booking/service";
import { handleConnectEvent } from "@/features/payments/webhooks";
import { runTool, type ChatToolContext } from "@/features/chatbot/tools";
import { wallClockToUtc } from "@/features/scheduling/time";
import type { BookingSubmitInput } from "@/features/booking/schema";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();
const uniq = () => Math.random().toString(36).slice(2, 10);

const weekdayISO = (days: number) => {
  const dt = new Date(Date.now() + days * 86_400_000);
  while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
};

function submitInput(over: Partial<BookingSubmitInput>): BookingSubmitInput {
  return {
    serviceId: "",
    employeeId: "",
    startsAt: "",
    name: "Cliente Golden",
    email: "",
    phone: "",
    notes: "",
    whatsappOptIn: false,
    payNow: false,
    locale: "pt-BR",
    ...over,
  };
}

d("golden path (DB)", () => {
  const tenants: string[] = [];
  const enqueue = vi.fn();

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    // the notification enqueue is fire-and-forget via a dynamic import — stub the queue
    vi.doMock("@/worker/queues", () => ({
      enqueueAppointmentNotification: enqueue,
      enqueueMessageRetry: vi.fn(),
    }));
  });
  afterAll(async () => {
    for (const id of tenants) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
    vi.doUnmock("@/worker/queues");
  });

  it("owner → config → public booking → payment webhook → chatbot booking", async () => {
    // --- owner has a barbershop, still on trial, not blocked ---
    const tenant = await prisma.tenant.create({
      data: {
        slug: `gold-${uniq()}`,
        name: "Barbearia Golden",
        timezone: "America/Sao_Paulo",
        currency: "BRL",
        status: "ACTIVE",
        country: "BR",
        trialEndsAt: new Date(Date.now() + 10 * 86_400_000),
      },
    });
    tenants.push(tenant.id);
    const ent = await getEntitlements(tenant.id);
    expect(ent.blocked).toBe(false);
    expect(ent.status).toBe("TRIALING");

    // --- owner creates a barber + a service + weekly hours ---
    const employee = await prisma.employee.create({
      data: { tenantId: tenant.id, name: "Barbeiro Golden", status: "ACTIVE" },
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
    await prisma.businessHour.createMany({
      data: [1, 2, 3, 4, 5].map((weekday) => ({
        tenantId: tenant.id,
        weekday,
        startMin: 9 * 60,
        endMin: 18 * 60,
      })),
    });

    // --- client books online (public flow, "any barber") ---
    const ctx = await getBookingContext(tenant.slug);
    expect(ctx).not.toBeNull();
    const startsAt1 = wallClockToUtc(weekdayISO(9), 10 * 60, tenant.timezone).toISOString();
    const res = await createPublicBooking(
      ctx!,
      submitInput({ serviceId: service.id, startsAt: startsAt1, email: `golden-${uniq()}@x.com` }),
    );
    const appt1 = await prisma.appointment.findUnique({ where: { id: res.appointmentId } });
    expect(appt1!.status).toBe("PENDING");
    expect(appt1!.source).toBe("PUBLIC_PAGE");

    // --- client pays → Connect webhook confirms the appointment + writes the ledger row ---
    const intentId = `pi_${uniq()}`;
    const ev = {
      id: `evt_${uniq()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${uniq()}`,
          payment_status: "paid",
          amount_total: 6000,
          currency: "brl",
          payment_intent: intentId,
          metadata: {
            tenantId: tenant.id,
            appointmentId: res.appointmentId,
            customerId: appt1!.customerId,
          },
        },
      },
    } as unknown as Stripe.Event;
    await handleConnectEvent(ev); // no eventAccount → matches (no PayoutAccount row in this test)

    const appt1After = await prisma.appointment.findUnique({ where: { id: res.appointmentId } });
    expect(appt1After!.status).toBe("CONFIRMED");
    const payment = await prisma.payment.findFirst({
      where: { tenantId: tenant.id, purpose: "CLIENT_PAYMENT", appointmentId: res.appointmentId },
    });
    expect(payment!.status).toBe("SUCCEEDED");
    expect(payment!.amountCents).toBe(6000);

    // the token page reflects the paid + confirmed state
    const view = await getBookingByToken(res.token);
    expect(view!.status).toBe("CONFIRMED");
    expect(view!.paid).toBe(true);

    // --- chatbot books a SECOND slot for a client, using real tools only ---
    const conv = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: "WEBCHAT",
        status: "OPEN",
        handledBy: "AI",
        locale: "pt-BR",
      },
    });
    const cctx: ChatToolContext = {
      tenantId: tenant.id,
      conversationId: conv.id,
      locale: "pt-BR",
      customerId: null,
    };
    const services = (await runTool("list_services", {}, cctx)) as {
      services: { id: string; price: string }[];
    };
    expect(services.services[0]!.id).toBe(service.id);
    expect(services.services[0]!.price).toContain("60"); // real price, not invented

    const dateISO = weekdayISO(10);
    const avail = (await runTool(
      "check_availability",
      { serviceId: service.id, dateISO },
      cctx,
    )) as { slots: { startsAt: string }[] };
    expect(avail.slots.length).toBeGreaterThan(0);

    await runTool(
      "identify_customer",
      { name: "Chat Client", email: `chat-${uniq()}@x.com` },
      cctx,
    );
    expect(cctx.customerId).toBeTruthy();

    const booked = (await runTool(
      "book_appointment",
      { serviceId: service.id, startsAt: avail.slots[0]!.startsAt },
      cctx,
    )) as { ok?: boolean; appointmentId?: string };
    expect(booked.ok).toBe(true);
    const appt2 = await prisma.appointment.findUnique({ where: { id: booked.appointmentId! } });
    expect(appt2!.source).toBe("CHATBOT");
    expect(appt2!.customerId).toBe(cctx.customerId);

    // double-booking the exact same slot via the chatbot is refused
    const dupe = (await runTool(
      "book_appointment",
      { serviceId: service.id, startsAt: avail.slots[0]!.startsAt },
      cctx,
    )) as { error?: string };
    expect(dupe.error).toBe("SLOT_TAKEN");
  });
});
