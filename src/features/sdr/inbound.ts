import "server-only";
import type { SalesConversation, SalesLead } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { isConfigured } from "@/env";
import { logger } from "@/lib/logger";
import { storage } from "@/server/storage";
import { downloadMedia, markRead } from "@/server/whatsapp";
import { transcribe } from "@/server/ai/openai";
import { normalizePhone } from "./phone";
import { getOrCreateConversation, appendMessage } from "./conversation";
import { detectOptOut } from "./suppression";
import { optOutLead, setLeadStatus } from "./leads";
import { getActiveAgentConfig } from "./agent-config";
import { runAgentTurn } from "./agent";
import { qualifyFromTranscript, applyQualification } from "./qualification";
import { sendOutbound } from "./outbound";

/**
 * Inbound WhatsApp pipeline: idempotent ingest → (audio) transcribe → opt-out
 * check → persist → AI turn (unless a human owns the conversation) → qualify →
 * hand off if hot → reply. Everything here is safe to call from a queue worker;
 * duplicates (Meta re-delivers) are no-ops.
 */

export interface InboundMessage {
  provider: string; // "whatsapp_cloud"
  providerMessageId: string;
  from: string; // sender phone (raw)
  type: string; // "text" | "audio" | ...
  text?: string;
  mediaId?: string;
  timestamp?: number;
}

export interface InboundResult {
  status:
    "ignored" | "duplicate" | "opted_out" | "handed_off" | "replied" | "queued_human" | "error";
  leadId?: string;
  conversationId?: string;
  detail?: string;
}

async function findLeadByPhone(raw: string): Promise<SalesLead | null> {
  const norm = normalizePhone(raw);
  if (!norm) return null;
  const tail = norm.slice(-11);
  return prisma.salesLead.findFirst({
    where: { OR: [{ whatsapp: { contains: tail } }, { phone: { contains: tail } }] },
    orderBy: { createdAt: "desc" },
  });
}

async function raiseHandoffAlert(
  lead: SalesLead,
  conv: SalesConversation,
  why: string,
): Promise<void> {
  await prisma.salesConversation.update({
    where: { id: conv.id },
    data: { handledBy: "HUMAN", status: "OPEN" },
  });
  await setLeadStatus(lead.id, "HUMANO", null, { why });
  await prisma.salesLeadEvent.create({
    data: { leadId: lead.id, kind: "handoff_alert", data: { why, conversationId: conv.id } },
  });
  logger.warn({ leadId: lead.id, conversationId: conv.id, why }, "sdr.inbound.handoff");
}

export async function processInbound(msg: InboundMessage): Promise<InboundResult> {
  // 1. idempotency
  const seen = await prisma.salesMessage.findFirst({
    where: { provider: msg.provider, providerMessageId: msg.providerMessageId },
    select: { id: true },
  });
  if (seen) return { status: "duplicate" };

  // 2. known lead only
  const lead = await findLeadByPhone(msg.from);
  if (!lead) {
    logger.info({ from: msg.from.slice(-4) }, "sdr.inbound.unknown_lead");
    return { status: "ignored", detail: "unknown lead" };
  }

  const conv = await getOrCreateConversation({ leadId: lead.id, channel: "WHATSAPP" });

  // 3. resolve body (transcribe audio)
  let body = (msg.text ?? "").trim();
  let kind: "TEXT" | "AUDIO" = "TEXT";
  let mediaUrl: string | null = null;

  if (msg.type === "audio" && msg.mediaId) {
    kind = "AUDIO";
    if (isConfigured.whatsapp) {
      try {
        const media = await downloadMedia(msg.mediaId);
        const key = `sdr/audio/inbound/${lead.id}/${msg.providerMessageId}.ogg`;
        mediaUrl = (await storage.put(key, media.bytes, media.contentType)).url;
        if (isConfigured.openai) {
          const t = await transcribe({
            audio: media.bytes,
            filename: "inbound.ogg",
            contentType: media.contentType,
          });
          body = t.text.trim();
        }
      } catch (e) {
        logger.error({ err: (e as Error).message, leadId: lead.id }, "sdr.inbound.audio_failed");
      }
    }
    if (!body) body = "[áudio recebido]";
  }

  if (!body) return { status: "ignored", detail: "empty inbound" };

  // 4. persist inbound
  await appendMessage({
    conversationId: conv.id,
    leadId: lead.id,
    direction: "INBOUND",
    kind,
    channel: "WHATSAPP",
    body,
    mediaUrl,
    provider: msg.provider,
    providerMessageId: msg.providerMessageId,
    status: "RECEIVED",
  });
  void markRead(msg.providerMessageId);

  // 5. opt-out wins over everything
  if (detectOptOut(body)) {
    await optOutLead(lead.id, "inbound opt-out", "whatsapp");
    await sendOutbound({
      lead,
      channel: "WHATSAPP",
      kind: "TEXT",
      text: "Perfeito, não te envio mais mensagens. Se um dia quiser retomar é só chamar. Abraço!",
    }).catch(() => undefined);
    return { status: "opted_out", leadId: lead.id, conversationId: conv.id };
  }

  // 6. human owns the conversation → don't auto-reply
  if (conv.handledBy === "HUMAN") {
    await prisma.salesLeadEvent.create({
      data: { leadId: lead.id, kind: "human_inbound", data: { conversationId: conv.id } },
    });
    return { status: "queued_human", leadId: lead.id, conversationId: conv.id };
  }

  // 7. AI turn
  const cfg = await getActiveAgentConfig();
  const turn = await runAgentTurn({
    conversationId: conv.id,
    lead,
    inboundText: body,
    locale: cfg.defaultLocale,
    config: cfg,
  });

  // 8. qualify
  try {
    const recent = await prisma.salesMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
      take: 40,
    });
    const transcript = recent
      .map((m) => `${m.direction === "INBOUND" ? "LEAD" : "SDR"}: ${m.body}`)
      .join("\n");
    const q = await qualifyFromTranscript(transcript, cfg);
    await applyQualification(lead.id, q);
    if (q.tier === "QUENTE" || turn.wantsHandoff || q.signals.wantsHuman) {
      await raiseHandoffAlert(
        lead,
        conv,
        turn.wantsHandoff ? "agent_flagged" : `qualified_${q.tier}`,
      );
      // still send the AI's closing line, then a human takes over
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message, leadId: lead.id }, "sdr.inbound.qualify_failed");
  }

  if (turn.wantsStop) {
    await optOutLead(lead.id, "agent detected stop intent", "whatsapp");
  }

  // 9. reply (respect replyMode; mirror inbound modality on MIXED)
  const replyKind: "TEXT" | "AUDIO" =
    cfg.replyMode === "AUDIO"
      ? "AUDIO"
      : cfg.replyMode === "MIXED" && kind === "AUDIO"
        ? "AUDIO"
        : "TEXT";

  const out = await sendOutbound({
    lead,
    channel: "WHATSAPP",
    kind: replyKind,
    text: turn.reply,
  });

  await prisma.salesMessage.updateMany({
    where: { id: out.messageId ?? "" },
    data: { tokensIn: turn.tokensIn, tokensOut: turn.tokensOut, costMicroUsd: turn.costMicroUsd },
  });

  if (lead.status === "NOVO" || lead.status === "ABORDADO") {
    await setLeadStatus(lead.id, "CONVERSANDO", null, { via: "inbound_reply" });
  }

  return {
    status: turn.wantsHandoff ? "handed_off" : "replied",
    leadId: lead.id,
    conversationId: conv.id,
  };
}
