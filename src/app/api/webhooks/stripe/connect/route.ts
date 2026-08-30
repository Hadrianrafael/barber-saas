import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { isConfigured } from "@/env";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { paymentProvider } from "@/server/payments";
import { handleConnectEvent } from "@/features/payments/webhooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stripe Connect webhook — client → barbershop payments. Separate endpoint and
 * separate signing secret (`STRIPE_CONNECT_WEBHOOK_SECRET`) from the SaaS
 * subscription webhook. Idempotent via WebhookEvent (provider = "stripe_connect").
 */
export async function POST(req: NextRequest) {
  if (!isConfigured.stripeConnect) {
    return NextResponse.json(
      { received: true, ignored: "stripe_connect_not_configured" },
      { status: 200 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = paymentProvider.verifyWebhook(payload, signature, "connect").raw as Stripe.Event;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "connect.webhook.bad_signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    await prisma.webhookEvent.create({
      data: {
        provider: "stripe_connect",
        eventId: event.id,
        type: event.type,
        payload: event as unknown as object,
        status: "received",
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
    throw err;
  }

  try {
    const result = await handleConnectEvent(event);
    await prisma.webhookEvent.update({
      where: { provider_eventId: { provider: "stripe_connect", eventId: event.id } },
      data: { status: result.handled ? "processed" : "ignored", processedAt: new Date() },
    });
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    logger.error({ err, type: event.type, id: event.id }, "connect.webhook.handler_failed");
    await prisma.webhookEvent
      .update({
        where: { provider_eventId: { provider: "stripe_connect", eventId: event.id } },
        data: { status: "failed", error: (err as Error).message.slice(0, 500) },
      })
      .catch(() => undefined);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
