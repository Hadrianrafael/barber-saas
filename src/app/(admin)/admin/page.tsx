import { requireAdminSession } from "@/server/auth/current-user";
import { prisma } from "@/server/db/client";
import { adminSignOutAction } from "@/features/admin-auth/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminDashboardPage() {
  const session = await requireAdminSession();

  const [tenants, active, users, customers, appointments, activeSubs] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { status: "ACTIVE" } }),
    prisma.user.count(),
    prisma.customer.count(),
    prisma.appointment.count(),
    prisma.subscription.count({
      where: { scope: "PLATFORM", status: "ACTIVE" },
    }),
  ]);

  const stats = [
    { label: "Barbearias", value: tenants },
    { label: "Barbearias ativas", value: active },
    { label: "Usuários", value: users },
    { label: "Clientes", value: customers },
    { label: "Agendamentos", value: appointments },
    { label: "Assinaturas ativas", value: activeSubs },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Administração da plataforma</h1>
          <p className="text-sm text-muted-foreground">{session.email}</p>
        </div>
        <form action={adminSignOutAction}>
          <Button type="submit" variant="outline" size="sm">
            Sair
          </Button>
        </form>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      <p className="text-sm text-muted-foreground">
        Gestão de barbearias, planos, assinaturas, faturamento e impersonação chegam nas Slices 2–7.
      </p>
    </div>
  );
}
