import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { isConfigured } from "@/env";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { paymentProvider } from "@/server/payments";
import { handleStripeEvent } from "@/features/billing/webhooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stripe webhook for the SaaS subscription flow (platform account).
 *
 * - Signature is verified before any processing (never trust the body).
 * - Idempotent: a `WebhookEvent` row keyed on (provider, eventId) is inserted
 *   first; a duplicate delivery is a no-op 200.
 * - On handler failure we return 500 so Stripe retries with back-off.
 * - If Stripe isn't configured yet, we ACK with 200 and record nothing —
 *   the endpoint is real, just inert until keys are set.
 */
export async function POST(req: NextRequest) {
  if (!isConfigured.stripe) {
    return NextResponse.json({ received: true, ignored: "stripe_not_configured" }, { status: 200 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = paymentProvider.verifyWebhook(payload, signature, "platform").raw as Stripe.Event;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "stripe.webhook.bad_signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  // Idempotency gate.
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: "stripe",
        eventId: event.id,
        type: event.type,
        payload: event as unknown as object,
        status: "received",
      },
    });
  } catch (err) {
    // Unique (provider, eventId) -> already seen.
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
    throw err;
  }

  try {
    const result = await handleStripeEvent(event);
    await prisma.webhookEvent.update({
      where: { provider_eventId: { provider: "stripe", eventId: event.id } },
      data: { status: result.handled ? "processed" : "ignored", processedAt: new Date() },
    });
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    logger.error({ err, type: event.type, id: event.id }, "stripe.webhook.handler_failed");
    await prisma.webhookEvent
      .update({
        where: { provider_eventId: { provider: "stripe", eventId: event.id } },
        data: { status: "failed", error: (err as Error).message.slice(0, 500) },
      })
      .catch(() => undefined);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
