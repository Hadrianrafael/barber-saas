import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { listServices } from "@/features/services/service";
import { listEmployees } from "@/features/team/service";
import { getTenantById } from "@/features/tenant/service";
import { ServicesManager } from "@/features/services/components/services-manager";

export const dynamic = "force-dynamic";

export default async function ServicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);

  const t = await getTranslations("services");
  const canEdit = roleCan(active.role, "service.write");

  const [services, employees, tenant] = await Promise.all([
    listServices(active.tenantId, { includeArchived: true }),
    listEmployees(active.tenantId, { includeInactive: false }),
    getTenantById(active.tenantId),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ServicesManager
        canEdit={canEdit}
        defaultCurrency={tenant?.currency ?? "BRL"}
        employeeOptions={employees.map((e) => ({ id: e.id, name: e.name }))}
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          priceCents: s.priceCents,
          currency: s.currency,
          durationMin: s.durationMin,
          bufferMin: s.bufferMin,
          status: s.status,
          employeeIds: s.employees.map((e) => e.employeeId),
          appointmentCount: s._count.appointments,
        }))}
      />
    </div>
  );
}
