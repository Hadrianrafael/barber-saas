import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/server/auth/current-user";
import { getTenantDetail } from "@/features/admin/service";
import { impersonateTenantAction } from "@/features/admin/actions";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminSession();
  const { id } = await params;
  const detail = await getTenantDetail(id);
  if (!detail) notFound();
  const { tenant, recentPayments, recentMessages, usage30d } = detail;
  const df = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{tenant.name}</h1>
          <p className="text-xs text-muted-foreground">
            /{tenant.slug} · {tenant.status} · {tenant.country} · {tenant.currency} ·{" "}
            {tenant.timezone}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/tenants" className="text-sm underline">
            ← Lista
          </Link>
          <form action={impersonateTenantAction}>
            <input type="hidden" name="tenantId" value={tenant.id} />
            <Button type="submit" size="sm" variant="destructive">
              Impersonar
            </Button>
          </form>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {Object.entries({
          Clientes: tenant._count.customers,
          Profissionais: tenant._count.employees,
          Serviços: tenant._count.services,
          Agendamentos: tenant._count.appointments,
          Campanhas: tenant._count.campaigns,
        }).map(([k, v]) => (
          <Card key={k}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground">{k}</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-bold">{v}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Assinatura (SaaS)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {tenant.subscriptions.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma.</p>
          ) : (
            tenant.subscriptions.map((s) => (
              <div key={s.id} className="flex justify-between">
                <span>
                  {s.plan?.name ?? "—"} · {s.status}
                </span>
                <span className="text-muted-foreground">
                  {s.plan ? formatMoney(s.plan.priceCents, s.plan.currency, "pt-BR") : ""}
                </span>
              </div>
            ))
          )}
          <div className="pt-2 text-xs text-muted-foreground">
            Stripe Connect: {tenant.payoutAccount?.status ?? "NOT_CONNECTED"}
            {tenant.payoutAccount?.chargesEnabled ? " · charges ✓" : ""}
            {tenant.payoutAccount?.payoutsEnabled ? " · payouts ✓" : ""}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Membros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {tenant.members.map((mem) => (
            <div key={mem.id} className="flex justify-between">
              <span>
                {mem.user.name} <span className="text-muted-foreground">({mem.user.email})</span>
              </span>
              <span className="text-muted-foreground">
                {mem.role}
                {mem.user.disabledAt ? " · desativado" : ""}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pagamentos recentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {recentPayments.length === 0 ? (
              <p className="text-muted-foreground">—</p>
            ) : (
              recentPayments.map((p) => (
                <div key={p.id} className="flex justify-between">
                  <span>
                    {p.purpose} · {p.status}
                  </span>
                  <span>
                    {formatMoney(p.amountCents, p.currency, "pt-BR")} · {df.format(p.createdAt)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Mensagens (30d por status)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {Object.keys(usage30d).length === 0 ? (
              <p className="text-muted-foreground">—</p>
            ) : (
              Object.entries(usage30d).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span>{k}</span>
                  <span>{v as number}</span>
                </div>
              ))
            )}
            <div className="pt-2 text-muted-foreground">
              Últimas: {recentMessages.map((m) => `${m.channel}/${m.status}`).join(", ") || "—"}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
