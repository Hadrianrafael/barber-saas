import "server-only";
import type { AppointmentStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { TenantContext } from "@/server/rbac/guard";
import { AuthorizationError } from "@/server/rbac/guard";
import { SchedulingError } from "@/features/scheduling/errors";

export interface AppointmentListQuery {
  fromISO: string;
  toISO: string;
  employeeId?: string;
  status?: AppointmentStatus;
}

export async function listAppointments(tenantId: string, q: AppointmentListQuery) {
  return prisma.appointment.findMany({
    where: {
      tenantId,
      startsAt: { gte: new Date(q.fromISO), lt: new Date(q.toISO) },
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.status ? { status: q.status } : {}),
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      status: true,
      source: true,
      startsAt: true,
      endsAt: true,
      durationMin: true,
      bufferMin: true,
      serviceName: true,
      priceCents: true,
      currency: true,
      notes: true,
      employee: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, phone: true } },
    },
  });
}

export async function getAppointmentDetail(tenantId: string, id: string) {
  return prisma.appointment.findFirst({
    where: { id, tenantId },
    include: {
      employee: { select: { id: true, name: true, userId: true } },
      customer: { select: { id: true, name: true, phone: true, email: true } },
      service: { select: { id: true, name: true, status: true } },
    },
  });
}

/**
 * BARBER may only act on appointments on their own agenda. OWNER/MANAGER
 * (appointment.manageAll) may act on any. Returns the appointment's employeeId.
 */
export async function assertCanManageAppointment(
  ctx: TenantContext,
  appointmentId: string,
): Promise<{ employeeId: string }> {
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId: ctx.tenantId },
    select: { employeeId: true, employee: { select: { userId: true } } },
  });
  if (!appt) throw new SchedulingError("APPOINTMENT_NOT_FOUND");
  if (ctx.can("appointment.manageAll")) return { employeeId: appt.employeeId };
  if (!ctx.can("appointment.write")) throw new AuthorizationError();
  if (appt.employee.userId !== ctx.session.userId) throw new SchedulingError("NOT_OWN_AGENDA");
  return { employeeId: appt.employeeId };
}

/** For the booking dialog: search existing customers. */
export async function searchCustomers(tenantId: string, term: string, limit = 8) {
  const q = term.trim();
  if (q.length < 2) return [];
  return prisma.customer.findMany({
    where: {
      tenantId,
      status: { not: "BLOCKED" },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { lastVisitAt: "desc" },
    select: { id: true, name: true, phone: true },
  });
}

export async function createQuickCustomer(
  tenantId: string,
  input: { name: string; phone?: string | null; email?: string | null; locale: string },
  actorUserId: string,
  actorLabel: string,
) {
  // Reuse an existing customer with the same phone/email to avoid duplicates.
  if (input.phone || input.email) {
    const existing = await prisma.customer.findFirst({
      where: {
        tenantId,
        OR: [
          ...(input.phone ? [{ phone: input.phone }] : []),
          ...(input.email ? [{ email: input.email }] : []),
        ],
      },
      select: { id: true },
    });
    if (existing) return existing.id;
  }
  const created = await prisma.customer.create({
    data: {
      tenantId,
      name: input.name,
      phone: input.phone || null,
      email: input.email || null,
      locale: input.locale,
      source: "DASHBOARD",
    },
    select: { id: true },
  });
  await prisma.auditLog
    .create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: actorUserId,
        actorLabel,
        action: "customer.created",
        targetType: "Customer",
        targetId: created.id,
        metadata: { via: "agenda_quick_add" },
      },
    })
    .catch(() => undefined);
  return created.id;
}
