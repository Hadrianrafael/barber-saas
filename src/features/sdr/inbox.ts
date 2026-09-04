import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { appendMessage, getOrCreateConversation } from "./conversation";
import { sendOutbound } from "./outbound";
import { setLeadStatus } from "./leads";

/**
 * Inbox: the human-facing view over SDR conversations. A human can take a
 * conversation over ("Assumir") — which pauses the AI — send manual replies, and
 * hand it back to the AI ("Devolver").
 */

const PAGE = 30;

export async function listConversations(opts: {
  handledBy?: "AI" | "HUMAN";
  status?: "OPEN" | "SNOOZED" | "CLOSED";
  qualification?: "FRIO" | "MORNO" | "QUENTE";
  page?: number;
}) {
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.SalesConversationWhereInput = {};
  if (opts.handledBy) where.handledBy = opts.handledBy;
  if (opts.status) where.status = opts.status;
  if (opts.qualification) where.lead = { qualification: opts.qualification };

  const [rows, total] = await Promise.all([
    prisma.salesConversation.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            barbershopName: true,
            city: true,
            status: true,
            qualification: true,
            score: true,
          },
        },
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.salesConversation.count({ where }),
  ]);
  return { rows, total, page, pageSize: PAGE };
}

export async function getConversation(id: string) {
  return prisma.salesConversation.findUnique({
    where: { id },
    include: {
      lead: { include: { events: { orderBy: { createdAt: "desc" }, take: 20 } } },
      messages: { orderBy: { createdAt: "asc" } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });
}

/** Human takes over — AI stops replying to this conversation. */
export async function takeOverConversation(id: string, actorId: string): Promise<void> {
  const conv = await prisma.salesConversation.update({
    where: { id },
    data: { handledBy: "HUMAN", assignedToId: actorId },
  });
  await setLeadStatus(conv.leadId, "HUMANO", actorId, { via: "inbox_takeover" });
  await prisma.salesLeadEvent.create({
    data: { leadId: conv.leadId, kind: "human_takeover", actorId, data: { conversationId: id } },
  });
}

/** Hand the conversation back to the AI. */
export async function returnConversationToAi(id: string, actorId: string): Promise<void> {
  const conv = await prisma.salesConversation.update({
    where: { id },
    data: { handledBy: "AI", assignedToId: null },
  });
  await prisma.salesLeadEvent.create({
    data: { leadId: conv.leadId, kind: "returned_to_ai", actorId, data: { conversationId: id } },
  });
}

export async function closeConversation(id: string, actorId: string): Promise<void> {
  const conv = await prisma.salesConversation.update({ where: { id }, data: { status: "CLOSED" } });
  await prisma.salesLeadEvent.create({
    data: { leadId: conv.leadId, kind: "conversation_closed", actorId, data: { conversationId: id } },
  });
}

/**
 * Manual reply from a human operator. Goes through `sendOutbound` so the guard
 * (suppression / TEST MODE / consent / cap) still applies.
 */
export async function sendManualReply(args: {
  conversationId: string;
  actorId: string;
  text: string;
  kind?: "TEXT" | "AUDIO";
}): Promise<{ ok: boolean; error?: string; blockedReason?: string }> {
  const conv = await prisma.salesConversation.findUniqueOrThrow({
    where: { id: args.conversationId },
    include: { lead: true },
  });
  const res = await sendOutbound({
    lead: conv.lead,
    channel: conv.channel === "EMAIL" ? "EMAIL" : "WHATSAPP",
    kind: args.kind ?? "TEXT",
    text: args.text,
  });
  if (res.ok) {
    await prisma.salesLeadEvent.create({
      data: {
        leadId: conv.leadId,
        kind: "manual_reply",
        actorId: args.actorId,
        data: { conversationId: args.conversationId },
      },
    });
  }
  return { ok: res.ok, error: res.error, blockedReason: res.blockedReason };
}

export { appendMessage, getOrCreateConversation };
