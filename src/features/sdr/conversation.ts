import "server-only";
import type {
  SalesConversation,
  SalesMessage,
  SalesChannel,
  SalesMsgDirection,
  SalesMsgKind,
} from "@prisma/client";
import { prisma } from "@/server/db/client";
import { chat, type ChatMessage } from "@/server/ai/openai";
import { isConfigured } from "@/env";
import { logger } from "@/lib/logger";

/** Keep only the last N turns in-context; older ones get folded into a summary. */
const RECENT_TURNS = 12;
const SUMMARY_TRIGGER = 20;

export function renderTemplate(str: string, vars: Record<string, string | undefined>): string {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

export async function getOrCreateConversation(args: {
  leadId: string;
  channel: SalesChannel;
  externalId?: string | null;
}): Promise<SalesConversation> {
  const existing = await prisma.salesConversation.findFirst({
    where: { leadId: args.leadId, channel: args.channel, status: { not: "CLOSED" } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    if (args.externalId && existing.externalId !== args.externalId) {
      return prisma.salesConversation.update({
        where: { id: existing.id },
        data: { externalId: args.externalId },
      });
    }
    return existing;
  }
  return prisma.salesConversation.create({
    data: { leadId: args.leadId, channel: args.channel, externalId: args.externalId ?? null },
  });
}

export async function appendMessage(args: {
  conversationId: string;
  leadId: string;
  campaignId?: string | null;
  direction: SalesMsgDirection;
  kind?: SalesMsgKind;
  channel: SalesChannel;
  body: string;
  mediaUrl?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  status?: SalesMessage["status"];
  tokensIn?: number;
  tokensOut?: number;
  costMicroUsd?: number;
}): Promise<SalesMessage> {
  const msg = await prisma.salesMessage.create({
    data: {
      conversationId: args.conversationId,
      leadId: args.leadId,
      campaignId: args.campaignId ?? null,
      direction: args.direction,
      kind: args.kind ?? "TEXT",
      channel: args.channel,
      body: args.body.slice(0, 8000),
      mediaUrl: args.mediaUrl ?? null,
      provider: args.provider ?? null,
      providerMessageId: args.providerMessageId ?? null,
      status: args.status ?? (args.direction === "INBOUND" ? "RECEIVED" : "QUEUED"),
      tokensIn: args.tokensIn ?? 0,
      tokensOut: args.tokensOut ?? 0,
      costMicroUsd: args.costMicroUsd ?? 0,
    },
  });
  await prisma.salesConversation.update({
    where: { id: args.conversationId },
    data: { lastMessageAt: new Date() },
  });
  await prisma.salesLead.update({
    where: { id: args.leadId },
    data:
      args.direction === "INBOUND" ? { lastReplyAt: new Date() } : { lastContactedAt: new Date() },
  });
  return msg;
}

/** Build the OpenAI message array from stored history, windowed + summarised. */
export async function buildModelContext(
  conversationId: string,
  systemPrompt: string,
): Promise<ChatMessage[]> {
  const conv = await prisma.salesConversation.findUniqueOrThrow({ where: { id: conversationId } });
  const all = await prisma.salesMessage.findMany({
    where: { conversationId, direction: { in: ["INBOUND", "OUTBOUND"] } },
    orderBy: { createdAt: "asc" },
  });

  let summary = conv.contextSummary ?? "";
  let recent = all;

  if (all.length > SUMMARY_TRIGGER && isConfigured.openai) {
    const older = all.slice(0, all.length - RECENT_TURNS);
    recent = all.slice(-RECENT_TURNS);
    try {
      const res = await chat({
        model: undefined,
        temperature: 0.2,
        maxTokens: 220,
        messages: [
          {
            role: "system",
            content:
              "Resuma o histórico desta conversa de vendas em até 6 linhas: quem é o lead, o que já foi dito, objeções, interesse e próximo passo. Sem preâmbulo.",
          },
          {
            role: "user",
            content: older
              .map((m) => `${m.direction === "INBOUND" ? "LEAD" : "SDR"}: ${m.body}`)
              .join("\n"),
          },
        ],
      });
      summary = res.text || summary;
      await prisma.salesConversation.update({
        where: { id: conversationId },
        data: { contextSummary: summary },
      });
    } catch (e) {
      logger.warn({ err: (e as Error).message, conversationId }, "sdr.context.summarise_failed");
      recent = all.slice(-RECENT_TURNS);
    }
  } else if (all.length > RECENT_TURNS) {
    recent = all.slice(-RECENT_TURNS);
  }

  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  if (summary) messages.push({ role: "system", content: `Resumo até aqui:\n${summary}` });
  for (const m of recent) {
    messages.push({
      role: m.direction === "INBOUND" ? "user" : "assistant",
      content: m.body,
    });
  }
  return messages;
}
