import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { listEmployees, getEmployeeByUser, getEmployeeWorkHours } from "@/features/team/service";
import { listServices } from "@/features/services/service";
import { listTimeOff } from "@/features/team/service";
import { TeamManager } from "@/features/team/components/team-manager";
import { SelfProfile } from "@/features/team/components/self-profile";

export const dynamic = "force-dynamic";

export default async function TeamPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);

  const t = await getTranslations("team");
  const canManage = roleCan(active.role, "employee.write");

  const [employees, services, myEmployee] = await Promise.all([
    listEmployees(active.tenantId, { includeInactive: true }),
    listServices(active.tenantId, { includeArchived: false }),
    getEmployeeByUser(active.tenantId, session.userId),
  ]);

  const serviceOptions = services.map((s) => ({ id: s.id, name: s.name }));

  if (!canManage) {
    // BARBER: own profile + own time off only.
    const timeOff = myEmployee ? await listTimeOff(active.tenantId, myEmployee.id) : [];
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
        </div>
        {myEmployee ? (
          <SelfProfile
            employee={{
              id: myEmployee.id,
              bio: myEmployee.bio,
              phone: myEmployee.phone,
              photoUrl: myEmployee.photoUrl,
              specialties: myEmployee.specialties,
            }}
            timeOff={timeOff.map((b) => ({
              id: b.id,
              kind: b.kind,
              startsAt: b.startsAt.toISOString(),
              endsAt: b.endsAt.toISOString(),
              reason: b.reason,
            }))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("errors.notLinked")}</p>
        )}
        <TeamManager
          readOnly
          employees={serialize(employees)}
          serviceOptions={serviceOptions}
          workHoursByEmployee={{}}
          timeOff={[]}
        />
      </div>
    );
  }

  const workHoursByEmployee: Record<string, Awaited<ReturnType<typeof getEmployeeWorkHours>>> = {};
  await Promise.all(
    employees.map(async (e) => {
      workHoursByEmployee[e.id] = await getEmployeeWorkHours(active.tenantId, e.id);
    }),
  );
  const timeOff = await listTimeOff(active.tenantId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <TeamManager
        employees={serialize(employees)}
        serviceOptions={serviceOptions}
        workHoursByEmployee={Object.fromEntries(
          Object.entries(workHoursByEmployee).map(([k, rows]) => [
            k,
            rows.map((r) => ({
              weekday: r.weekday,
              startMin: r.startMin,
              endMin: r.endMin,
              breakStartMin: r.breakStartMin,
              breakEndMin: r.breakEndMin,
            })),
          ]),
        )}
        timeOff={timeOff.map((b) => ({
          id: b.id,
          employeeId: b.employeeId,
          kind: b.kind,
          startsAt: b.startsAt.toISOString(),
          endsAt: b.endsAt.toISOString(),
          reason: b.reason,
        }))}
      />
    </div>
  );
}

function serialize(employees: Awaited<ReturnType<typeof listEmployees>>) {
  return employees.map((e) => ({
    id: e.id,
    name: e.name,
    title: e.title,
    email: e.email,
    phone: e.phone,
    specialties: e.specialties,
    commissionType: e.commissionType,
    commissionBps: e.commissionBps,
    commissionFixedCents: e.commissionFixedCents,
    status: e.status,
    serviceIds: e.services.map((s) => s.serviceId),
  }));
}
