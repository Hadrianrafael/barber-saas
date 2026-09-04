import "server-only";
import type { SalesLead, SalesMessage } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { isConfigured } from "@/env";
import { logger } from "@/lib/logger";
import { storage } from "@/server/storage";
import { sendEmail } from "@/server/mail";
import {
  sendText as waSendText,
  sendAudio as waSendAudio,
  WhatsAppApiError,
} from "@/server/whatsapp";
import { getVoiceProvider } from "@/server/voice";
import { getOrCreateConversation, appendMessage, renderTemplate } from "./conversation";
import { assertContactable, type ContactChannel } from "./guard";
import { setLeadStatus } from "./leads";

/**
 * The only way a sales message leaves the system. Every call goes through
 * `assertContactable` (opt-out / suppression / TEST-MODE allowlist / consent /
 * daily cap). A blocked attempt is still persisted as a FAILED SalesMessage so
 * the reason is visible in the inbox — it is never silently dropped.
 */

export type OutboundKind = "TEXT" | "AUDIO";

export interface OutboundResult {
  ok: boolean;
  messageId?: string;
  providerMessageId?: string;
  blockedReason?: string;
  error?: string;
}

function vars(
  lead: Pick<SalesLead, "name" | "barbershopName" | "city">,
  extra?: Record<string, string>,
) {
  return {
    nome: lead.name ?? "",
    barbearia: lead.barbershopName ?? "",
    cidade: lead.city ?? "",
    ...extra,
  };
}

async function persistBlocked(
  leadId: string,
  conversationId: string | null,
  channel: ContactChannel,
  kind: OutboundKind,
  body: string,
  reason: string,
  campaignId?: string | null,
): Promise<OutboundResult> {
  const msg = await prisma.salesMessage.create({
    data: {
      conversationId,
      leadId,
      campaignId: campaignId ?? null,
      direction: "OUTBOUND",
      kind,
      channel,
      status: "FAILED",
      body: body.slice(0, 8000),
      error: `blocked: ${reason}`.slice(0, 500),
    },
  });
  logger.info({ leadId, reason }, "sdr.outbound.blocked");
  return { ok: false, messageId: msg.id, blockedReason: reason };
}

/** Send one outbound message to a lead. `templateVars` are applied to `text`. */
export async function sendOutbound(args: {
  lead: SalesLead;
  channel: ContactChannel;
  kind: OutboundKind;
  text: string;
  subject?: string;
  campaignId?: string | null;
  templateVars?: Record<string, string>;
  voice?: string;
  advanceStatusTo?: SalesLead["status"];
}): Promise<OutboundResult> {
  const { lead, channel, kind } = args;
  const body = renderTemplate(args.text, vars(lead, args.templateVars)).trim();
  if (!body) return { ok: false, error: "empty body" };

  const decision = await assertContactable(lead, channel);
  const conv =
    channel === "WHATSAPP"
      ? await getOrCreateConversation({ leadId: lead.id, channel: "WHATSAPP" })
      : await getOrCreateConversation({ leadId: lead.id, channel: "EMAIL" });

  if (!decision.ok) {
    return persistBlocked(
      lead.id,
      conv.id,
      channel,
      kind,
      body,
      decision.reason ?? "blocked",
      args.campaignId,
    );
  }
  const to = decision.recipient;

  // --- EMAIL -------------------------------------------------------------
  if (channel === "EMAIL") {
    if (!isConfigured.resend) {
      logger.warn({ leadId: lead.id }, "sdr.outbound.email_console_only");
    }
    try {
      const { id } = await sendEmail({
        to,
        subject: args.subject?.trim() || "Sobre a sua barbearia",
        html: `<p>${body.replace(/\n/g, "<br>")}</p>`,
        text: body,
      });
      const msg = await appendMessage({
        conversationId: conv.id,
        leadId: lead.id,
        campaignId: args.campaignId,
        direction: "OUTBOUND",
        kind: "TEXT",
        channel: "EMAIL",
        body,
        provider: "resend",
        providerMessageId: id,
        status: "SENT",
      });
      if (args.advanceStatusTo)
        await setLeadStatus(lead.id, args.advanceStatusTo, null, { via: "email" });
      return { ok: true, messageId: msg.id, providerMessageId: id ?? undefined };
    } catch (e) {
      return recordSendError(lead.id, conv.id, "EMAIL", kind, body, e, args.campaignId);
    }
  }

  // --- WHATSAPP --------------------------------------------------------
  if (!isConfigured.whatsapp) {
    return persistBlocked(
      lead.id,
      conv.id,
      "WHATSAPP",
      kind,
      body,
      "whatsapp_not_configured",
      args.campaignId,
    );
  }

  try {
    if (kind === "AUDIO") {
      const provider = getVoiceProvider();
      const { audio, contentType } = await provider.synthesize({ text: body, voice: args.voice });
      const key = `sdr/audio/${lead.id}/${conv.id}-${Date.now()}.mp3`;
      const stored = await storage.put(key, audio, contentType || "audio/mpeg");
      const { id } = await waSendAudio(to, audio, contentType || "audio/mpeg");
      const msg = await appendMessage({
        conversationId: conv.id,
        leadId: lead.id,
        campaignId: args.campaignId,
        direction: "OUTBOUND",
        kind: "AUDIO",
        channel: "WHATSAPP",
        body,
        mediaUrl: stored.url,
        provider: "whatsapp_cloud",
        providerMessageId: id,
        status: "SENT",
      });
      if (args.advanceStatusTo)
        await setLeadStatus(lead.id, args.advanceStatusTo, null, { via: "whatsapp_audio" });
      return { ok: true, messageId: msg.id, providerMessageId: id };
    }

    const { id } = await waSendText(to, body);
    const msg = await appendMessage({
      conversationId: conv.id,
      leadId: lead.id,
      campaignId: args.campaignId,
      direction: "OUTBOUND",
      kind: "TEXT",
      channel: "WHATSAPP",
      body,
      provider: "whatsapp_cloud",
      providerMessageId: id,
      status: "SENT",
    });
    if (args.advanceStatusTo)
      await setLeadStatus(lead.id, args.advanceStatusTo, null, { via: "whatsapp" });
    return { ok: true, messageId: msg.id, providerMessageId: id };
  } catch (e) {
    return recordSendError(lead.id, conv.id, "WHATSAPP", kind, body, e, args.campaignId);
  }
}

async function recordSendError(
  leadId: string,
  conversationId: string,
  channel: ContactChannel,
  kind: OutboundKind,
  body: string,
  e: unknown,
  campaignId?: string | null,
): Promise<OutboundResult> {
  const retriable = e instanceof WhatsAppApiError ? e.retriable : true;
  const message = e instanceof Error ? e.message : String(e);
  const msg = await prisma.salesMessage.create({
    data: {
      conversationId,
      leadId,
      campaignId: campaignId ?? null,
      direction: "OUTBOUND",
      kind,
      channel,
      status: "FAILED",
      body: body.slice(0, 8000),
      error: message.slice(0, 500),
      nextAttemptAt: retriable ? new Date(Date.now() + 5 * 60_000) : null,
    },
  });
  logger.error({ leadId, err: message, retriable }, "sdr.outbound.send_failed");
  return { ok: false, messageId: msg.id, error: message };
}

/** Re-attempt a single FAILED outbound message (used by the sdr-followup cron). */
export async function retryOutbound(messageId: string): Promise<OutboundResult> {
  const m = await prisma.salesMessage.findUnique({
    where: { id: messageId },
    include: { lead: true },
  });
  if (!m || m.direction !== "OUTBOUND" || m.status !== "FAILED" || !m.lead) {
    return { ok: false, error: "not a retriable message" };
  }
  await prisma.salesMessage.update({
    where: { id: messageId },
    data: { attempts: { increment: 1 }, nextAttemptAt: null },
  });
  return sendOutbound({
    lead: m.lead,
    channel: m.channel as ContactChannel,
    kind: m.kind === "AUDIO" ? "AUDIO" : "TEXT",
    text: m.body,
    campaignId: m.campaignId,
  });
}

export async function dueRetryMessages(limit = 100): Promise<SalesMessage[]> {
  return prisma.salesMessage.findMany({
    where: {
      direction: "OUTBOUND",
      status: "FAILED",
      nextAttemptAt: { not: null, lte: new Date() },
      attempts: { lt: 4 },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
}
