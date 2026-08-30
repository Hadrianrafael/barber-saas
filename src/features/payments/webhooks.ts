import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { applyAccountUpdate } from "./connect";

/**
 * Stripe **Connect** webhook mapping — client → barbershop payments only.
 * Idempotent per handler (upsert / status guards) on top of the route-level
 * WebhookEvent de-dup (provider = "stripe_connect").
 */

function applicationFee(amountCents: number): number {
  return Math.round((amountCents * env.PLATFORM_FEE_BPS) / 10_000);
}

export async function handleConnectEvent(event: Stripe.Event): Promise<{ handled: boolean }> {
  switch (event.type) {
    case "account.updated":
      await applyAccountUpdate(
        event.data.object as unknown as Parameters<typeof applyAccountUpdate>[0],
      );
      return { handled: true };
    case "checkout.session.completed":
      await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
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

async function onCheckoutCompleted(s: Stripe.Checkout.Session) {
  const meta = s.metadata ?? {};
  const linkId = (meta.paymentLinkId as string) || undefined;
  const tenantId = (meta.tenantId as string) || undefined;
  if (!tenantId) return;
  if (s.payment_status !== "paid") return;

  const amountCents = s.amount_total ?? 0;
  const currency = (s.currency ?? "brl").toUpperCase();
  const fee = applicationFee(amountCents);
  const intentId =
    typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);

  let confirmedAppointmentId: string | null = null;
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

    await tx.payment.create({
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
    });

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
  logger.info({ tenantId, linkId, amountCents }, "connect.checkout.paid");
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
  await prisma.payment.updateMany({
    where: { providerIntentId: pi.id, status: { in: ["REQUIRES_PAYMENT", "PROCESSING"] } },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      failureCode: pi.last_payment_error?.code ?? null,
    },
  });
}

async function onChargeRefunded(ch: Stripe.Charge) {
  const payment = await prisma.payment.findFirst({
    where: { providerChargeId: ch.id },
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
  logger.info({ paymentId: payment.id, refunded }, "connect.charge.refunded");
}
