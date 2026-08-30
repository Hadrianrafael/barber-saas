import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { handleConnectEvent } from "@/features/payments/webhooks";
import { applyAccountUpdate } from "@/features/payments/connect";
import { createPaymentLink, refundClientPayment } from "@/features/payments/links";
import { startConnectOnboarding } from "@/features/payments/connect";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();
const uniq = () => Math.random().toString(36).slice(2, 10);

async function tenant() {
  return prisma.tenant.create({
    data: {
      slug: `con-${uniq()}`,
      name: "Con",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      status: "ACTIVE",
      country: "BR",
      email: "o@x.com",
    },
  });
}

function checkoutEvent(o: {
  tenantId: string;
  linkId?: string;
  amount: number;
  intentId: string;
}): Stripe.Event {
  return {
    id: `evt_${uniq()}`,
    type: "checkout.session.completed",
    account: "acct_x",
    data: {
      object: {
        id: `cs_${uniq()}`,
        payment_status: "paid",
        amount_total: o.amount,
        currency: "brl",
        payment_intent: o.intentId,
        metadata: {
          tenantId: o.tenantId,
          paymentLinkId: o.linkId ?? "",
          appointmentId: "",
          customerId: "",
        },
      },
    },
  } as unknown as Stripe.Event;
}

d("Stripe Connect (DB)", () => {
  const cleanup: string[] = [];
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterAll(async () => {
    for (const id of cleanup) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("startConnectOnboarding fails cleanly without Stripe keys", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    await expect(startConnectOnboarding(t.id, "pt-BR")).rejects.toMatchObject({
      name: "PaymentProviderNotConfiguredError",
    });
  });

  it("createPaymentLink refuses without an enabled connected account", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    await expect(
      createPaymentLink({
        tenantId: t.id,
        description: "Corte + Barba",
        amountCents: 7000,
        currency: "BRL",
        locale: "pt-BR",
      }),
    ).rejects.toMatchObject({ name: "ConnectNotReadyError" });
  });

  it("account.updated syncs the payout account status", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    await prisma.payoutAccount.create({
      data: {
        tenantId: t.id,
        provider: "stripe",
        providerAccountId: "acct_ok",
        status: "ONBOARDING",
      },
    });
    await applyAccountUpdate({
      id: "acct_ok",
      charges_enabled: true,
      payouts_enabled: true,
      requirements: {},
    });
    const acct = await prisma.payoutAccount.findUnique({ where: { tenantId: t.id } });
    expect(acct!.status).toBe("ENABLED");
    expect(acct!.chargesEnabled).toBe(true);
    expect(acct!.onboardedAt).not.toBeNull();
  });

  it("checkout.session.completed marks the link paid, records a Payment with the platform fee, idempotently", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const link = await prisma.paymentLink.create({
      data: {
        tenantId: t.id,
        description: "Corte",
        amountCents: 10000,
        currency: "BRL",
        status: "ACTIVE",
        provider: "stripe",
      },
    });
    const intentId = `pi_${uniq()}`;
    const ev = checkoutEvent({ tenantId: t.id, linkId: link.id, amount: 10000, intentId });
    await handleConnectEvent(ev);
    await handleConnectEvent({ ...ev, id: `evt_${uniq()}` } as Stripe.Event); // replay

    const paidLink = await prisma.paymentLink.findUnique({ where: { id: link.id } });
    expect(paidLink!.status).toBe("PAID");

    const payments = await prisma.payment.findMany({
      where: { tenantId: t.id, purpose: "CLIENT_PAYMENT" },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.amountCents).toBe(10000);
    expect(payments[0]!.platformFeeCents).toBe(200); // PLATFORM_FEE_BPS=200 -> 2%
    expect(payments[0]!.netCents).toBe(9800);
    expect(payments[0]!.status).toBe("SUCCEEDED");
  });

  it("charge.refunded updates the Payment; refundClientPayment guards other tenants", async () => {
    const t1 = await tenant();
    const t2 = await tenant();
    cleanup.push(t1.id, t2.id);
    const intentId = `pi_${uniq()}`;
    await handleConnectEvent(checkoutEvent({ tenantId: t1.id, amount: 5000, intentId }));
    const pay = await prisma.payment.findFirst({
      where: { tenantId: t1.id, providerIntentId: intentId },
    });
    await prisma.payment.update({ where: { id: pay!.id }, data: { providerChargeId: "ch_1" } });

    await handleConnectEvent({
      id: `evt_${uniq()}`,
      type: "charge.refunded",
      data: { object: { id: "ch_1", amount_refunded: 5000 } },
    } as unknown as Stripe.Event);
    const refunded = await prisma.payment.findUnique({ where: { id: pay!.id } });
    expect(refunded!.status).toBe("REFUNDED");
    expect(refunded!.refundedCents).toBe(5000);

    await expect(refundClientPayment(t2.id, pay!.id)).rejects.toMatchObject({
      name: "NotFoundError",
    });
  });

  it("rejects a Connect event whose account does not match the tenant's payout account", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    await prisma.payoutAccount.create({
      data: {
        tenantId: t.id,
        provider: "stripe",
        providerAccountId: "acct_theirs",
        status: "ENABLED",
        chargesEnabled: true,
      },
    });
    const ev = checkoutEvent({ tenantId: t.id, amount: 5000, intentId: `pi_${uniq()}` });
    // event fired on a DIFFERENT connected account than the tenant owns
    await expect(handleConnectEvent(ev, "acct_someone_else")).rejects.toThrow(
      /account does not match/,
    );
    const payments = await prisma.payment.count({ where: { tenantId: t.id } });
    expect(payments).toBe(0);
  });

  it("payment_intent.payment_failed marks a pending Payment FAILED", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const intentId = `pi_${uniq()}`;
    await prisma.payment.create({
      data: {
        tenantId: t.id,
        purpose: "CLIENT_PAYMENT",
        status: "PROCESSING",
        method: "CARD",
        amountCents: 4000,
        currency: "BRL",
        provider: "stripe",
        providerIntentId: intentId,
      },
    });
    await handleConnectEvent({
      id: `evt_${uniq()}`,
      type: "payment_intent.payment_failed",
      data: { object: { id: intentId, last_payment_error: { code: "card_declined" } } },
    } as unknown as Stripe.Event);
    const p = await prisma.payment.findFirst({ where: { providerIntentId: intentId } });
    expect(p!.status).toBe("FAILED");
    expect(p!.failureCode).toBe("card_declined");
  });

  it("ignores a metadata appointmentId that belongs to another tenant", async () => {
    const t1 = await tenant();
    const t2 = await tenant();
    cleanup.push(t1.id, t2.id);
    const emp = await prisma.employee.create({
      data: { tenantId: t2.id, name: "B", status: "ACTIVE" },
    });
    const svc = await prisma.service.create({
      data: {
        tenantId: t2.id,
        name: "Corte",
        priceCents: 4000,
        currency: "BRL",
        durationMin: 30,
        status: "ACTIVE",
      },
    });
    const cust = await prisma.customer.create({ data: { tenantId: t2.id, name: "C" } });
    const start = new Date(Date.now() + 3 * 86400000);
    const foreignAppt = await prisma.appointment.create({
      data: {
        tenantId: t2.id,
        customerId: cust.id,
        employeeId: emp.id,
        serviceId: svc.id,
        status: "PENDING",
        source: "PUBLIC_PAGE",
        startsAt: start,
        endsAt: new Date(start.getTime() + 1800000),
        serviceName: "Corte",
        durationMin: 30,
        bufferMin: 0,
        priceCents: 4000,
        currency: "BRL",
      },
    });
    const ev = {
      id: `evt_${uniq()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${uniq()}`,
          payment_status: "paid",
          amount_total: 4000,
          currency: "brl",
          payment_intent: `pi_${uniq()}`,
          metadata: { tenantId: t1.id, appointmentId: foreignAppt.id, customerId: cust.id },
        },
      },
    } as unknown as Stripe.Event;
    await handleConnectEvent(ev);

    const pay = await prisma.payment.findFirst({
      where: { tenantId: t1.id, purpose: "CLIENT_PAYMENT" },
    });
    expect(pay!.appointmentId).toBeNull(); // cross-tenant id was dropped
    expect(pay!.customerId).toBeNull();
    const stillPending = await prisma.appointment.findUnique({ where: { id: foreignAppt.id } });
    expect(stillPending!.status).toBe("PENDING"); // never touched
  });
});
