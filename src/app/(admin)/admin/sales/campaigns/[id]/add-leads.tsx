"use client";

import { useActionState } from "react";
import { addLeadsAction, type SdrState } from "@/features/sdr/actions";

const INITIAL: SdrState = { ok: false };

export function AddLeadsForm({ campaignId }: { campaignId: string }) {
  const [state, action, pending] = useActionState(addLeadsAction, INITIAL);
  return (
    <form action={action} className="space-y-2 text-sm">
      <input type="hidden" name="campaignId" value={campaignId} />
      <textarea
        name="leadIds"
        rows={3}
        placeholder="IDs de leads separados por vírgula (copie da lista de Leads)"
        className="w-full rounded-md border px-2 py-1 font-mono text-xs"
      />
      <button disabled={pending} className="rounded-md border px-3 py-1.5 disabled:opacity-50">
        {pending ? "Adicionando…" : "Adicionar"}
      </button>
      {state.ok && state.data ? (
        <span className="ml-2 text-emerald-700">{String(state.data.added)} adicionados</span>
      ) : null}
      {!state.ok && state.code === "invalid" ? (
        <span className="ml-2 text-red-700">informe ao menos um ID</span>
      ) : null}
    </form>
  );
}
