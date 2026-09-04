import { requireAdminSession } from "@/server/auth/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveAgentConfig, listAgentConfigs, DEFAULTS } from "@/features/sdr/agent-config";
import { activateAgentConfigAction } from "@/features/sdr/actions";
import { SalesNav } from "../nav";
import { AgentConfigForm } from "./config-form";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  await requireAdminSession();
  const [active, all] = await Promise.all([getActiveAgentConfig(), listAgentConfigs()]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <SalesNav active="/admin/sales/assistant" />
      <h1 className="text-xl font-semibold">Assistente de Vendas</h1>
      <p className="text-sm text-muted-foreground">
        A IA só usa fatos da base de conhecimento — nunca inventa preço, recurso ou condição
        comercial. Deixe o preço como &quot;consultar no painel&quot; e direcione para a
        demonstração.
      </p>

      {all.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Perfis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {all.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <span>
                  {c.name} {c.isActive && <span className="text-emerald-700">(ativo)</span>}
                </span>
                {!c.isActive && (
                  <form action={activateAgentConfigAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="rounded-md border px-2 py-1 text-xs">Ativar</button>
                  </form>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Configuração ativa</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentConfigForm
            config={{
              id: active.id,
              name: active.name,
              assistantName: active.assistantName,
              companyName: active.companyName,
              replyMode: active.replyMode,
              defaultLocale: active.defaultLocale,
              content: JSON.stringify(active.content ?? DEFAULTS.pt, null, 2),
              knowledge: JSON.stringify(active.knowledge ?? DEFAULTS.knowledge, null, 2),
              qualificationRules: JSON.stringify(active.qualificationRules ?? {}, null, 2),
              systemPromptOverride: active.systemPromptOverride ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
