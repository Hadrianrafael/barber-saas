import "server-only";
import { Prisma, type AppointmentStatus, type AppointmentSource } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { parseBookingConfig } from "@/features/tenant/booking-config";
import { SchedulingError } from "./errors";
import { SLOT_HOLDING_STATUSES, RESCHEDULABLE_STATUSES, canTransition } from "./constants";
import { computeSlots, type WorkRow } from "./slots";
import { weekdayInTz, wallClockToUtc } from "./time";

/**
 * Appointment domain. Every write path (dashboard, public page, chatbot) goes
 * through these functions — booking rules never live in the UI.
 *
 * Conflict prevention is layered:
 *   1. availability check (`assertBookable`) against working hours / blocks / holidays
 *   2. a SERIALIZABLE transaction that re-checks for an overlapping appointment
 *      (respecting both appointments' buffers) immediately before insert/update
 *   3. the Postgres `appointment_no_overlap` GiST exclusion constraint as the
 *      final backstop — a concurrent writer that races past (2) hits a DB error,
 *      which we translate to SLOT_TAKEN.
 */

const SERIALIZATION_RETRIES = 3;

interface Actor {
  userId: string | null;
  label: string;
  ip?: string | null;
}

export interface CreateAppointmentInput {
  tenantId: string;
  serviceId: string;
  employeeId: string;
  customerId: string;
  startsAt: Date;
  source: AppointmentSource;
  notes?: string | null;
  actor: Actor;
  /** Skip the min-lead-time rule (staff booking a walk-in). Default false. */
  allowShortNotice?: boolean;
  now?: Date;
}

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function floorToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

async function loadBookingInputs(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceId: string,
  employeeId: string,
  customerId: string,
) {
  const [tenant, service, employee, customer] = await Promise.all([
    tx.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true, bookingConfig: true },
    }),
    tx.service.findFirst({
      where: { id: serviceId, tenantId },
      include: { employees: { select: { employeeId: true } } },
    }),
    tx.employee.findFirst({ where: { id: employeeId, tenantId } }),
    tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } }),
  ]);

  if (!tenant) throw new SchedulingError("VALIDATION", "tenant not found");
  if (!service) throw new SchedulingError("SERVICE_NOT_FOUND");
  if (service.status !== "ACTIVE") throw new SchedulingError("SERVICE_INACTIVE");
  if (!employee) throw new SchedulingError("EMPLOYEE_NOT_FOUND");
  if (employee.status !== "ACTIVE") throw new SchedulingError("EMPLOYEE_INACTIVE");
  if (!service.employees.some((se) => se.employeeId === employeeId))
    throw new SchedulingError("EMPLOYEE_CANT_DO_SERVICE");
  if (!customer) throw new SchedulingError("CUSTOMER_NOT_FOUND");

  return { tenant, service, employee };
}

/** Assert `[startsAt, endsAt + buffer)` falls entirely inside a free window. */
async function assertBookable(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string;
    employeeId: string;
    tz: string;
    startsAt: Date;
    durationMin: number;
    bufferMin: number;
    ignoreAppointmentId?: string;
  },
) {
  const { tenantId, employeeId, tz, startsAt, durationMin, bufferMin } = args;
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);
  // Weekday / working hours are resolved against the tenant-tz calendar date.
  const tzDateISO = tzCalendarDate(startsAt, tz);
  const weekday = weekdayInTz(tzDateISO, tz);
  const dayStart = wallClockToUtc(tzDateISO, 0, tz);
  const dayEnd = wallClockToUtc(addDaysISO(tzDateISO, 1), 0, tz);

  const [holiday, empRows, tenantRows, blocks, busy] = await Promise.all([
    tx.holiday.findUnique({
      where: { tenantId_date: { tenantId, date: new Date(`${tzDateISO}T00:00:00.000Z`) } },
    }),
    tx.businessHour.findMany({ where: { tenantId, employeeId, weekday } }),
    tx.businessHour.findMany({ where: { tenantId, employeeId: null, weekday } }),
    tx.blockedTime.findMany({
      where: {
        tenantId,
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
        OR: [{ employeeId: null }, { employeeId }],
      },
      select: { startsAt: true, endsAt: true },
    }),
    tx.appointment.findMany({
      where: {
        tenantId,
        employeeId,
        status: { in: SLOT_HOLDING_STATUSES },
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
        ...(args.ignoreAppointmentId ? { id: { not: args.ignoreAppointmentId } } : {}),
      },
      select: { startsAt: true, endsAt: true, bufferMin: true },
    }),
  ]);

  const rows = (empRows.length > 0 ? empRows : tenantRows) as WorkRow[];
  const slots = computeSlots({
    dateISO: tzDateISO,
    tz,
    workRows: rows,
    holidayClosed: !!holiday && holiday.isClosed,
    blocks,
    busy: busy.map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt, bufferMin: b.bufferMin })),
    serviceDurationMin: durationMin,
    serviceBufferMin: bufferMin,
    slotGranularityMin: 1, // 1-min granularity so an exact requested time is testable
    earliest: new Date(0),
    latest: new Date(8640000000000000),
  });

  const wanted = startsAt.getTime();
  const fits = slots.some((s) => s.startsAt.getTime() === wanted);
  if (!fits) {
    // Distinguish "slot physically taken" from "outside working hours/blocks".
    const overlapsBusy = busy.some(
      (b) =>
        b.startsAt.getTime() < endsAt.getTime() + bufferMin * 60_000 &&
        b.endsAt.getTime() + b.bufferMin * 60_000 > wanted,
    );
    throw new SchedulingError(overlapsBusy ? "SLOT_TAKEN" : "OUTSIDE_AVAILABILITY");
  }
}

function tzCalendarDate(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function isSerializationFailure(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
}
function isOverlapConstraintViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /appointment_no_overlap|exclusion constraint|23P01/i.test(msg);
}

async function withSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < SERIALIZATION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (e) {
      lastErr = e;
      if (isSerializationFailure(e)) continue;
      if (isOverlapConstraintViolation(e)) throw new SchedulingError("SLOT_TAKEN");
      throw e;
    }
  }
  if (isOverlapConstraintViolation(lastErr)) throw new SchedulingError("SLOT_TAKEN");
  throw new SchedulingError("SLOT_TAKEN", "could not acquire the slot after retries");
}

export async function createAppointment(input: CreateAppointmentInput) {
  const now = input.now ?? new Date();
  const startsAt = floorToMinute(input.startsAt);

  const appt = await withSerializable(async (tx) => {
    const { tenant, service } = await loadBookingInputs(
      tx,
      input.tenantId,
      input.serviceId,
      input.employeeId,
      input.customerId,
    );
    const config = parseBookingConfig(tenant.bookingConfig);
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

    if (!input.allowShortNotice) {
      if (startsAt.getTime() < now.getTime() + config.minLeadTimeMin * 60_000)
        throw new SchedulingError("TOO_SOON");
      if (startsAt.getTime() > now.getTime() + config.maxAdvanceDays * 86_400_000)
        throw new SchedulingError("TOO_FAR");
    }

    await assertBookable(tx, {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      tz: tenant.timezone,
      startsAt,
      durationMin: service.durationMin,
      bufferMin: service.bufferMin,
    });

    return tx.appointment.create({
      data: {
        tenantId: input.tenantId,
        customerId: input.customerId,
        employeeId: input.employeeId,
        serviceId: input.serviceId,
        source: input.source,
        status: "PENDING",
        startsAt,
        endsAt,
        serviceName: service.name,
        durationMin: service.durationMin,
        bufferMin: service.bufferMin,
        priceCents: service.priceCents,
        currency: service.currency,
        notes: input.notes ?? null,
        createdById: input.actor.userId,
      },
    });
  });

  await audit(input.tenantId, input.actor, "appointment.created", appt.id, {
    startsAt: appt.startsAt.toISOString(),
    employeeId: appt.employeeId,
  });
  logger.info({ tenantId: input.tenantId, appointmentId: appt.id }, "appointment.created");
  return appt;
}

export interface RescheduleInput {
  tenantId: string;
  appointmentId: string;
  startsAt: Date;
  employeeId?: string; // optional move to another barber
  actor: Actor;
  allowShortNotice?: boolean;
  now?: Date;
}

export async function rescheduleAppointment(input: RescheduleInput) {
  const startsAt = floorToMinute(input.startsAt);
  const updated = await withSerializable(async (tx) => {
    const current = await tx.appointment.findFirst({
      where: { id: input.appointmentId, tenantId: input.tenantId },
    });
    if (!current) throw new SchedulingError("APPOINTMENT_NOT_FOUND");
    if (!RESCHEDULABLE_STATUSES.includes(current.status))
      throw new SchedulingError(
        "INVALID_TRANSITION",
        `cannot reschedule a ${current.status} appointment`,
      );

    const employeeId = input.employeeId ?? current.employeeId;
    const tenant = await tx.tenant.findUnique({
      where: { id: input.tenantId },
      select: { timezone: true },
    });

    if (employeeId !== current.employeeId) {
      const link = await tx.serviceEmployee.findUnique({
        where: { serviceId_employeeId: { serviceId: current.serviceId, employeeId } },
      });
      if (!link) throw new SchedulingError("EMPLOYEE_CANT_DO_SERVICE");
      const emp = await tx.employee.findFirst({
        where: { id: employeeId, tenantId: input.tenantId },
      });
      if (!emp || emp.status !== "ACTIVE") throw new SchedulingError("EMPLOYEE_INACTIVE");
    }

    await assertBookable(tx, {
      tenantId: input.tenantId,
      employeeId,
      tz: tenant!.timezone,
      startsAt,
      durationMin: current.durationMin,
      bufferMin: current.bufferMin,
      ignoreAppointmentId: current.id,
    });

    return tx.appointment.update({
      where: { id: current.id },
      data: {
        startsAt,
        endsAt: new Date(startsAt.getTime() + current.durationMin * 60_000),
        employeeId,
      },
    });
  });

  await audit(input.tenantId, input.actor, "appointment.rescheduled", updated.id, {
    startsAt: updated.startsAt.toISOString(),
    employeeId: updated.employeeId,
  });
  return updated;
}

async function transition(
  tenantId: string,
  appointmentId: string,
  to: AppointmentStatus,
  actor: Actor,
  extra: Partial<Record<"cancelReason", string>> = {},
) {
  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      select: { id: true, status: true },
    });
    if (!current) throw new SchedulingError("APPOINTMENT_NOT_FOUND");
    if (!canTransition(current.status, to))
      throw new SchedulingError("INVALID_TRANSITION", `${current.status} -> ${to}`);

    const stamp: Record<string, unknown> = {};
    if (to === "CONFIRMED") stamp.confirmedAt = new Date();
    if (to === "IN_PROGRESS") stamp.startedAt = new Date();
    if (to === "COMPLETED") stamp.completedAt = new Date();
    if (to === "NO_SHOW") stamp.noShowAt = new Date();
    if (to === "CANCELED") {
      stamp.canceledAt = new Date();
      stamp.cancelReason = extra.cancelReason ?? null;
    }

    return tx.appointment.update({ where: { id: current.id }, data: { status: to, ...stamp } });
  });

  await audit(tenantId, actor, `appointment.${to.toLowerCase()}`, updated.id);
  return updated;
}

export const confirmAppointment = (tenantId: string, id: string, actor: Actor) =>
  transition(tenantId, id, "CONFIRMED", actor);
export const startAppointment = (tenantId: string, id: string, actor: Actor) =>
  transition(tenantId, id, "IN_PROGRESS", actor);
export const completeAppointment = (tenantId: string, id: string, actor: Actor) =>
  transition(tenantId, id, "COMPLETED", actor);
export const markNoShow = (tenantId: string, id: string, actor: Actor) =>
  transition(tenantId, id, "NO_SHOW", actor);
export const cancelAppointment = (tenantId: string, id: string, actor: Actor, reason?: string) =>
  transition(tenantId, id, "CANCELED", actor, { cancelReason: reason });

async function audit(
  tenantId: string,
  actor: Actor,
  action: string,
  targetId: string,
  metadata?: Prisma.InputJsonValue,
) {
  await prisma.auditLog
    .create({
      data: {
        tenantId,
        actorType: actor.userId ? "USER" : "SYSTEM",
        actorId: actor.userId,
        actorLabel: actor.label,
        action,
        targetType: "Appointment",
        targetId,
        ip: actor.ip ?? null,
        metadata: metadata ?? undefined,
      },
    })
    .catch(() => undefined);
}
