import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/server/auth/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLead } from "@/features/sdr/leads";
import { LEAD_STATUSES } from "@/features/sdr/schema";
import {
  updateLeadAction,
  setLeadStatusAction,
  optOutLeadAction,
  recordConsentAction,
  eraseLeadAction,
} from "@/features/sdr/actions";
import { SalesNav } from "../../nav";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();
  const df = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <SalesNav active="/admin/sales/leads" />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{lead.barbershopName || lead.name || "Lead"}</h1>
        <span className="rounded-full border px-3 py-1 text-xs">
          {lead.status} · {lead.qualification ?? "sem qualificação"} · score {lead.score}
        </span>
      </div>

      {lead.optOutAt && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Lead em OPT-OUT desde {df.format(lead.optOutAt)} — não será mais contatado.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Dados</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateLeadAction} className="space-y-2 text-sm">
              <input type="hidden" name="id" value={lead.id} />
              {(
                [
                  ["name", "Contato"],
                  ["barbershopName", "Barbearia"],
                  ["whatsapp", "WhatsApp"],
                  ["phone", "Telefone"],
                  ["email", "E-mail"],
                  ["city", "Cidade"],
                  ["state", "UF"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <span className="w-24 text-muted-foreground">{label}</span>
                  <input
                    name={k}
                    defaultValue={(lead[k] as string | null) ?? ""}
                    className="h-8 flex-1 rounded-md border px-2"
                  />
                </label>
              ))}
              <label className="flex items-start gap-2">
                <span className="w-24 text-muted-foreground">Notas</span>
                <textarea
                  name="notes"
                  defaultValue={lead.notes ?? ""}
                  rows={3}
                  className="flex-1 rounded-md border px-2 py-1"
                />
              </label>
              <button className="rounded-md bg-foreground px-3 py-1.5 text-background">Salvar</button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={setLeadStatusAction} className="flex gap-2 text-sm">
                <input type="hidden" name="id" value={lead.id} />
                <select name="status" defaultValue={lead.status} className="h-8 flex-1 rounded-md border px-2">
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button className="rounded-md border px-3">Aplicar</button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Base legal de contato (LGPD)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">
                Atual: {lead.consentBasis ?? "nenhuma"} — obrigatória antes de contatar em PRODUÇÃO.
              </p>
              <form action={recordConsentAction} className="space-y-2 text-sm">
                <input type="hidden" name="id" value={lead.id} />
                <select name="basis" className="h-8 w-full rounded-md border px-2">
                  <option value="LEGITIMATE_INTEREST">Interesse legítimo</option>
                  <option value="OPT_IN">Opt-in explícito</option>
                  <option value="EXISTING_RELATIONSHIP">Relação existente</option>
                </select>
                <input name="note" placeholder="observação" className="h-8 w-full rounded-md border px-2" />
                <button className="rounded-md border px-3 py-1">Registrar base</button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-red-700">Zona de risco</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <form action={optOutLeadAction}>
                <input type="hidden" name="id" value={lead.id} />
                <input type="hidden" name="reason" value="admin" />
                <button className="rounded-md border border-amber-300 px-3 py-1 text-sm text-amber-800">
                  Marcar opt-out (não contatar mais)
                </button>
              </form>
              <form action={eraseLeadAction}>
                <input type="hidden" name="id" value={lead.id} />
                <button className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700">
                  Apagar lead (LGPD, irreversível)
                </button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      {lead.conversations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Conversas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {lead.conversations.map((c) => (
              <Link
                key={c.id}
                href={`/admin/sales/inbox/${c.id}`}
                className="block underline"
              >
                {c.channel} · {c.status} · {c.handledBy} ·{" "}
                {c.lastMessageAt ? df.format(c.lastMessageAt) : "—"}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {lead.events.map((e) => (
              <li key={e.id}>
                {df.format(e.createdAt)} — <span className="font-medium">{e.kind}</span>{" "}
                {e.data ? JSON.stringify(e.data) : ""}
              </li>
            ))}
            {!lead.events.length && <li>Sem eventos.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
