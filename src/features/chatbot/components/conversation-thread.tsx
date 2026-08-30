"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import {
  takeOverAction,
  returnToAiAction,
  staffReplyAction,
  type StaffChatState,
} from "../actions";
import type { ChatMessageView } from "../types";

const initial: StaffChatState = { ok: false };

export function ConversationThread({
  conversationId,
  locale,
  status,
  handledBy,
  canHandle,
  messages,
}: {
  conversationId: string;
  locale: string;
  status: string;
  handledBy: string;
  canHandle: boolean;
  messages: ChatMessageView[];
}) {
  const t = useTranslations("conversations");
  const router = useRouter();
  const [showTools, setShowTools] = useState(false);
  const [replyState, replyForm, replying] = useActionState(staffReplyAction, initial);
  const boxRef = useRef<HTMLDivElement>(null);
  const df = new Intl.DateTimeFormat(locale, { timeStyle: "short", dateStyle: "short" });

  useEffect(() => {
    if (replyState.ok) router.refresh();
  }, [replyState, router]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [messages]);

  const shown = messages.filter((m) => showTools || m.role !== "tool");
  const humanHandling = handledBy === "HUMAN";

  return (
    <div className="space-y-3">
      {canHandle && (
        <div className="flex flex-wrap items-center gap-2">
          {!humanHandling ? (
            <form action={takeOverAction}>
              <input type="hidden" name="id" value={conversationId} />
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" size="sm">
                {t("takeOver")}
              </Button>
            </form>
          ) : (
            <form action={returnToAiAction}>
              <input type="hidden" name="id" value={conversationId} />
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" size="sm" variant="outline">
                {t("returnToAi")}
              </Button>
            </form>
          )}
          {status === "PENDING_HUMAN" && !humanHandling && (
            <span className="text-xs text-amber-700">{t("waitingHuman")}</span>
          )}
          <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showTools}
              onChange={(e) => setShowTools(e.target.checked)}
            />
            {t("showTools")}
          </label>
        </div>
      )}

      <div ref={boxRef} className="max-h-[26rem] space-y-2 overflow-y-auto rounded-lg border p-3">
        {shown.map((m) => (
          <div key={m.id} className="text-sm">
            <div
              className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 ${bubble(m.role)}`}
            >
              {m.role === "tool" ? (
                <code className="text-xs">
                  {m.toolName}: {m.content.slice(0, 500)}
                </code>
              ) : (
                m.content
              )}
            </div>
            <span className="ml-2 text-[10px] text-muted-foreground">
              {roleLabel(t, m.role)} · {df.format(new Date(m.createdAt))}
            </span>
          </div>
        ))}
      </div>

      {canHandle && humanHandling && (
        <form action={replyForm} className="space-y-2">
          <input type="hidden" name="id" value={conversationId} />
          <Textarea
            name="text"
            required
            maxLength={2000}
            rows={3}
            placeholder={t("replyPlaceholder")}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={replying}>
              {t("sendReply")}
            </Button>
            {replyState.code === "failed" && (
              <Alert variant="destructive" className="text-xs">
                {t("replyFailed")}
              </Alert>
            )}
          </div>
        </form>
      )}
      {canHandle && !humanHandling && (
        <p className="text-xs text-muted-foreground">{t("takeOverToReply")}</p>
      )}
    </div>
  );
}

function bubble(role: string): string {
  if (role === "customer") return "bg-primary text-primary-foreground";
  if (role === "assistant") return "bg-muted";
  if (role === "agent") return "bg-emerald-100 text-emerald-900";
  return "bg-amber-50 text-amber-900";
}
function roleLabel(t: ReturnType<typeof useTranslations>, role: string): string {
  const k = `role.${role}`;
  return t.has(k) ? t(k) : role;
}
