import "server-only";
import { prisma } from "@/server/db/client";
import { wallClockToUtc, dateISOInTz, weekdayInTz } from "@/features/scheduling/time";
import { SLOT_HOLDING_STATUSES } from "@/features/scheduling/constants";

/**
 * Owner dashboard summary — all "today" windows are computed in the tenant's
 * timezone, never the server's.
 */
export async function getDashboardSummary(tenantId: string, tz: string) {
  const todayISO = dateISOInTz(new Date(), tz);
  const dayStart = wallClockToUtc(todayISO, 0, tz);
  const dayEnd = wallClockToUtc(nextISO(todayISO), 0, tz);
  const now = new Date();
  const weekday = weekdayInTz(todayISO, tz);

  const [todays, working, hourRows, empHourRows] = await Promise.all([
    prisma.appointment.findMany({
      where: { tenantId, startsAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        serviceName: true,
        durationMin: true,
        employee: { select: { name: true } },
        customer: { select: { name: true } },
      },
    }),
    prisma.employee.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, name: true },
    }),
    prisma.businessHour.findMany({ where: { tenantId, employeeId: null, weekday } }),
    prisma.businessHour.findMany({
      where: { tenantId, employeeId: { not: null }, weekday },
      select: {
        employeeId: true,
        startMin: true,
        endMin: true,
        breakStartMin: true,
        breakEndMin: true,
      },
    }),
  ]);

  const cancellations = todays.filter((a) => a.status === "CANCELED").length;
  const noShows = todays.filter((a) => a.status === "NO_SHOW").length;
  const upcoming = todays
    .filter((a) => SLOT_HOLDING_STATUSES.includes(a.status) && a.startsAt >= now)
    .slice(0, 6);

  // "Barbers working today" = has an explicit row today OR (no explicit rows at
  // all AND the tenant is open today).
  const empWithRows = new Set(empHourRows.map((r) => r.employeeId!));
  const empHasAnyRow = new Set(
    (
      await prisma.businessHour.findMany({
        where: { tenantId, employeeId: { not: null } },
        select: { employeeId: true },
      })
    ).map((r) => r.employeeId!),
  );
  const tenantOpenToday = hourRows.length > 0;
  const workingToday = working.filter(
    (e) => empWithRows.has(e.id) || (!empHasAnyRow.has(e.id) && tenantOpenToday),
  );

  // Rough "open slots today" = remaining working minutes across working barbers
  // divided by the shortest active service duration.
  const minutesPerBarber = (
    rows: {
      startMin: number;
      endMin: number;
      breakStartMin: number | null;
      breakEndMin: number | null;
    }[],
  ) =>
    rows.reduce((sum, r) => {
      const brk =
        r.breakStartMin != null && r.breakEndMin != null ? r.breakEndMin - r.breakStartMin : 0;
      return sum + Math.max(0, r.endMin - r.startMin - brk);
    }, 0);
  const tenantMinutes = minutesPerBarber(hourRows);
  const shortestService =
    (
      await prisma.service.findFirst({
        where: { tenantId, status: "ACTIVE" },
        orderBy: { durationMin: "asc" },
        select: { durationMin: true },
      })
    )?.durationMin ?? 30;

  let freeMinutes = 0;
  for (const e of workingToday) {
    const rows = empHourRows.filter((r) => r.employeeId === e.id);
    const worked = rows.length > 0 ? minutesPerBarber(rows) : tenantMinutes;
    const booked = todays
      .filter((a) => SLOT_HOLDING_STATUSES.includes(a.status) && a.employee.name === e.name)
      .reduce((s, a) => s + a.durationMin, 0);
    freeMinutes += Math.max(0, worked - booked);
  }

  return {
    todayISO,
    todaysCount: todays.filter((a) => SLOT_HOLDING_STATUSES.includes(a.status)).length,
    cancellations,
    noShows,
    workingTodayCount: workingToday.length,
    workingToday: workingToday.map((e) => e.name),
    openSlotsEstimate: Math.max(0, Math.floor(freeMinutes / shortestService)),
    upcoming: upcoming.map((a) => ({
      id: a.id,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      serviceName: a.serviceName,
      employeeName: a.employee.name,
      customerName: a.customer.name,
      status: a.status,
    })),
    todays: todays.map((a) => ({
      id: a.id,
      startsAt: a.startsAt.toISOString(),
      serviceName: a.serviceName,
      employeeName: a.employee.name,
      customerName: a.customer.name,
      status: a.status,
    })),
  };
}

function nextISO(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
