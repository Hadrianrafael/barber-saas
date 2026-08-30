"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startChatAction, sendChatAction, pollChatAction, type ChatState } from "../actions";
import type { ChatMessageView } from "../types";

const initial: ChatState = { ok: false };

/** Floating web-chat launcher for the public barbershop page. */
export function ChatWidget({ slug }: { slug: string }) {
  const t = useTranslations("chatbot");
  const uiLocale = useLocale();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<{ conversationId: string; sessionToken: string } | null>(
    null,
  );
  const [botName, setBotName] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [starting, setStarting] = useState(false);
  const storeKey = `chat:${slug}`;

  const [sendState, sendForm, sending] = useActionState(sendChatAction, initial);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore a prior session for this shop.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) setSession(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [storeKey]);

  async function ensureStarted() {
    if (session || starting) return;
    setStarting(true);
    const r = await startChatAction(slug, uiLocale);
    setStarting(false);
    if (!r.ok || !r.conversationId || !r.sessionToken) return;
    const s = { conversationId: r.conversationId, sessionToken: r.sessionToken };
    setSession(s);
    setBotName(r.botName ?? "");
    setAiEnabled(r.aiEnabled ?? false);
    setMessages(r.messages ?? []);
    try {
      localStorage.setItem(storeKey, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (open) void ensureStarted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Merge action results (customer echo + assistant/tool rows).
  useEffect(() => {
    if (sendState.ok && sendState.messages?.length) {
      setMessages((prev) => dedupe([...prev, ...sendState.messages!]));
      inputRef.current?.focus();
    }
  }, [sendState]);

  // Poll for staff replies while a human is handling the thread.
  useEffect(() => {
    if (!open || !session) return;
    const id = setInterval(async () => {
      const r = await pollChatAction(session.conversationId, session.sessionToken);
      if (r.ok && r.messages) setMessages((prev) => dedupe(mergeVisible(prev, r.messages!)));
    }, 5000);
    return () => clearInterval(id);
  }, [open, session]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const visible = messages.filter(
    (m) => m.role === "customer" || m.role === "assistant" || m.role === "agent",
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-40 rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-lg"
      >
        {open ? t("close") : t("launcher")}
      </button>

      {open && (
        <div className="fixed bottom-20 right-4 z-40 flex h-[28rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
          <div className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">
            {botName || t("title")}
            {!aiEnabled && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t("humanMode")}
              </span>
            )}
          </div>

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {visible.map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "customer" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {m.content}
              </div>
            ))}
            {(sending || starting) && (
              <p className="text-xs text-muted-foreground">{t("thinking")}</p>
            )}
          </div>

          {session && (
            <form
              action={sendForm}
              className="flex gap-2 border-t p-2"
              onSubmit={() => {
                requestAnimationFrame(() => {
                  const f = inputRef.current?.form;
                  f?.reset();
                });
              }}
            >
              <input type="hidden" name="conversationId" value={session.conversationId} />
              <input type="hidden" name="sessionToken" value={session.sessionToken} />
              <Input
                ref={inputRef}
                name="text"
                autoComplete="off"
                required
                maxLength={2000}
                placeholder={t("placeholder")}
              />
              <Button type="submit" size="sm" disabled={sending}>
                {t("send")}
              </Button>
            </form>
          )}
          {sendState.code === "rateLimited" && (
            <p className="px-3 pb-2 text-xs text-destructive">{t("rateLimited")}</p>
          )}
        </div>
      )}
    </>
  );
}

function dedupe(rows: ChatMessageView[]): ChatMessageView[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = r.id === "greeting" ? "greeting" : r.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Keep local optimistic rows, add any server rows we don't have yet. */
function mergeVisible(local: ChatMessageView[], server: ChatMessageView[]): ChatMessageView[] {
  const ids = new Set(local.map((m) => m.id));
  return [...local, ...server.filter((m) => !ids.has(m.id))];
}
