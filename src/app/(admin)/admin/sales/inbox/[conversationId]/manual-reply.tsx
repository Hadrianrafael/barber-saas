"use client";

import { useActionState } from "react";
import { manualReplyAction, type SdrState } from "@/features/sdr/actions";

const INITIAL: SdrState = { ok: false };

export function ManualReply({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(manualReplyAction, INITIAL);
  return (
    <form action={action} className="space-y-2 text-sm">
      <input type="hidden" name="conversationId" value={conversationId} />
      <textarea name="text" rows={3} required className="w-full rounded-md border px-2 py-1" placeholder="Sua mensagem…" />
      <div className="flex items-center gap-2">
        <select name="kind" className="h-8 rounded-md border px-2">
          <option value="TEXT">Texto</option>
          <option value="AUDIO">Áudio (TTS)</option>
        </select>
        <button disabled={pending} className="rounded-md bg-foreground px-4 py-2 text-background disabled:opacity-50">
          {pending ? "Enviando…" : "Enviar"}
        </button>
        {state.ok && <span className="text-emerald-700">Enviada.</span>}
        {!state.ok && state.message && <span className="text-red-700">{state.message}</span>}
      </div>
    </form>
  );
}
