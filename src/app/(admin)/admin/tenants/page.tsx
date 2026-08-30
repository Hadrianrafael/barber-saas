import Link from "next/link";
import { requireAdminSession } from "@/server/auth/current-user";
import { listTenants } from "@/features/admin/service";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const STATUSES = ["", "TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"];

export default async function AdminTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireAdminSession();
  const { q = "", status = "", page = "1" } = await searchParams;
  const { rows, total, pageSize } = await listTenants({
    q: q || undefined,
    status: status || undefined,
    page: Number(page) || 1,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const df = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Barbearias ({total})</h1>
        <Link href="/admin" className="text-sm underline">
          ← Painel
        </Link>
      </div>

      <form className="flex flex-wrap gap-2" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="nome ou slug"
          className="h-9 rounded-md border px-3 text-sm"
        />
        <select name="status" defaultValue={status} className="h-9 rounded-md border px-2 text-sm">
          {STATUSES.map((s) => (
            <option key={s || "all"} value={s}>
              {s || "todos os status"}
            </option>
          ))}
        </select>
        <button className="h-9 rounded-md border px-3 text-sm" type="submit">
          Filtrar
        </button>
      </form>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Barbearia</th>
                <th className="p-3">Status</th>
                <th className="p-3">Plano</th>
                <th className="p-3">Payout</th>
                <th className="p-3">Uso</th>
                <th className="p-3">Criada</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tn) => (
                <tr key={tn.id} className="border-b hover:bg-muted/40">
                  <td className="p-3">
                    <Link href={`/admin/tenants/${tn.id}`} className="font-medium underline">
                      {tn.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      /{tn.slug} · {tn.country} · {tn.currency}
                    </div>
                  </td>
                  <td className="p-3">{tn.status}</td>
                  <td className="p-3">
                    {tn.subscriptions[0]?.plan?.name ?? "—"}
                    <div className="text-xs text-muted-foreground">
                      {tn.subscriptions[0]?.status ?? ""}
                    </div>
                  </td>
                  <td className="p-3 text-xs">
                    {tn.payoutAccount?.status ?? "NOT_CONNECTED"}
                    {tn.payoutAccount?.chargesEnabled ? " ✓" : ""}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {tn._count.members}m · {tn._count.customers}c · {tn._count.appointments}a
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{df.format(tn.createdAt)}</td>
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
            href={`/admin/tenants?q=${q}&status=${status}&page=${Number(page) - 1}`}
          >
            Anterior
          </Link>
          <span className="text-muted-foreground">
            {page} / {pages}
          </span>
          <Link
            className="underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
            aria-disabled={Number(page) >= pages}
            href={`/admin/tenants?q=${q}&status=${status}&page=${Number(page) + 1}`}
          >
            Próxima
          </Link>
        </div>
      )}
    </div>
  );
}
