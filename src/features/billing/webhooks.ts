import "server-only";
import type Stripe from "stripe";
import type { SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";

/**
 * Stripe → domain mapping for the **SaaS subscription** flow (platform account).
 * `customer.subscription.*` events are the source of truth for status/period;
 * `invoice.*` events drive the billing history and grace period. Every handler
 * is idempotent on its own (upsert by provider id) on top of the route-level
 * WebhookEvent de-dup.
 *
 * Client → barbershop money (Stripe Connect) is a separate flow handled in
 * src/features/payments/ (Slice 6) — never mixed here.
 */

const GRACE_DAYS = 7;

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  canceled: "CANCELED",
  unpaid: "UNPAID",
  incomplete: "INCOMPLETE",
  incomplete_expired: "INCOMPLETE",
  paused: "PAST_DUE",
};

function tsToDate(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null;
}

async function planForPriceId(priceId: string | null | undefined) {
  if (!priceId) return null;
  return prisma.plan.findFirst({
    where: { OR: [{ stripePriceId: priceId }, { stripePriceIdYearly: priceId }] },
  });
}

async function tenantIdForCustomer(customerId: string | null | undefined) {
  if (!customerId) return null;
  const t = await prisma.tenant.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  return t?.id ?? null;
}

/** Dispatches a verified Stripe event. Throws on unexpected failure (Stripe retries). */
export async function handleStripeEvent(event: Stripe.Event): Promise<{ handled: boolean }> {
  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      return { handled: true };
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await onSubscription(event.data.object as Stripe.Subscription);
      return { handled: true };
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
      return { handled: true };
    case "invoice.paid":
    case "invoice.payment_succeeded":
      await onInvoicePaid(event.data.object as Stripe.Invoice);
      return { handled: true };
    case "invoice.finalized":
    case "invoice.created":
      await onInvoiceOpen(event.data.object as Stripe.Invoice);
      return { handled: true };
    case "invoice.payment_failed":
      await onInvoiceFailed(event.data.object as Stripe.Invoice);
      return { handled: true };
    default:
      logger.debug({ type: event.type }, "stripe.webhook.ignored");
      return { handled: false };
  }
}

async function onCheckoutCompleted(s: Stripe.Checkout.Session) {
  if (s.mode !== "subscription") return; // one-off client payments handled elsewhere
  const tenantId = s.client_reference_id ?? (s.metadata?.tenantId as string | undefined) ?? null;
  const customerId = typeof s.customer === "string" ? s.customer : s.customer?.id;
  if (tenantId && customerId) {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeCustomerId: customerId },
    });
    logger.info({ tenantId, customerId }, "billing.checkout.completed");
  }
  // Subscription status/period arrives via customer.subscription.created next.
}

async function onSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const tenantId = await tenantIdForCustomer(customerId);
  if (!tenantId) {
    logger.warn({ subId: sub.id, customerId }, "billing.subscription.no_tenant");
    return;
  }

  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const plan = await planForPriceId(priceId);
  const interval = item?.price?.recurring?.interval === "year" ? "year" : "month";
  const status = STATUS_MAP[sub.status] ?? "INCOMPLETE";
  const currentPeriodEnd = tsToDate(sub.current_period_end);
  const gracePeriodEndsAt =
    status === "PAST_DUE" ? new Date(Date.now() + GRACE_DAYS * 86_400_000) : null;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.subscription.findFirst({
      where: { OR: [{ providerSubId: sub.id }, { tenantId, scope: "PLATFORM" }] },
    });
    const data = {
      tenantId,
      scope: "PLATFORM" as const,
      planId: plan?.id ?? existing?.planId ?? null,
      status,
      provider: "stripe",
      providerCustomerId: customerId,
      providerSubId: sub.id,
      priceCents: item?.price?.unit_amount ?? existing?.priceCents ?? null,
      currency: (item?.price?.currency ?? "brl").toUpperCase(),
      interval,
      currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: tsToDate(sub.canceled_at),
      gracePeriodEndsAt,
    };
    if (existing) {
      await tx.subscription.update({ where: { id: existing.id }, data });
    } else {
      await tx.subscription.create({ data });
    }

    // Reflect on the tenant so route guards / gate can act without a join.
    const tenantStatus =
      status === "ACTIVE" || status === "TRIALING"
        ? "ACTIVE"
        : status === "PAST_DUE"
          ? "PAST_DUE"
          : status === "CANCELED" || status === "UNPAID"
            ? "CANCELED"
            : undefined;
    if (tenantStatus) {
      await tx.tenant.update({ where: { id: tenantId }, data: { status: tenantStatus } });
    }
  });
  logger.info({ tenantId, subId: sub.id, status }, "billing.subscription.synced");
}

async function onSubscriptionDeleted(sub: Stripe.Subscription) {
  const updated = await prisma.subscription.updateMany({
    where: { providerSubId: sub.id },
    data: { status: "CANCELED", canceledAt: new Date(), cancelAtPeriodEnd: false },
  });
  if (updated.count > 0) {
    const row = await prisma.subscription.findFirst({ where: { providerSubId: sub.id } });
    if (row)
      await prisma.tenant.update({ where: { id: row.tenantId }, data: { status: "CANCELED" } });
  }
  logger.info({ subId: sub.id }, "billing.subscription.deleted");
}

async function upsertInvoice(inv: Stripe.Invoice, status: "OPEN" | "PAID" | "UNCOLLECTIBLE") {
  const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
  const tenantId = await tenantIdForCustomer(customerId);
  if (!tenantId) return null;
  const subId =
    typeof inv.subscription === "string" ? inv.subscription : (inv.subscription?.id ?? null);
  const sub = subId
    ? await prisma.subscription.findFirst({ where: { providerSubId: subId } })
    : null;

  const row = await prisma.invoice.upsert({
    where: { providerInvoiceId: inv.id },
    create: {
      tenantId,
      subscriptionId: sub?.id ?? null,
      scope: "PLATFORM",
      status,
      amountDueCents: inv.amount_due,
      amountPaidCents: inv.amount_paid,
      currency: inv.currency.toUpperCase(),
      provider: "stripe",
      providerInvoiceId: inv.id,
      hostedUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
      periodStart: tsToDate(inv.period_start),
      periodEnd: tsToDate(inv.period_end),
      dueAt: tsToDate(inv.due_date),
      paidAt: status === "PAID" ? new Date() : null,
    },
    update: {
      status,
      amountPaidCents: inv.amount_paid,
      hostedUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
      paidAt: status === "PAID" ? new Date() : undefined,
    },
  });
  return { row, tenantId, sub };
}

async function onInvoiceOpen(inv: Stripe.Invoice) {
  await upsertInvoice(inv, "OPEN");
}

async function onInvoicePaid(inv: Stripe.Invoice) {
  const res = await upsertInvoice(inv, "PAID");
  if (!res) return;
  const { row, tenantId, sub } = res;

  await prisma.payment.create({
    data: {
      tenantId,
      purpose: "SAAS_SUBSCRIPTION",
      status: "SUCCEEDED",
      method: "CARD",
      amountCents: inv.amount_paid,
      currency: inv.currency.toUpperCase(),
      provider: "stripe",
      providerChargeId: typeof inv.charge === "string" ? inv.charge : (inv.charge?.id ?? null),
      subscriptionId: sub?.id ?? null,
      invoiceId: row.id,
      paidAt: new Date(),
    },
  });

  // A successful payment clears a past-due state.
  if (sub && sub.status === "PAST_DUE") {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: "ACTIVE", gracePeriodEndsAt: null },
    });
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } });
  }
  logger.info({ tenantId, invoiceId: row.id }, "billing.invoice.paid");
}

async function onInvoiceFailed(inv: Stripe.Invoice) {
  const res = await upsertInvoice(inv, "OPEN");
  if (!res) return;
  const { tenantId, sub } = res;
  if (sub) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: "PAST_DUE",
        gracePeriodEndsAt: new Date(Date.now() + GRACE_DAYS * 86_400_000),
      },
    });
  }
  await prisma.tenant.update({ where: { id: tenantId }, data: { status: "PAST_DUE" } });
  logger.warn({ tenantId, invoiceId: inv.id }, "billing.invoice.failed");
}
