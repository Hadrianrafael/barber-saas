import "server-only";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { generateToken, hashToken } from "@/lib/crypto";
import { isConfigured } from "@/env";
import { parseChatbotConfig, greetingFor } from "./config";
import { detectLocale } from "./language";
import { runAgentTurn } from "./agent";
import type { ChatToolContext } from "./tools";
import type { ChatMessageView } from "./types";

const MAX_MSG_LEN = 2000;
const HISTORY_LIMIT = 40;

function view(m: {
  id: string;
  role: string;
  content: string;
  toolName: string | null;
  createdAt: Date;
}): ChatMessageView {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    toolName: m.toolName,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Start (or resume) a web-chat conversation. Returns an opaque session token. */
export async function startWebConversation(slug: string, uiLocale: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, name: true, status: true, chatbotConfig: true },
  });
  if (!tenant || tenant.status === "SUSPENDED" || tenant.status === "CANCELED") return null;

  const cfg = parseChatbotConfig(tenant.chatbotConfig);
  const rawToken = generateToken(24);
  const conv = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      channel: "WEBCHAT",
      status: "OPEN",
      handledBy: "AI",
      locale: uiLocale,
      externalId: hashToken(rawToken),
    },
    select: { id: true },
  });

  const greeting = greetingFor(cfg, uiLocale);
  await prisma.conversationMessage.create({
    data: { conversationId: conv.id, role: "assistant", content: greeting },
  });

  return {
    conversationId: conv.id,
    sessionToken: rawToken,
    greeting,
    botName: cfg.displayName,
    aiEnabled: cfg.enabled && isConfigured.chatbot,
  };
}

async function authConversation(conversationId: string, sessionToken: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, externalId: hashToken(sessionToken), channel: "WEBCHAT" },
    select: {
      id: true,
      tenantId: true,
      customerId: true,
      status: true,
      handledBy: true,
      locale: true,
      tenant: { select: { name: true, timezone: true, chatbotConfig: true } },
    },
  });
  return conv;
}

/**
 * Append a customer message. If the conversation is AI-handled and the bot is
 * configured + enabled, run one agent turn and append its reply + trace.
 * Otherwise the message just waits in the human queue.
 */
export async function postWebCustomerMessage(
  conversationId: string,
  sessionToken: string,
  text: string,
): Promise<{ ok: boolean; messages?: ChatMessageView[]; code?: string }> {
  const body = text.trim().slice(0, MAX_MSG_LEN);
  if (!body) return { ok: false, code: "empty" };

  const conv = await authConversation(conversationId, sessionToken);
  if (!conv) return { ok: false, code: "not_found" };

  const cfg = parseChatbotConfig(conv.tenant.chatbotConfig);
  const detected = detectLocale(body, conv.locale);

  const customerMsg = await prisma.conversationMessage.create({
    data: { conversationId: conv.id, role: "customer", content: body },
    select: { id: true, role: true, content: true, toolName: true, createdAt: true },
  });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), locale: detected },
  });

  const aiActive = conv.handledBy === "AI" && conv.status !== "HUMAN_HANDLING";
  const botAvailable = cfg.enabled && isConfigured.chatbot;
  const hitKeyword = cfg.handoffKeywords.some((k) => body.toLowerCase().includes(k.toLowerCase()));

  if (!aiActive || !botAvailable || hitKeyword) {
    if (aiActive && (hitKeyword || !botAvailable)) {
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { status: "PENDING_HUMAN" },
      });
    }
    return { ok: true, messages: [view(customerMsg)] };
  }

  // --- run one agent turn ---
  const history = await prisma.conversationMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
    take: HISTORY_LIMIT,
    select: { role: true, content: true },
  });

  const ctx: ChatToolContext = {
    tenantId: conv.tenantId,
    conversationId: conv.id,
    locale: detected,
    customerId: conv.customerId,
  };

  const turn = await runAgentTurn({
    ctx,
    tenantName: conv.tenant.name,
    timezone: conv.tenant.timezone,
    instructions: cfg.instructions,
    history: history.slice(0, -1), // exclude the message we just added; passed separately
    userText: body,
  });

  const created: ChatMessageView[] = [view(customerMsg)];
  for (const s of turn.steps) {
    if (s.role === "tool") {
      const row = await prisma.conversationMessage.create({
        data: {
          conversationId: conv.id,
          role: "tool",
          content: s.content.slice(0, 4000),
          toolName: s.toolName,
          toolPayload: (s.toolPayload ?? undefined) as object | undefined,
        },
        select: { id: true, role: true, content: true, toolName: true, createdAt: true },
      });
      created.push(view(row)); // shown only in the staff panel, filtered client-side for customers
    }
  }
  const replyRow = await prisma.conversationMessage.create({
    data: { conversationId: conv.id, role: "assistant", content: turn.reply },
    select: { id: true, role: true, content: true, toolName: true, createdAt: true },
  });
  created.push(view(replyRow));

  await prisma.conversation.update({
    where: { id: conv.id },
    data: {
      lastMessageAt: new Date(),
      status: turn.handedOff ? "PENDING_HUMAN" : conv.status,
    },
  });

  logger.info(
    { conversationId: conv.id, steps: turn.steps.length, handedOff: turn.handedOff },
    "chatbot.turn",
  );
  return { ok: true, messages: created };
}

/** Customer-visible history (no tool rows). */
export async function getWebConversation(conversationId: string, sessionToken: string) {
  const conv = await authConversation(conversationId, sessionToken);
  if (!conv) return null;
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId: conv.id, role: { in: ["customer", "assistant", "agent"] } },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, role: true, content: true, toolName: true, createdAt: true },
  });
  return {
    status: conv.status,
    handledBy: conv.handledBy,
    messages: rows.map(view),
  };
}

// ---------------------------------------------------------------------------
// Staff side (RBAC-guarded in actions.ts)
// ---------------------------------------------------------------------------

export async function listConversations(
  tenantId: string,
  opts: { status?: string; channel?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, opts.pageSize ?? 20);
  const where = {
    tenantId,
    ...(opts.status ? { status: opts.status as never } : {}),
    ...(opts.channel ? { channel: opts.channel as never } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        channel: true,
        status: true,
        handledBy: true,
        locale: true,
        lastMessageAt: true,
        createdAt: true,
        customer: { select: { name: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.conversation.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getConversationForStaff(tenantId: string, id: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      channel: true,
      status: true,
      handledBy: true,
      locale: true,
      assignedToId: true,
      customer: { select: { id: true, name: true, email: true, phone: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, toolName: true, createdAt: true },
      },
    },
  });
  if (!conv) return null;
  return { ...conv, messages: conv.messages.map(view) };
}

export async function takeOverConversation(tenantId: string, id: string, userId: string) {
  const r = await prisma.conversation.updateMany({
    where: { id, tenantId },
    data: { handledBy: "HUMAN", status: "HUMAN_HANDLING", assignedToId: userId },
  });
  return r.count > 0;
}

export async function returnConversationToAi(tenantId: string, id: string) {
  const r = await prisma.conversation.updateMany({
    where: { id, tenantId },
    data: { handledBy: "AI", status: "OPEN", assignedToId: null },
  });
  return r.count > 0;
}

export async function postStaffReply(
  tenantId: string,
  id: string,
  userId: string,
  text: string,
): Promise<boolean> {
  const body = text.trim().slice(0, MAX_MSG_LEN);
  if (!body) return false;
  const conv = await prisma.conversation.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!conv) return false;
  await prisma.conversationMessage.create({
    data: { conversationId: conv.id, role: "agent", content: body, toolPayload: { userId } },
  });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), handledBy: "HUMAN", status: "HUMAN_HANDLING" },
  });
  return true;
}
