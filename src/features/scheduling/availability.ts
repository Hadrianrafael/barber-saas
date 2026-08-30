import "server-only";
import { prisma } from "@/server/db/client";
import { parseBookingConfig } from "@/features/tenant/booking-config";
import { SchedulingError } from "./errors";
import { SLOT_HOLDING_STATUSES } from "./constants";
import { computeSlots, type Slot, type WorkRow } from "./slots";
import { weekdayInTz, wallClockToUtc } from "./time";

export interface AvailabilityQuery {
  tenantId: string;
  serviceId: string;
  dateISO: string; // YYYY-MM-DD in the tenant's timezone
  employeeId?: string; // narrow to one barber
  now?: Date; // injectable for tests
}

export interface EmployeeAvailability {
  employeeId: string;
  employeeName: string;
  slots: { startsAt: string; endsAt: string }[];
}

export interface AvailabilityResult {
  timezone: string;
  service: {
    id: string;
    name: string;
    durationMin: number;
    bufferMin: number;
    priceCents: number;
    currency: string;
  };
  byEmployee: EmployeeAvailability[];
}

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * The single source of truth for "when can this be booked". Used by the
 * dashboard new-appointment flow now, and by the public page + chatbot in later
 * slices. Never trust availability computed on the client.
 */
export async function getAvailableSlots(q: AvailabilityQuery): Promise<AvailabilityResult> {
  const now = q.now ?? new Date();

  const tenant = await prisma.tenant.findUnique({
    where: { id: q.tenantId },
    select: { timezone: true, bookingConfig: true },
  });
  if (!tenant) throw new SchedulingError("SERVICE_NOT_FOUND", "tenant not found");
  const tz = tenant.timezone;
  const config = parseBookingConfig(tenant.bookingConfig);

  const service = await prisma.service.findFirst({
    where: { id: q.serviceId, tenantId: q.tenantId },
    include: {
      employees: {
        include: { employee: { select: { id: true, name: true, status: true } } },
      },
    },
  });
  if (!service) throw new SchedulingError("SERVICE_NOT_FOUND");
  if (service.status !== "ACTIVE") throw new SchedulingError("SERVICE_INACTIVE");

  let candidates = service.employees.map((se) => se.employee).filter((e) => e.status === "ACTIVE");
  if (q.employeeId) {
    candidates = candidates.filter((e) => e.id === q.employeeId);
    if (candidates.length === 0) throw new SchedulingError("EMPLOYEE_CANT_DO_SERVICE");
  }

  const weekday = weekdayInTz(q.dateISO, tz);
  const dayStartUtc = wallClockToUtc(q.dateISO, 0, tz);
  const dayEndUtc = wallClockToUtc(addDaysISO(q.dateISO, 1), 0, tz);

  const [holiday, tenantRows, empRows, blocks, appts] = await Promise.all([
    prisma.holiday.findUnique({
      where: {
        tenantId_date: { tenantId: q.tenantId, date: new Date(`${q.dateISO}T00:00:00.000Z`) },
      },
    }),
    prisma.businessHour.findMany({
      where: { tenantId: q.tenantId, employeeId: null, weekday },
    }),
    prisma.businessHour.findMany({
      where: { tenantId: q.tenantId, employeeId: { in: candidates.map((c) => c.id) }, weekday },
    }),
    prisma.blockedTime.findMany({
      where: {
        tenantId: q.tenantId,
        startsAt: { lt: dayEndUtc },
        endsAt: { gt: dayStartUtc },
        OR: [{ employeeId: null }, { employeeId: { in: candidates.map((c) => c.id) } }],
      },
      select: { employeeId: true, startsAt: true, endsAt: true },
    }),
    prisma.appointment.findMany({
      where: {
        tenantId: q.tenantId,
        employeeId: { in: candidates.map((c) => c.id) },
        status: { in: SLOT_HOLDING_STATUSES },
        startsAt: { lt: dayEndUtc },
        endsAt: { gt: dayStartUtc },
      },
      select: { employeeId: true, startsAt: true, endsAt: true, bufferMin: true },
    }),
  ]);

  const holidayClosed = !!holiday && holiday.isClosed;

  const earliest = new Date(now.getTime() + config.minLeadTimeMin * 60_000);
  const latest = new Date(now.getTime() + config.maxAdvanceDays * 86_400_000);

  const empRowsById = new Map<string, WorkRow[]>();
  for (const r of empRows) {
    const list = empRowsById.get(r.employeeId!) ?? [];
    list.push(r);
    empRowsById.set(r.employeeId!, list);
  }

  const byEmployee: EmployeeAvailability[] = candidates.map((emp) => {
    const rows = (empRowsById.get(emp.id) ?? tenantRows) as WorkRow[];
    const empBlocks = blocks.filter((b) => b.employeeId === null || b.employeeId === emp.id);
    const empBusy = appts
      .filter((a) => a.employeeId === emp.id)
      .map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt, bufferMin: a.bufferMin }));

    const slots: Slot[] = computeSlots({
      dateISO: q.dateISO,
      tz,
      workRows: rows,
      holidayClosed,
      blocks: empBlocks,
      busy: empBusy,
      serviceDurationMin: service.durationMin,
      serviceBufferMin: service.bufferMin,
      slotGranularityMin: config.slotGranularityMin,
      earliest,
      latest,
    });

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      slots: slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      })),
    };
  });

  return {
    timezone: tz,
    service: {
      id: service.id,
      name: service.name,
      durationMin: service.durationMin,
      bufferMin: service.bufferMin,
      priceCents: service.priceCents,
      currency: service.currency,
    },
    byEmployee,
  };
}
