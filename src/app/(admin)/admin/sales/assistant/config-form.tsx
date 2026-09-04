"use client";

import { useActionState } from "react";
import { saveAgentConfigAction, type SdrState } from "@/features/sdr/actions";

const INITIAL: SdrState = { ok: false };

type Cfg = {
  id: string;
  name: string;
  assistantName: string;
  companyName: string;
  replyMode: string;
  defaultLocale: string;
  content: string;
  knowledge: string;
  qualificationRules: string;
  systemPromptOverride: string;
};

export function AgentConfigForm({ config }: { config: Cfg }) {
  const [state, action, pending] = useActionState(saveAgentConfigAction, INITIAL);

  return (
    <form action={action} className="space-y-3 text-sm">
      <input type="hidden" name="id" value={config.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Nome do perfil</span>
          <input name="name" defaultValue={config.name} className="h-8 rounded-md border px-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Nome do assistente</span>
          <input
            name="assistantName"
            defaultValue={config.assistantName}
            className="h-8 rounded-md border px-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Empresa</span>
          <input
            name="companyName"
            defaultValue={config.companyName}
            className="h-8 rounded-md border px-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Modo de resposta</span>
          <select
            name="replyMode"
            defaultValue={config.replyMode}
            className="h-8 rounded-md border px-2"
          >
            <option value="MIXED">Misto (espelha o lead)</option>
            <option value="TEXT">Só texto</option>
            <option value="AUDIO">Só áudio</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Idioma padrão</span>
          <select
            name="defaultLocale"
            defaultValue={config.defaultLocale}
            className="h-8 rounded-md border px-2"
          >
            <option value="pt-BR">pt-BR</option>
            <option value="en">en</option>
            <option value="es">es</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">
          Conteúdo por idioma (JSON) — tom, persona, saudação, intro, pitch, CTA, perguntas,
          objeções, follow-ups
        </span>
        <textarea
          name="content"
          defaultValue={config.content}
          rows={14}
          className="rounded-md border p-2 font-mono text-xs"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">
          Base de conhecimento (JSON) — resumo do produto, recursos, planos, diferenciais, FAQ
        </span>
        <textarea
          name="knowledge"
          defaultValue={config.knowledge}
          rows={12}
          className="rounded-md border p-2 font-mono text-xs"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">
          Regras de qualificação (JSON) — hotThreshold, warmThreshold, askAbout
        </span>
        <textarea
          name="qualificationRules"
          defaultValue={config.qualificationRules}
          rows={6}
          className="rounded-md border p-2 font-mono text-xs"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">
          Prompt de sistema (opcional — sobrepõe o padrão)
        </span>
        <textarea
          name="systemPromptOverride"
          defaultValue={config.systemPromptOverride}
          rows={4}
          className="rounded-md border p-2 font-mono text-xs"
        />
      </label>

      {state.ok && <p className="text-emerald-700">Salvo.</p>}
      {!state.ok && state.message && <p className="text-red-700">{state.message}</p>}

      <button
        disabled={pending}
        className="rounded-md bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Salvar configuração"}
      </button>
    </form>
  );
}
