import "server-only";
import type { MessageChannel } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import {
  sendViaEmail,
  sendViaWhatsApp,
  MessagingNotConfiguredError,
  MessagingSendError,
} from "./channels";

const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [1, 5, 30, 120, 360]; // minutes per attempt

export interface SendRequest {
  tenantId: string;
  customerId?: string | null;
  campaignId?: string | null;
  conversationId?: string | null;
  channel: MessageChannel;
  templateKey?: string | null;
  category?: "transactional" | "marketing";
  locale: string;
  to: string;
  subject?: string | null;
  text: string;
  html?: string | null;
}

/**
 * Persists a Message row and attempts delivery. On a retriable failure the row
 * is left FAILED with `nextAttemptAt` set — the worker's messaging processor
 * retries until MAX_ATTEMPTS. "Not configured" is a retriable failure so the
 * message goes out automatically once keys are added; it is never marked SENT.
 */
export async function sendMessage(req: SendRequest) {
  const message = await prisma.message.create({
    data: {
      tenantId: req.tenantId,
      customerId: req.customerId ?? null,
      campaignId: req.campaignId ?? null,
      conversationId: req.conversationId ?? null,
      channel: req.channel,
      direction: "OUTBOUND",
      status: "QUEUED",
      templateKey: req.templateKey ?? null,
      category: req.category ?? "transactional",
      locale: req.locale,
      toAddress: req.to,
      subject: req.subject ?? null,
      body: req.text,
    },
  });
  return attemptSend(message.id);
}

/** (Re)attempt a single message. Used by sendMessage and the retry worker. */
export async function attemptSend(messageId: string) {
  const m = await prisma.message.findUnique({ where: { id: messageId } });
  if (!m || m.status === "SENT" || m.status === "DELIVERED" || m.status === "READ") return m;

  const attempts = m.attempts + 1;
  try {
    let result: { providerMessageId: string | null; provider: string };
    if (m.channel === "EMAIL") {
      result = await sendViaEmail({
        to: m.toAddress,
        subject: m.subject ?? "",
        html: m.body.startsWith("<") ? m.body : `<p>${m.body}</p>`,
        text: m.body,
      });
    } else if (m.channel === "WHATSAPP") {
      result = await sendViaWhatsApp({ to: m.toAddress, text: m.body });
    } else {
      throw new MessagingSendError(`unsupported channel ${m.channel}`, false);
    }

    const updated = await prisma.message.update({
      where: { id: m.id },
      data: {
        status: "SENT",
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
        attempts,
        nextAttemptAt: null,
        error: null,
      },
    });
    logger.info({ messageId: m.id, channel: m.channel, provider: result.provider }, "message.sent");
    return updated;
  } catch (e) {
    const notConfigured = e instanceof MessagingNotConfiguredError;
    const retriable = notConfigured || !(e instanceof MessagingSendError) || e.retriable;
    const canRetry = retriable && attempts < MAX_ATTEMPTS;
    const backoff = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)]!;

    const updated = await prisma.message.update({
      where: { id: m.id },
      data: {
        status: "FAILED",
        attempts,
        error: (e as Error).message.slice(0, 500),
        nextAttemptAt: canRetry ? new Date(Date.now() + backoff * 60_000) : null,
      },
    });
    logger[canRetry ? "warn" : "error"](
      { messageId: m.id, channel: m.channel, attempts, canRetry, err: (e as Error).message },
      "message.send_failed",
    );
    return updated;
  }
}

/** Called by the scheduled retry job. Processes a batch of due failures. */
export async function retryDueMessages(limit = 50) {
  const due = await prisma.message.findMany({
    where: { status: "FAILED", nextAttemptAt: { not: null, lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const { id } of due) await attemptSend(id);
  return due.length;
}
