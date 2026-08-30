import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import {
  getEntitlements,
  assertWithinLimit,
  assertFeature,
  isPlanLimitError,
} from "@/features/billing/gate";
import { handleStripeEvent } from "@/features/billing/webhooks";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();
const uniq = () => Math.random().toString(36).slice(2, 10);

async function tenant(over: Record<string, unknown> = {}) {
  return prisma.tenant.create({
    data: {
      slug: `bil-${uniq()}`,
      name: "Bil",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() + 10 * 86400000),
      stripeCustomerId: `cus_${uniq()}`,
      ...over,
    },
  });
}

function subEvent(
  type: "customer.subscription.created" | "customer.subscription.updated",
  o: {
    customer: string;
    id: string;
    status: string;
    priceId?: string;
    interval?: "month" | "year";
    periodEnd?: number;
  },
): Stripe.Event {
  return {
    id: `evt_${uniq()}`,
    type,
    data: {
      object: {
        id: o.id,
        customer: o.customer,
        status: o.status,
        cancel_at_period_end: false,
        canceled_at: null,
        current_period_end: o.periodEnd ?? Math.floor(Date.now() / 1000) + 2_592_000,
        items: {
          data: [
            {
              price: {
                id: o.priceId ?? "price_x",
                unit_amount: 17900,
                currency: "brl",
                recurring: { interval: o.interval ?? "month" },
              },
            },
          ],
        },
      },
    },
  } as unknown as Stripe.Event;
}

function invoiceEvent(
  type: "invoice.paid" | "invoice.payment_failed",
  o: { customer: string; subscription: string; id: string },
): Stripe.Event {
  return {
    id: `evt_${uniq()}`,
    type,
    data: {
      object: {
        id: o.id,
        customer: o.customer,
        subscription: o.subscription,
        amount_due: 17900,
        amount_paid: type === "invoice.paid" ? 17900 : 0,
        currency: "brl",
        hosted_invoice_url: "https://stripe/inv",
        invoice_pdf: "https://stripe/inv.pdf",
        period_start: Math.floor(Date.now() / 1000) - 100,
        period_end: Math.floor(Date.now() / 1000) + 100,
        due_date: null,
        charge: `ch_${uniq()}`,
      },
    },
  } as unknown as Stripe.Event;
}

d("billing (DB)", () => {
  const cleanup: string[] = [];
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterAll(async () => {
    for (const id of cleanup) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("no subscription + active trial → not blocked, trial limits", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const ent = await getEntitlements(t.id);
    expect(ent.blocked).toBe(false);
    expect(ent.status).toBe("TRIALING");
    expect(ent.limits.maxEmployees).toBe(3);
  });

  it("no subscription + expired trial → blocked TRIAL_EXPIRED", async () => {
    const t = await tenant({ trialEndsAt: new Date(Date.now() - 86400000) });
    cleanup.push(t.id);
    const ent = await getEntitlements(t.id);
    expect(ent.blocked).toBe(true);
    expect(ent.blockReason).toBe("TRIAL_EXPIRED");
  });

  it("subscription webhook creates + syncs the subscription and tenant status", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const plan = await prisma.plan.findFirst({ where: { code: "pro" } });
    await prisma.plan.update({
      where: { id: plan!.id },
      data: { stripePriceId: `price_${uniq()}` },
    });
    const freshPlan = await prisma.plan.findUnique({ where: { id: plan!.id } });

    const subId = `sub_${uniq()}`;
    const ev = subEvent("customer.subscription.created", {
      customer: t.stripeCustomerId!,
      id: subId,
      status: "active",
      priceId: freshPlan!.stripePriceId!,
    });
    await handleStripeEvent(ev);
    // idempotent: same effect on replay
    await handleStripeEvent({ ...ev, id: `evt_${uniq()}` } as Stripe.Event);

    const subs = await prisma.subscription.findMany({
      where: { tenantId: t.id, scope: "PLATFORM" },
    });
    expect(subs).toHaveLength(1);
    expect(subs[0]!.status).toBe("ACTIVE");
    expect(subs[0]!.providerSubId).toBe(subId);
    const tt = await prisma.tenant.findUnique({ where: { id: t.id } });
    expect(tt!.status).toBe("ACTIVE");

    const ent = await getEntitlements(t.id);
    expect(ent.blocked).toBe(false);
    expect(ent.planCode).toBe("pro");
  });

  it("payment_failed → PAST_DUE + grace; invoice.paid → ACTIVE again + Payment + Invoice", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    const subId = `sub_${uniq()}`;
    await handleStripeEvent(
      subEvent("customer.subscription.created", {
        customer: t.stripeCustomerId!,
        id: subId,
        status: "active",
      }),
    );

    await handleStripeEvent(
      invoiceEvent("invoice.payment_failed", {
        customer: t.stripeCustomerId!,
        subscription: subId,
        id: `in_${uniq()}`,
      }),
    );
    let sub = await prisma.subscription.findFirst({ where: { providerSubId: subId } });
    expect(sub!.status).toBe("PAST_DUE");
    expect(sub!.gracePeriodEndsAt).not.toBeNull();
    expect((await getEntitlements(t.id)).inGrace).toBe(true);

    const paidInvId = `in_${uniq()}`;
    await handleStripeEvent(
      invoiceEvent("invoice.paid", {
        customer: t.stripeCustomerId!,
        subscription: subId,
        id: paidInvId,
      }),
    );
    sub = await prisma.subscription.findFirst({ where: { providerSubId: subId } });
    expect(sub!.status).toBe("ACTIVE");
    expect(sub!.gracePeriodEndsAt).toBeNull();

    const inv = await prisma.invoice.findFirst({ where: { providerInvoiceId: paidInvId } });
    expect(inv!.status).toBe("PAID");
    const pay = await prisma.payment.findFirst({
      where: { tenantId: t.id, purpose: "SAAS_SUBSCRIPTION", invoiceId: inv!.id },
    });
    expect(pay!.status).toBe("SUCCEEDED");
    expect(pay!.amountCents).toBe(17900);
  });

  it("plan-gate: employees cap is enforced", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    // trial limit maxEmployees = 3 — check-then-create, like the real action.
    for (let i = 0; i < 3; i++) {
      await assertWithinLimit(t.id, "employees");
      await prisma.employee.create({ data: { tenantId: t.id, name: `E${i}`, status: "ACTIVE" } });
    }
    let err: unknown;
    try {
      await assertWithinLimit(t.id, "employees");
    } catch (e) {
      err = e;
    }
    expect(isPlanLimitError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("LIMIT_EXCEEDED");
  });

  it("plan-gate: whatsapp feature is unavailable on the trial ceiling", async () => {
    const t = await tenant();
    cleanup.push(t.id);
    await expect(assertFeature(t.id, "whatsapp")).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
    });
  });
});
