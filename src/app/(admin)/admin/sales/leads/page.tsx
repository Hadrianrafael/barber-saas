import Link from "next/link";
import { requireAdminSession } from "@/server/auth/current-user";
import { Card, CardContent } from "@/components/ui/card";
import { listLeads } from "@/features/sdr/leads";
import { LEAD_STATUSES } from "@/features/sdr/schema";
import { SalesNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function SalesLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; qualification?: string; page?: string }>;
}) {
  await requireAdminSession();
  const sp = await searchParams;
  const { rows, total, page, pageSize } = await listLeads({
    q: sp.q || undefined,
    status: (sp.status as (typeof LEAD_STATUSES)[number]) || undefined,
    qualification: (sp.qualification as "FRIO" | "MORNO" | "QUENTE") || undefined,
    page: Number(sp.page) || 1,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <SalesNav active="/admin/sales/leads" />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leads ({total})</h1>
        <Link href="/admin/sales/leads/import" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
          Importar CSV / XLSX
        </Link>
      </div>

      <form method="get" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="nome, barbearia, telefone, cidade…"
          className="h-9 min-w-[220px] flex-1 rounded-md border px-3 text-sm"
        />
        <select name="status" defaultValue={sp.status ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">status: todos</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          name="qualification"
          defaultValue={sp.qualification ?? ""}
          className="h-9 rounded-md border px-2 text-sm"
        >
          <option value="">qualificação: todas</option>
          {["FRIO", "MORNO", "QUENTE"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="h-9 rounded-md border px-3 text-sm" type="submit">
          Filtrar
        </button>
      </form>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-2">Barbearia / Contato</th>
                <th className="p-2">Cidade</th>
                <th className="p-2">WhatsApp</th>
                <th className="p-2">Status</th>
                <th className="p-2">Qualif.</th>
                <th className="p-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b hover:bg-muted/40">
                  <td className="p-2">
                    <Link href={`/admin/sales/leads/${l.id}`} className="font-medium underline">
                      {l.barbershopName || l.name || "(sem nome)"}
                    </Link>
                    {l.barbershopName && l.name ? (
                      <span className="text-muted-foreground"> · {l.name}</span>
                    ) : null}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {[l.city, l.state].filter(Boolean).join("/") || "—"}
                  </td>
                  <td className="p-2 text-muted-foreground">{l.whatsapp || l.phone || "—"}</td>
                  <td className="p-2">{l.status}</td>
                  <td className="p-2">{l.qualification ?? "—"}</td>
                  <td className="p-2">{l.score}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Nenhum lead. Comece importando uma planilha.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex justify-between text-sm">
          <Link
            aria-disabled={page <= 1}
            className="underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
            href={`/admin/sales/leads?q=${sp.q ?? ""}&status=${sp.status ?? ""}&qualification=${sp.qualification ?? ""}&page=${page - 1}`}
          >
            Anterior
          </Link>
          <span className="text-muted-foreground">
            {page} / {pages}
          </span>
          <Link
            aria-disabled={page >= pages}
            className="underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
            href={`/admin/sales/leads?q=${sp.q ?? ""}&status=${sp.status ?? ""}&qualification=${sp.qualification ?? ""}&page=${page + 1}`}
          >
            Próxima
          </Link>
        </div>
      )}
    </div>
  );
}
