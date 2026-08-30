"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { requireTenantContext } from "@/server/rbac/guard";
import {
  startWebConversation,
  postWebCustomerMessage,
  getWebConversation,
  takeOverConversation,
  returnConversationToAi,
  postStaffReply,
} from "./service";
import type { ChatMessageView } from "./types";

async function ip(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export interface ChatState {
  ok: boolean;
  code?: string;
  conversationId?: string;
  sessionToken?: string;
  botName?: string;
  aiEnabled?: boolean;
  messages?: ChatMessageView[];
}

export async function startChatAction(slug: string, uiLocale: string): Promise<ChatState> {
  if (!(await rateLimit(`chat:start:${await ip()}`, 20, 300)).ok)
    return { ok: false, code: "rateLimited" };
  const r = await startWebConversation(slug, uiLocale);
  if (!r) return { ok: false, code: "notFound" };
  return {
    ok: true,
    conversationId: r.conversationId,
    sessionToken: r.sessionToken,
    botName: r.botName,
    aiEnabled: r.aiEnabled,
    messages: [
      {
        id: "greeting",
        role: "assistant",
        content: r.greeting,
        createdAt: new Date(0).toISOString(),
      },
    ],
  };
}

const sendSchema = z.object({
  conversationId: z.string().min(1),
  sessionToken: z.string().min(10),
  text: z.string().trim().min(1).max(2000),
});

export async function sendChatAction(_prev: ChatState, fd: FormData): Promise<ChatState> {
  if (!(await rateLimit(`chat:send:${await ip()}`, 30, 120)).ok)
    return { ok: false, code: "rateLimited" };
  const parsed = sendSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, code: "invalid" };
  const r = await postWebCustomerMessage(
    parsed.data.conversationId,
    parsed.data.sessionToken,
    parsed.data.text,
  );
  return { ok: r.ok, code: r.code, messages: r.messages };
}

export async function pollChatAction(
  conversationId: string,
  sessionToken: string,
): Promise<ChatState> {
  const r = await getWebConversation(conversationId, sessionToken);
  if (!r) return { ok: false, code: "notFound" };
  return { ok: true, messages: r.messages };
}

// ---- staff ----------------------------------------------------------------

export interface StaffChatState {
  ok: boolean;
  code?: string;
}

export async function takeOverAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "conversation.handle" });
  const id = String(fd.get("id") ?? "");
  if (id) await takeOverConversation(ctx.tenantId, id, ctx.session.userId);
}

export async function returnToAiAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "conversation.handle" });
  const id = String(fd.get("id") ?? "");
  if (id) await returnConversationToAi(ctx.tenantId, id);
}

export async function staffReplyAction(
  _prev: StaffChatState,
  fd: FormData,
): Promise<StaffChatState> {
  const ctx = await requireTenantContext({ permission: "conversation.handle" });
  const id = String(fd.get("id") ?? "");
  const text = String(fd.get("text") ?? "");
  if (!id || !text.trim()) return { ok: false, code: "invalid" };
  const ok = await postStaffReply(ctx.tenantId, id, ctx.session.userId, text);
  return { ok, code: ok ? "sent" : "failed" };
}
