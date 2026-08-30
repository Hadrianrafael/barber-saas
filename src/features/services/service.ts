import "server-only";
import { prisma } from "@/server/db/client";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import type { ServiceInput } from "./schema";

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
        targetType: "Service",
        targetId,
        ip: actor.ip ?? null,
        metadata: metadata ?? undefined,
      },
    })
    .catch(() => undefined);
}

export async function listServices(tenantId: string, opts?: { includeArchived?: boolean }) {
  return prisma.service.findMany({
    where: { tenantId, ...(opts?.includeArchived ? {} : { status: "ACTIVE" }) },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      employees: { select: { employeeId: true } },
      _count: { select: { appointments: true } },
    },
  });
}

export async function getService(tenantId: string, id: string) {
  return prisma.service.findFirst({
    where: { id, tenantId },
    include: { employees: { select: { employeeId: true } } },
  });
}

async function assertEmployeesInTenant(tenantId: string, employeeIds: string[]) {
  if (employeeIds.length === 0) return;
  const n = await prisma.employee.count({ where: { tenantId, id: { in: employeeIds } } });
  if (n !== new Set(employeeIds).size) {
    const err = new Error("employee_not_in_tenant");
    err.name = "ValidationError";
    throw err;
  }
}

export async function createService(tenantId: string, input: ServiceInput, actor: Actor) {
  await assertEmployeesInTenant(tenantId, input.employeeIds);
  const service = await prisma.service.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description || null,
      priceCents: input.priceCents,
      currency: input.currency,
      durationMin: input.durationMin,
      bufferMin: input.bufferMin,
      status: input.status,
      employees: { create: input.employeeIds.map((employeeId) => ({ employeeId })) },
    },
  });
  await audit(tenantId, actor, "service.created", service.id, { name: service.name });
  logger.info({ tenantId, serviceId: service.id }, "service.created");
  return service;
}

export async function updateService(
  tenantId: string,
  id: string,
  input: ServiceInput,
  actor: Actor,
) {
  const existing = await prisma.service.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!existing) {
    const err = new Error("service_not_found");
    err.name = "NotFoundError";
    throw err;
  }
  await assertEmployeesInTenant(tenantId, input.employeeIds);
  await prisma.$transaction([
    prisma.serviceEmployee.deleteMany({ where: { serviceId: id } }),
    prisma.serviceEmployee.createMany({
      data: input.employeeIds.map((employeeId) => ({ serviceId: id, employeeId })),
    }),
    prisma.service.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description || null,
        priceCents: input.priceCents,
        currency: input.currency,
        durationMin: input.durationMin,
        bufferMin: input.bufferMin,
        status: input.status,
      },
    }),
  ]);
  await audit(tenantId, actor, "service.updated", id);
}

export async function setServiceStatus(
  tenantId: string,
  id: string,
  status: "ACTIVE" | "ARCHIVED",
  actor: Actor,
) {
  const res = await prisma.service.updateMany({ where: { id, tenantId }, data: { status } });
  if (res.count === 0) {
    const err = new Error("service_not_found");
    err.name = "NotFoundError";
    throw err;
  }
  await audit(tenantId, actor, "service.status_changed", id, { status });
}

/**
 * Hard-delete only when the service has never been booked (snapshots on
 * Appointment preserve history regardless, but a service with appointments is
 * archived instead to keep referential clarity).
 */
export async function deleteService(tenantId: string, id: string, actor: Actor) {
  const svc = await prisma.service.findFirst({
    where: { id, tenantId },
    select: { id: true, _count: { select: { appointments: true } } },
  });
  if (!svc) {
    const err = new Error("service_not_found");
    err.name = "NotFoundError";
    throw err;
  }
  if (svc._count.appointments > 0) {
    await setServiceStatus(tenantId, id, "ARCHIVED", actor);
    return { archived: true };
  }
  await prisma.$transaction([
    prisma.serviceEmployee.deleteMany({ where: { serviceId: id } }),
    prisma.service.delete({ where: { id } }),
  ]);
  await audit(tenantId, actor, "service.deleted", id);
  return { archived: false };
}
