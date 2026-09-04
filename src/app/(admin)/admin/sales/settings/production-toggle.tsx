"use client";

import { useState, useTransition } from "react";
import { toggleProductionAction, type SdrState } from "@/features/sdr/actions";

export function ProductionToggle({ testMode }: { testMode: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function toggle(enable: boolean) {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("enable", String(enable));
      const res: SdrState = await toggleProductionAction(fd);
      setConfirming(false);
      if (!res.ok) setMsg(res.message || "Não foi possível ativar a produção.");
      else setMsg(res.code === "production_on" ? "Produção ativada." : "Voltou para modo de teste.");
    });
  }

  if (!testMode) {
    return (
      <div className="space-y-2">
        <button
          onClick={() => toggle(false)}
          disabled={pending}
          className="rounded-md border border-amber-300 px-3 py-1.5 text-amber-800 disabled:opacity-50"
        >
          Voltar para modo de teste
        </button>
        {msg && <p className="text-emerald-700">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="rounded-md border border-emerald-300 px-3 py-1.5 text-emerald-800"
        >
          Ativar produção
        </button>
      ) : (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3">
          <p className="mb-2 text-emerald-900">
            Isso libera envios reais para leads com base legal registrada. Confirma?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => toggle(true)}
              disabled={pending}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50"
            >
              {pending ? "Ativando…" : "Sim, ativar produção"}
            </button>
            <button onClick={() => setConfirming(false)} className="rounded-md border px-3 py-1.5">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-red-700">{msg}</p>}
    </div>
  );
}
