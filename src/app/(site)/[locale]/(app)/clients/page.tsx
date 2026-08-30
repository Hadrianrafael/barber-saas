import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { listCustomers, getCrmMetrics } from "@/features/crm/service";
import { listFiltersSchema } from "@/features/crm/schema";
import { listEmployees } from "@/features/team/service";
import { listServices } from "@/features/services/service";
import { getTenantById } from "@/features/tenant/service";
import { ClientsView } from "@/features/crm/components/clients-view";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);

  const filters = listFiltersSchema.parse(sp);
  const [list, metrics, employees, services, tenant] = await Promise.all([
    listCustomers(active.tenantId, filters),
    getCrmMetrics(active.tenantId),
    listEmployees(active.tenantId, { includeInactive: false }),
    listServices(active.tenantId, { includeArchived: false }),
    getTenantById(active.tenantId),
  ]);

  return (
    <ClientsView
      locale={locale}
      canWrite={roleCan(active.role, "customer.write")}
      canDelete={roleCan(active.role, "customer.delete")}
      currency={tenant?.currency ?? "BRL"}
      filters={filters}
      metrics={metrics}
      list={{
        total: list.total,
        page: list.page,
        pages: list.pages,
        pageSize: list.pageSize,
        rows: list.rows.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone ?? c.whatsapp,
          locale: c.locale,
          status: c.status,
          tags: c.tags,
          visitsCount: c.visitsCount,
          totalSpentCents: c.totalSpentCents,
          lastVisitAt: c.lastVisitAt ? c.lastVisitAt.toISOString() : null,
        })),
      }}
      employees={employees.map((e) => ({ id: e.id, name: e.name }))}
      services={services.map((s) => ({ id: s.id, name: s.name }))}
    />
  );
}
