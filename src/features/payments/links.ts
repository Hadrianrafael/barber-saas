import "server-only";
import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { paymentProvider } from "@/server/payments";
import { requireEnabledAccount } from "./connect";

/**
 * Payment links / one-off client charges on a barbershop's connected account.
 * The link is a Stripe Checkout Session URL created *on* the connected account
 * with an optional platform application fee.
 */

function applicationFee(amountCents: number): number {
  return Math.round((amountCents * env.PLATFORM_FEE_BPS) / 10_000);
}

interface CreateLinkInput {
  tenantId: string;
  description: string;
  amountCents: number;
  currency: string;
  customerId?: string | null;
  appointmentId?: string | null;
  createdById?: string | null;
  locale: string;
}

export async function createPaymentLink(input: CreateLinkInput) {
  if (input.amountCents < 100) {
    const e = new Error("amount_too_low");
    e.name = "ValidationError";
    throw e;
  }
  const acct = await requireEnabledAccount(input.tenantId);

  if (input.customerId) {
    const c = await prisma.customer.count({
      where: { id: input.customerId, tenantId: input.tenantId },
    });
    if (c === 0) {
      const e = new Error("customer_not_found");
      e.name = "NotFoundError";
      throw e;
    }
  }
  if (input.appointmentId) {
    const a = await prisma.appointment.count({
      where: { id: input.appointmentId, tenantId: input.tenantId },
    });
    if (a === 0) {
      const e = new Error("appointment_not_found");
      e.name = "NotFoundError";
      throw e;
    }
  }

  const link = await prisma.paymentLink.create({
    data: {
      tenantId: input.tenantId,
      customerId: input.customerId ?? null,
      appointmentId: input.appointmentId ?? null,
      description: input.description,
      amountCents: input.amountCents,
      currency: input.currency,
      status: "ACTIVE",
      provider: "stripe",
      createdById: input.createdById ?? null,
    },
  });

  const base = `${env.APP_URL}/${input.locale}`;
  const checkout = await paymentProvider.createOneOffCheckout({
    tenantId: input.tenantId,
    connectedAccountId: acct.providerAccountId!,
    description: input.description,
    amount: { amountCents: input.amountCents, currency: input.currency },
    applicationFeeCents: applicationFee(input.amountCents),
    successUrl: `${base}/pay/success?link=${link.id}`,
    cancelUrl: `${base}/pay/canceled?link=${link.id}`,
    metadata: {
      paymentLinkId: link.id,
      tenantId: input.tenantId,
      appointmentId: input.appointmentId ?? "",
      customerId: input.customerId ?? "",
    },
  });

  const updated = await prisma.paymentLink.update({
    where: { id: link.id },
    data: { providerObject: checkout.id, url: checkout.url },
  });
  logger.info({ tenantId: input.tenantId, linkId: link.id }, "payment_link.created");
  return updated;
}

export async function listPaymentLinks(tenantId: string, limit = 50) {
  return prisma.paymentLink.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { customer: { select: { name: true } } },
  });
}

export async function cancelPaymentLink(tenantId: string, id: string) {
  await prisma.paymentLink.updateMany({
    where: { id, tenantId, status: "ACTIVE" },
    data: { status: "CANCELED" },
  });
}

export async function listClientPayments(tenantId: string, limit = 50) {
  return prisma.payment.findMany({
    where: { tenantId, purpose: "CLIENT_PAYMENT" },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      customer: { select: { name: true } },
      appointment: { select: { serviceName: true, startsAt: true } },
    },
  });
}

export async function refundClientPayment(
  tenantId: string,
  paymentId: string,
  amountCents?: number,
) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, tenantId, purpose: "CLIENT_PAYMENT" },
  });
  if (!payment) {
    const e = new Error("payment_not_found");
    e.name = "NotFoundError";
    throw e;
  }
  if (payment.status !== "SUCCEEDED" && payment.status !== "PARTIALLY_REFUNDED") {
    const e = new Error("not_refundable");
    e.name = "ValidationError";
    throw e;
  }
  if (!payment.providerChargeId) {
    const e = new Error("no_charge_id");
    e.name = "ValidationError";
    throw e;
  }
  const maxRefund = payment.amountCents - payment.refundedCents;
  const amount = Math.min(amountCents ?? maxRefund, maxRefund);
  if (amount <= 0) {
    const e = new Error("nothing_to_refund");
    e.name = "ValidationError";
    throw e;
  }

  await paymentProvider.refund(payment.providerChargeId, amount);
  const newRefunded = payment.refundedCents + amount;
  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      refundedCents: newRefunded,
      status: newRefunded >= payment.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
    },
  });
  logger.info({ tenantId, paymentId, amount }, "payment.refunded");
  return updated;
}
