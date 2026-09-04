import { requireAdminSession } from "@/server/auth/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSdrMetrics } from "@/features/sdr/metrics";
import { isTestMode } from "@/features/sdr/settings";
import { voiceStatus } from "@/server/voice";
import { isConfigured } from "@/env";
import { SalesNav } from "./nav";

export const dynamic = "force-dynamic";

export default async function SalesDashboardPage() {
  await requireAdminSession();
  const [m, testMode] = await Promise.all([getSdrMetrics(30), isTestMode()]);
  const vs = voiceStatus();

  const stats = [
    { label: "Leads (total)", value: m.leads.total },
    { label: "Importados", value: m.leads.imported },
    { label: "Novos", value: m.leads.byStatus["NOVO"] ?? 0 },
    { label: "Conversando", value: m.leads.byStatus["CONVERSANDO"] ?? 0 },
    { label: "Interessados", value: m.leads.byStatus["INTERESSADO"] ?? 0 },
    { label: "Demonstração", value: m.leads.byStatus["DEMONSTRACAO"] ?? 0 },
    { label: "Para humano", value: m.leads.byStatus["HUMANO"] ?? 0 },
    { label: "Opt-out", value: m.leads.optOut },
    { label: "Quentes", value: m.leads.byQualification["QUENTE"] ?? 0 },
    { label: "Mornos", value: m.leads.byQualification["MORNO"] ?? 0 },
    { label: "Frios", value: m.leads.byQualification["FRIO"] ?? 0 },
    { label: "Conversas abertas", value: m.conversations.open },
    { label: "Com humano", value: m.conversations.withHuman },
    { label: "Msgs enviadas (30d)", value: m.messages.outbound },
    { label: "Msgs recebidas (30d)", value: m.messages.inbound },
    { label: "Áudios enviados (30d)", value: m.messages.audioOut },
    { label: "Falhas (30d)", value: m.messages.failed },
    { label: "Campanhas ativas", value: m.campaigns.running },
    { label: "Custo IA estimado (30d)", value: `US$ ${m.cost.estUsd.toFixed(2)}` },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <SalesNav active="/admin/sales" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Vendas com IA (SDR)</h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            testMode ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
          }`}
        >
          {testMode ? "MODO DE TESTE — sem disparos reais" : "PRODUÇÃO ativa"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="rounded border px-2 py-1">
          OpenAI: {isConfigured.openai ? "configurado" : "não configurado"}
        </span>
        <span className="rounded border px-2 py-1">
          WhatsApp: {isConfigured.whatsapp ? "configurado" : "não configurado"}
        </span>
        <span className="rounded border px-2 py-1">
          E-mail (Resend): {isConfigured.resend ? "configurado" : "console"}
        </span>
        <span className="rounded border px-2 py-1">
          Voz: {vs.active}
          {vs.requestedProvider === "external" && !vs.externalConfigured ? " (fallback)" : ""}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
