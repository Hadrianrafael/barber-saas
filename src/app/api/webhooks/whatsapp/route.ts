import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env, isConfigured } from "@/env";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { enqueueSdrInbound } from "@/worker/queues";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * WhatsApp Business Platform (Meta Cloud API) webhook.
 * GET  — verification handshake (`hub.challenge`).
 * POST — delivery/read receipts (update Message status) + inbound messages.
 * Body signature verified with `WHATSAPP_APP_SECRET` (X-Hub-Signature-256).
 */

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (
    p.get("hub.mode") === "subscribe" &&
    env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
    p.get("hub.verify_token") === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  ) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

function verifySignature(raw: string, header: string | null): boolean {
  if (!env.WHATSAPP_APP_SECRET || !header) return false;
  const expected =
    "sha256=" + createHmac("sha256", env.WHATSAPP_APP_SECRET).update(raw).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const STATUS_MAP: Record<string, "SENT" | "DELIVERED" | "READ" | "FAILED"> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export async function POST(req: NextRequest) {
  if (!isConfigured.whatsapp) {
    return NextResponse.json(
      { received: true, ignored: "whatsapp_not_configured" },
      { status: 200 },
    );
  }
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    logger.warn("whatsapp.webhook.bad_signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          statuses?: { id: string; status: string; timestamp?: string; errors?: unknown }[];
          messages?: {
            id: string;
            from: string;
            timestamp?: string;
            text?: { body?: string };
            type?: string;
            audio?: { id?: string; voice?: boolean };
          }[];
        };
      }[];
    }[];
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};

        for (const st of value.statuses ?? []) {
          const mapped = STATUS_MAP[st.status];
          if (!mapped) continue;
          const now = new Date(st.timestamp ? Number(st.timestamp) * 1000 : Date.now());
          await prisma.message.updateMany({
            where: { provider: "whatsapp_cloud", providerMessageId: st.id },
            data: {
              status: mapped,
              deliveredAt: mapped === "DELIVERED" || mapped === "READ" ? now : undefined,
              readAt: mapped === "READ" ? now : undefined,
              error:
                mapped === "FAILED"
                  ? JSON.stringify(st.errors ?? "failed").slice(0, 500)
                  : undefined,
            },
          });
          // SDR sales messages share the same provider ids.
          await prisma.salesMessage
            .updateMany({
              where: { provider: "whatsapp_cloud", providerMessageId: st.id },
              data: {
                status: mapped,
                deliveredAt: mapped === "DELIVERED" || mapped === "READ" ? now : undefined,
                readAt: mapped === "READ" ? now : undefined,
                error: mapped === "FAILED" ? JSON.stringify(st.errors ?? "failed").slice(0, 500) : undefined,
              },
            })
            .catch(() => undefined);
        }

        for (const inbound of value.messages ?? []) {
          // SDR / AI Sales Assistant: hand every inbound off to the async
          // pipeline (idempotent on the provider message id). It ignores
          // senders that aren't known sales leads.
          await enqueueSdrInbound({
            provider: "whatsapp_cloud",
            providerMessageId: inbound.id,
            from: inbound.from,
            type: inbound.type ?? "text",
            text: inbound.text?.body,
            mediaId: inbound.audio?.id,
            timestamp: inbound.timestamp ? Number(inbound.timestamp) : undefined,
          }).catch((e) =>
            logger.warn({ err: (e as Error).message, id: inbound.id }, "sdr.inbound.enqueue_failed"),
          );

          // Best-effort tenant resolution by the sender's number (single-number
          // pilot; per-tenant phone numbers are a follow-up — see ADR 0008).
          const from = inbound.from.replace(/[^\d]/g, "");
          const cust = await prisma.customer.findFirst({
            where: { OR: [{ whatsapp: { contains: from } }, { phone: { contains: from } }] },
            select: { id: true, tenantId: true, locale: true },
          });
          if (!cust) continue;
          await prisma.message
            .create({
              data: {
                tenantId: cust.tenantId,
                customerId: cust.id,
                channel: "WHATSAPP",
                direction: "INBOUND",
                status: "DELIVERED",
                provider: "whatsapp_cloud",
                providerMessageId: inbound.id,
                locale: cust.locale,
                toAddress: env.WHATSAPP_PHONE_NUMBER_ID,
                body: inbound.text?.body ?? `[${inbound.type ?? "non-text"}]`,
                category: "transactional",
              },
            })
            .catch((e: { code?: string }) => {
              if (e.code !== "P2002") throw e; // duplicate delivery
            });
        }
      }
    }
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    logger.error({ err }, "whatsapp.webhook.handler_failed");
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
