import "server-only";
import { prisma } from "@/server/db/client";
import type { Prisma, EmployeeStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import type { EmployeeInput, WorkHoursInput, TimeOffInput } from "./schema";

interface Actor {
  userId: string;
  label: string;
  ip?: string | null;
}

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
        actorType: "USER",
        actorId: actor.userId,
        actorLabel: actor.label,
        action,
        targetType: "Employee",
        targetId,
        ip: actor.ip ?? null,
        metadata: metadata ?? undefined,
      },
    })
    .catch(() => undefined);
}

export async function listEmployees(tenantId: string, opts?: { includeInactive?: boolean }) {
  return prisma.employee.findMany({
    where: { tenantId, ...(opts?.includeInactive ? {} : { status: { not: "INACTIVE" } }) },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: { services: { select: { serviceId: true } } },
  });
}

export async function getEmployee(tenantId: string, id: string) {
  return prisma.employee.findFirst({
    where: { id, tenantId },
    include: {
      services: { select: { serviceId: true } },
      workHours: { orderBy: { weekday: "asc" } },
    },
  });
}

export async function getEmployeeByUser(tenantId: string, userId: string) {
  return prisma.employee.findFirst({ where: { tenantId, userId } });
}

async function assertServicesBelongToTenant(tenantId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return;
  const count = await prisma.service.count({ where: { tenantId, id: { in: serviceIds } } });
  if (count !== new Set(serviceIds).size) {
    const err = new Error("service_not_in_tenant");
    err.name = "ValidationError";
    throw err;
  }
}

export async function createEmployee(tenantId: string, input: EmployeeInput, actor: Actor) {
  await assertServicesBelongToTenant(tenantId, input.serviceIds);
  const employee = await prisma.employee.create({
    data: {
      tenantId,
      name: input.name,
      title: input.title || null,
      email: input.email || null,
      phone: input.phone || null,
      specialties: input.specialties,
      commissionType: input.commissionType,
      commissionBps: input.commissionType === "PERCENT" ? input.commissionBps : 0,
      commissionFixedCents: input.commissionType === "FIXED" ? input.commissionFixedCents : 0,
      status: input.status,
      services: { create: input.serviceIds.map((serviceId) => ({ serviceId })) },
    },
  });
  await audit(tenantId, actor, "employee.created", employee.id, { name: employee.name });
  logger.info({ tenantId, employeeId: employee.id }, "employee.created");
  return employee;
}

export async function updateEmployee(
  tenantId: string,
  id: string,
  input: EmployeeInput,
  actor: Actor,
) {
  const existing = await prisma.employee.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!existing) {
    const err = new Error("employee_not_found");
    err.name = "NotFoundError";
    throw err;
  }
  await assertServicesBelongToTenant(tenantId, input.serviceIds);

  await prisma.$transaction([
    prisma.serviceEmployee.deleteMany({ where: { employeeId: id } }),
    prisma.serviceEmployee.createMany({
      data: input.serviceIds.map((serviceId) => ({ serviceId, employeeId: id })),
    }),
    prisma.employee.update({
      where: { id },
      data: {
        name: input.name,
        title: input.title || null,
        email: input.email || null,
        phone: input.phone || null,
        specialties: input.specialties,
        commissionType: input.commissionType,
        commissionBps: input.commissionType === "PERCENT" ? input.commissionBps : 0,
        commissionFixedCents: input.commissionType === "FIXED" ? input.commissionFixedCents : 0,
        status: input.status,
      },
    }),
  ]);
  await audit(tenantId, actor, "employee.updated", id);
}

/** Deactivating a barber never touches their appointment history. */
export async function setEmployeeStatus(
  tenantId: string,
  id: string,
  status: EmployeeStatus,
  actor: Actor,
) {
  const res = await prisma.employee.updateMany({ where: { id, tenantId }, data: { status } });
  if (res.count === 0) {
    const err = new Error("employee_not_found");
    err.name = "NotFoundError";
    throw err;
  }
  await audit(tenantId, actor, "employee.status_changed", id, { status });
}

export async function updateSelfProfile(
  tenantId: string,
  employeeId: string,
  input: { bio?: string; phone?: string; photoUrl?: string; specialties: string[] },
  actor: Actor,
) {
  const res = await prisma.employee.updateMany({
    where: { id: employeeId, tenantId },
    data: {
      bio: input.bio || null,
      phone: input.phone || null,
      photoUrl: input.photoUrl || null,
      specialties: input.specialties,
    },
  });
  if (res.count === 0) {
    const err = new Error("employee_not_found");
    err.name = "NotFoundError";
    throw err;
  }
  await audit(tenantId, actor, "employee.self_updated", employeeId);
}

// ---- Per-barber weekly work hours -------------------------------------

export async function getEmployeeWorkHours(tenantId: string, employeeId: string) {
  return prisma.businessHour.findMany({
    where: { tenantId, employeeId },
    orderBy: { weekday: "asc" },
  });
}

export async function replaceEmployeeWorkHours(
  tenantId: string,
  employeeId: string,
  input: WorkHoursInput,
  actor: Actor,
) {
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { id: true },
  });
  if (!emp) {
    const err = new Error("employee_not_found");
    err.name = "NotFoundError";
    throw err;
  }
  const open = input.rows.filter((r) => r.open);
  await prisma.$transaction([
    prisma.businessHour.deleteMany({ where: { tenantId, employeeId } }),
    prisma.businessHour.createMany({
      data: open.map((r) => ({
        tenantId,
        employeeId,
        weekday: r.weekday,
        startMin: r.startMin,
        endMin: r.endMin,
        breakStartMin: r.breakStartMin,
        breakEndMin: r.breakEndMin,
      })),
    }),
  ]);
  await audit(tenantId, actor, "employee.work_hours_updated", employeeId);
}

// ---- Time off / vacation / one-off blocks ----------------------------

export async function listTimeOff(tenantId: string, employeeId?: string) {
  return prisma.blockedTime.findMany({
    where: {
      tenantId,
      ...(employeeId ? { employeeId } : {}),
      kind: { in: ["TIME_OFF", "VACATION", "OTHER"] },
    },
    orderBy: { startsAt: "desc" },
    take: 200,
  });
}

export async function addTimeOff(
  tenantId: string,
  input: TimeOffInput & { employeeId: string | null },
  actor: Actor,
) {
  if (input.employeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: input.employeeId, tenantId },
      select: { id: true },
    });
    if (!emp) {
      const err = new Error("employee_not_found");
      err.name = "NotFoundError";
      throw err;
    }
  }
  const row = await prisma.blockedTime.create({
    data: {
      tenantId,
      employeeId: input.employeeId,
      kind: input.kind,
      reason: input.reason || null,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
    },
  });
  await audit(tenantId, actor, "employee.time_off_added", input.employeeId ?? tenantId, {
    kind: input.kind,
  });
  return row;
}

export async function removeTimeOff(tenantId: string, id: string, actor: Actor) {
  const res = await prisma.blockedTime.deleteMany({
    where: { id, tenantId, kind: { in: ["TIME_OFF", "VACATION", "OTHER"] } },
  });
  if (res.count > 0) await audit(tenantId, actor, "employee.time_off_removed", id);
}
