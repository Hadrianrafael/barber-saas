import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { logFinancialEvent } from "@/server/payments/log";
import { applyAccountUpdate } from "./connect";

/**
 * Stripe **Connect** webhook mapping — client → barbershop payments only.
 * Idempotent per handler (upsert / status guards) on top of the route-level
 * WebhookEvent de-dup (provider = "stripe_connect").
 *
 * `eventAccount` is `event.account` — the connected account the event fired on.
 * Handlers that touch a specific tenant assert this matches that tenant's
 * `PayoutAccount.providerAccountId` so a mislabelled `metadata.tenantId` can
 * never move money onto the wrong tenant's ledger.
 */

function applicationFee(amountCents: number): number {
  return Math.round((amountCents * env.PLATFORM_FEE_BPS) / 10_000);
}

/** True when the connected account on the event belongs to this tenant. */
async function accountMatchesTenant(
  tenantId: string,
  eventAccount: string | undefined,
): Promise<boolean> {
  if (!eventAccount) return true; // some test/replay events omit it; other guards still apply
  const acct = await prisma.payoutAccount.findUnique({
    where: { tenantId },
    select: { providerAccountId: true },
  });
  return acct?.providerAccountId === eventAccount;
}

export async function handleConnectEvent(
  event: Stripe.Event,
  eventAccount?: string,
): Promise<{ handled: boolean }> {
  switch (event.type) {
    case "account.updated":
      await applyAccountUpdate(
        event.data.object as unknown as Parameters<typeof applyAccountUpdate>[0],
      );
      return { handled: true };
    case "checkout.session.completed":
      await onCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
        event.id,
        eventAccount,
      );
      return { handled: true };
    case "payment_intent.succeeded":
      await onIntentSucceeded(event.data.object as Stripe.PaymentIntent);
      return { handled: true };
    case "payment_intent.payment_failed":
      await onIntentFailed(event.data.object as Stripe.PaymentIntent);
      return { handled: true };
    case "charge.refunded":
      await onChargeRefunded(event.data.object as Stripe.Charge);
      return { handled: true };
    default:
      logger.debug({ type: event.type }, "connect.webhook.ignored");
      return { handled: false };
  }
}

async function onCheckoutCompleted(
  s: Stripe.Checkout.Session,
  eventId: string,
  eventAccount: string | undefined,
) {
  const meta = s.metadata ?? {};
  const linkId = (meta.paymentLinkId as string) || undefined;
  const tenantId = (meta.tenantId as string) || undefined;
  if (!tenantId) return;
  if (s.payment_status !== "paid") return;

  if (!(await accountMatchesTenant(tenantId, eventAccount))) {
    logFinancialEvent(
      "connect.checkout.account_mismatch",
      {
        flow: "client_payment",
        tenantId,
        stripeEventId: eventId,
        stripeAccountId: eventAccount ?? null,
      },
      "error",
    );
    throw new Error("connect event account does not match tenant payout account");
  }

  const amountCents = s.amount_total ?? 0;
  const currency = (s.currency ?? "brl").toUpperCase();
  const fee = applicationFee(amountCents);
  const intentId =
    typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);

  let confirmedAppointmentId: string | null = null;
  let createdPaymentId: string | null = null;
  await prisma.$transaction(async (tx) => {
    // De-dup on the intent id.
    if (intentId) {
      const dup = await tx.payment.findFirst({ where: { providerIntentId: intentId } });
      if (dup) return;
    }

    let appointmentId: string | null = (meta.appointmentId as string) || null;
    let customerId: string | null = (meta.customerId as string) || null;
    if (linkId) {
      const link = await tx.paymentLink.findFirst({ where: { id: linkId, tenantId } });
      if (link) {
        await tx.paymentLink.update({
          where: { id: link.id },
          data: { status: "PAID", paidAt: new Date() },
        });
        appointmentId ||= link.appointmentId;
        customerId ||= link.customerId;
      }
    }
    // Never trust a metadata appointment/customer id that isn't this tenant's.
    if (appointmentId) {
      const ok = await tx.appointment.count({ where: { id: appointmentId, tenantId } });
      if (ok === 0) appointmentId = null;
    }
    if (customerId) {
      const ok = await tx.customer.count({ where: { id: customerId, tenantId } });
      if (ok === 0) customerId = null;
    }

    const payment = await tx.payment.create({
      data: {
        tenantId,
        purpose: "CLIENT_PAYMENT",
        status: "SUCCEEDED",
        method: "CARD",
        amountCents,
        currency,
        platformFeeCents: fee,
        netCents: amountCents - fee,
        provider: "stripe",
        providerIntentId: intentId,
        customerId,
        appointmentId,
        paymentLinkId: linkId ?? null,
        paidAt: new Date(),
      },
      select: { id: true },
    });
    createdPaymentId = payment.id;

    // A paid public booking is auto-confirmed (idempotent: only PENDING moves).
    if (appointmentId) {
      const moved = await tx.appointment.updateMany({
        where: { id: appointmentId, tenantId, status: "PENDING" },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
      });
      if (moved.count > 0) confirmedAppointmentId = appointmentId;
    }
  });
  if (confirmedAppointmentId) {
    void import("@/worker/queues")
      .then((m) =>
        m.enqueueAppointmentNotification(confirmedAppointmentId!, "appointment_confirmation"),
      )
      .catch((e) => logger.warn({ err: (e as Error).message }, "connect.confirm_notify_failed"));
  }
  logFinancialEvent("connect.checkout.paid", {
    flow: "client_payment",
    tenantId,
    stripeEventId: eventId,
    stripeAccountId: eventAccount ?? null,
    paymentId: createdPaymentId,
    stripePaymentIntentId: intentId,
    amountCents,
    currency,
    status: createdPaymentId ? "SUCCEEDED" : "DUPLICATE",
  });
}

async function onIntentSucceeded(pi: Stripe.PaymentIntent) {
  const chargeId =
    typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge?.id ?? null);
  if (!chargeId) return;
  await prisma.payment.updateMany({
    where: { providerIntentId: pi.id, providerChargeId: null },
    data: { providerChargeId: chargeId, status: "SUCCEEDED" },
  });
}

async function onIntentFailed(pi: Stripe.PaymentIntent) {
  const updated = await prisma.payment.updateMany({
    where: { providerIntentId: pi.id, status: { in: ["REQUIRES_PAYMENT", "PROCESSING"] } },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      failureCode: pi.last_payment_error?.code ?? null,
    },
  });
  if (updated.count > 0) {
    logFinancialEvent(
      "connect.payment_intent.failed",
      {
        flow: "client_payment",
        stripePaymentIntentId: pi.id,
        status: "FAILED",
      },
      "warn",
    );
  }
}

async function onChargeRefunded(ch: Stripe.Charge) {
  const payment = await prisma.payment.findFirst({
    where: { providerChargeId: ch.id, purpose: "CLIENT_PAYMENT" },
  });
  if (!payment) return;
  const refunded = ch.amount_refunded ?? 0;
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      refundedCents: refunded,
      status: refunded >= payment.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
    },
  });
  logFinancialEvent("connect.charge.refunded", {
    flow: "client_payment",
    tenantId: payment.tenantId,
    paymentId: payment.id,
    stripeChargeId: ch.id,
    amountCents: refunded,
    currency: payment.currency,
    status: refunded >= payment.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
  });
}
