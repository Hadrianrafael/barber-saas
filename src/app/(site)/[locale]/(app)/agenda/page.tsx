import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import type { AppointmentStatus } from "@prisma/client";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { getTenantById } from "@/features/tenant/service";
import { listEmployees } from "@/features/team/service";
import { listServices } from "@/features/services/service";
import { listAppointments } from "@/features/agenda/service";
import { wallClockToUtc, dateISOInTz } from "@/features/scheduling/time";
import { AgendaView } from "@/features/agenda/components/agenda-view";

export const dynamic = "force-dynamic";

type View = "day" | "week" | "month";

function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function mondayOf(iso: string) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = Monday
  return addDaysISO(iso, -dow);
}
function firstOfMonth(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

export default async function AgendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string; view?: string; employee?: string; status?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);

  const tenant = await getTenantById(active.tenantId);
  if (!tenant) redirect(`/${locale}/onboarding`);
  const tz = tenant.timezone;

  const view: View = (["day", "week", "month"] as const).includes(sp.view as View)
    ? (sp.view as View)
    : "day";
  const dateISO = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "")
    ? sp.date!
    : dateISOInTz(new Date(), tz);
  const employeeId = sp.employee || undefined;
  const status = (sp.status as AppointmentStatus) || undefined;

  let fromISOdate = dateISO;
  let toISOdate = addDaysISO(dateISO, 1);
  if (view === "week") {
    fromISOdate = mondayOf(dateISO);
    toISOdate = addDaysISO(fromISOdate, 7);
  } else if (view === "month") {
    fromISOdate = firstOfMonth(dateISO);
    toISOdate = `${addMonth(dateISO)}-01`;
  }

  const [appointments, employees, services] = await Promise.all([
    listAppointments(active.tenantId, {
      fromISO: wallClockToUtc(fromISOdate, 0, tz).toISOString(),
      toISO: wallClockToUtc(toISOdate, 0, tz).toISOString(),
      employeeId,
      status,
    }),
    listEmployees(active.tenantId, { includeInactive: false }),
    listServices(active.tenantId, { includeArchived: false }),
  ]);

  return (
    <AgendaView
      timezone={tz}
      view={view}
      dateISO={dateISO}
      employeeId={employeeId ?? ""}
      status={status ?? ""}
      canManageAll={active.role !== "BARBER"}
      employees={employees.map((e) => ({ id: e.id, name: e.name }))}
      services={services.map((s) => ({
        id: s.id,
        name: s.name,
        durationMin: s.durationMin,
        employeeIds: s.employees.map((x) => x.employeeId),
      }))}
      appointments={appointments.map((a) => ({
        id: a.id,
        status: a.status,
        source: a.source,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        durationMin: a.durationMin,
        serviceName: a.serviceName,
        priceCents: a.priceCents,
        currency: a.currency,
        notes: a.notes,
        employee: a.employee,
        customer: a.customer,
      }))}
    />
  );
}

function addMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m, 1)); // month is 1-based -> next month
  return dt.toISOString().slice(0, 7);
}
