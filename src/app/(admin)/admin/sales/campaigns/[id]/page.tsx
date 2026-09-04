import { notFound } from "next/navigation";
import { requireAdminSession } from "@/server/auth/current-user";
import { prisma } from "@/server/db/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCampaign } from "@/features/sdr/campaigns";
import { campaignControlAction, removeLeadAction } from "@/features/sdr/actions";
import { SalesNav } from "../../nav";
import { AddLeadsForm } from "./add-leads";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) notFound();

  const links = await prisma.salesCampaignLead.findMany({
    where: { campaignId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      lead: { select: { barbershopName: true, name: true, whatsapp: true, status: true } },
    },
  });
  const counts = links.reduce<Record<string, number>>((a, l) => {
    a[l.state] = (a[l.state] ?? 0) + 1;
    return a;
  }, {});

  const ctl = (op: string, label: string, danger = false) => (
    <form action={campaignControlAction}>
      <input type="hidden" name="id" value={c.id} />
      <input type="hidden" name="op" value={op} />
      <button
        className={`rounded-md border px-3 py-1.5 text-sm ${danger ? "border-amber-300 text-amber-800" : ""}`}
      >
        {label}
      </button>
    </form>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <SalesNav active="/admin/sales/campaigns" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{c.name}</h1>
        <span className="rounded-full border px-3 py-1 text-xs">
          {c.status} · modo {c.mode} · {c.channel} · {c.firstTouch}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {c.status !== "RUNNING" && ctl("start", "Iniciar")}
        {c.status === "RUNNING" && ctl("pause", "Pausar", true)}
        {c.status === "PAUSED" && ctl("resume", "Retomar")}
        {c.mode === "TEST"
          ? ctl("mode-prod", "Mudar p/ PRODUÇÃO", true)
          : ctl("mode-test", "Voltar p/ TESTE")}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Ritmo</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Até <strong>{c.dailyCap}</strong>/dia · intervalo mín <strong>{c.minIntervalSec}s</strong>{" "}
          ± {c.jitterPct}% · janela {Math.floor(c.windowStartMin / 60)}h–
          {Math.floor(c.windowEndMin / 60)}h ({c.timezone}) · dias {c.sendDays.join(", ")} ·
          enviadas {c.sentCount} · falhas {c.failedCount}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Adicionar leads</CardTitle>
        </CardHeader>
        <CardContent>
          <AddLeadsForm campaignId={c.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Leads da campanha ({links.length}
            {links.length === 200 ? "+" : ""}) —{" "}
            {Object.entries(counts)
              .map(([k, v]) => `${v} ${k}`)
              .join(" · ")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-2">Barbearia</th>
                <th className="p-2">WhatsApp</th>
                <th className="p-2">Estado</th>
                <th className="p-2">Motivo</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="p-2">{l.lead.barbershopName || l.lead.name || "—"}</td>
                  <td className="p-2 text-muted-foreground">{l.lead.whatsapp || "—"}</td>
                  <td className="p-2">{l.state}</td>
                  <td className="p-2 text-muted-foreground">{l.skippedReason ?? ""}</td>
                  <td className="p-2 text-right">
                    {l.state === "PENDING" && (
                      <form action={removeLeadAction}>
                        <input type="hidden" name="campaignId" value={c.id} />
                        <input type="hidden" name="leadId" value={l.leadId} />
                        <button className="text-red-600 underline">remover</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
