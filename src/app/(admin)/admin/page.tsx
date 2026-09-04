import Link from "next/link";
import { requireAdminSession } from "@/server/auth/current-user";
import { adminSignOutAction } from "@/features/admin-auth/actions";
import { platformMetrics } from "@/features/admin/service";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const session = await requireAdminSession();
  const m = await platformMetrics();

  const stats = [
    { label: "Barbearias", value: m.tenantsTotal },
    { label: "Ativas", value: m.tenantsByStatus["ACTIVE"] ?? 0 },
    { label: "Trial", value: m.tenantsByStatus["TRIALING"] ?? 0 },
    { label: "Past due", value: m.tenantsByStatus["PAST_DUE"] ?? 0 },
    { label: "Suspensas", value: m.tenantsByStatus["SUSPENDED"] ?? 0 },
    { label: "Usuários", value: m.users },
    { label: "Clientes", value: m.customers },
    { label: "Agendamentos", value: m.appointments },
    { label: "Assinaturas ativas", value: m.subscriptions.active },
    { label: "MRR (aprox.)", value: formatMoney(m.subscriptions.mrrCents, "BRL", "pt-BR") },
    { label: "Pagamentos cliente", value: m.clientPayments.count },
    {
      label: "GMV cliente",
      value: formatMoney(m.clientPayments.grossCents, "BRL", "pt-BR"),
    },
    {
      label: "Taxas plataforma",
      value: formatMoney(m.clientPayments.platformFeeCents, "BRL", "pt-BR"),
    },
    { label: "Mensagens enviadas", value: m.messages["SENT"] ?? 0 },
    { label: "Mensagens falhas", value: m.failedMessages },
    { label: "Campanhas", value: m.campaigns },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Administração da plataforma</h1>
          <p className="text-sm text-muted-foreground">{session.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/tenants">Barbearias</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/sales">Vendas (IA)</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/audit">Auditoria</Link>
          </Button>
          <form action={adminSignOutAction}>
            <Button type="submit" variant="ghost" size="sm">
              Sair
            </Button>
          </form>
        </div>
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
