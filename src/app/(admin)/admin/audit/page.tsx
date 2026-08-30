import Link from "next/link";
import { requireAdminSession } from "@/server/auth/current-user";
import { listPlatformAudit } from "@/features/admin/service";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  await requireAdminSession();
  const { action = "", page = "1" } = await searchParams;
  const { rows, total, pageSize } = await listPlatformAudit({
    action: action || undefined,
    page: Number(page) || 1,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const df = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Auditoria ({total})</h1>
        <Link href="/admin" className="text-sm underline">
          ← Painel
        </Link>
      </div>

      <form method="get" className="flex gap-2">
        <input
          name="action"
          defaultValue={action}
          placeholder="filtrar por ação (ex: impersonation)"
          className="h-9 flex-1 rounded-md border px-3 text-sm"
        />
        <button className="h-9 rounded-md border px-3 text-sm" type="submit">
          Filtrar
        </button>
      </form>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-2">Quando</th>
                <th className="p-2">Ação</th>
                <th className="p-2">Ator</th>
                <th className="p-2">Alvo</th>
                <th className="p-2">Tenant</th>
                <th className="p-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-2 text-muted-foreground">{df.format(r.createdAt)}</td>
                  <td className="p-2 font-medium">{r.action}</td>
                  <td className="p-2">
                    {r.actorLabel ?? "—"}
                    <span className="text-muted-foreground"> ({r.actorType})</span>
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {r.targetType ? `${r.targetType}:${r.targetId ?? ""}` : "—"}
                  </td>
                  <td className="p-2 text-muted-foreground">{r.tenantId ?? "—"}</td>
                  <td className="p-2 text-muted-foreground">{r.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex justify-between text-sm">
          <Link
            className="underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
            aria-disabled={Number(page) <= 1}
            href={`/admin/audit?action=${action}&page=${Number(page) - 1}`}
          >
            Anterior
          </Link>
          <span className="text-muted-foreground">
            {page} / {pages}
          </span>
          <Link
            className="underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
            aria-disabled={Number(page) >= pages}
            href={`/admin/audit?action=${action}&page=${Number(page) + 1}`}
          >
            Próxima
          </Link>
        </div>
      )}
    </div>
  );
}
