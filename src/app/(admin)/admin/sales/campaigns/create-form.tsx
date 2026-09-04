"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createCampaignAction, type SdrState } from "@/features/sdr/actions";

const INITIAL: SdrState = { ok: false };

export function CreateCampaignForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: SdrState, fd: FormData) => {
    const res = await createCampaignAction(prev, fd);
    if (res.ok && res.data?.id) router.push(`/admin/sales/campaigns/${res.data.id}`);
    return res;
  }, INITIAL);

  return (
    <form action={action} className="grid gap-3 text-sm sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Nome</span>
        <input name="name" required className="h-8 rounded-md border px-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Canal</span>
        <select name="channel" className="h-8 rounded-md border px-2">
          <option value="WHATSAPP">WhatsApp</option>
          <option value="EMAIL">E-mail</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Primeiro contato</span>
        <select name="firstTouch" className="h-8 rounded-md border px-2">
          <option value="AUDIO">Áudio</option>
          <option value="TEXT">Texto</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Idioma</span>
        <select name="locale" className="h-8 rounded-md border px-2">
          <option value="pt-BR">pt-BR</option>
          <option value="en">en</option>
          <option value="es">es</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Limite por dia</span>
        <input
          name="dailyCap"
          type="number"
          defaultValue={30}
          min={1}
          max={500}
          className="h-8 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Intervalo mínimo (seg)</span>
        <input
          name="minIntervalSec"
          type="number"
          defaultValue={180}
          min={20}
          className="h-8 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Jitter (%)</span>
        <input
          name="jitterPct"
          type="number"
          defaultValue={40}
          min={0}
          max={80}
          className="h-8 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Fuso</span>
        <input
          name="timezone"
          defaultValue="America/Sao_Paulo"
          className="h-8 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Janela início (min do dia)</span>
        <input
          name="windowStartMin"
          type="number"
          defaultValue={540}
          className="h-8 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Janela fim (min do dia)</span>
        <input
          name="windowEndMin"
          type="number"
          defaultValue={1140}
          className="h-8 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-muted-foreground">Dias (0=Dom … 6=Sáb)</span>
        <input name="sendDays" defaultValue="1,2,3,4,5" className="h-8 rounded-md border px-2" />
      </label>

      {!state.ok && state.message && <p className="text-red-700 sm:col-span-2">{state.message}</p>}
      <div className="sm:col-span-2">
        <button
          disabled={pending}
          className="rounded-md bg-foreground px-4 py-2 text-background disabled:opacity-50"
        >
          {pending ? "Criando…" : "Criar campanha (rascunho, modo teste)"}
        </button>
      </div>
    </form>
  );
}
