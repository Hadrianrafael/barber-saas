import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { segmentWhere, type SegmentId } from "./segments";
import type { CustomerInput, ListFilters } from "./schema";

interface Actor {
  userId: string | null;
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
        actorType: actor.userId ? "USER" : "SYSTEM",
        actorId: actor.userId,
        actorLabel: actor.label,
        action,
        targetType: "Customer",
        targetId,
        ip: actor.ip ?? null,
        metadata: metadata ?? undefined,
      },
    })
    .catch(() => undefined);
}

export async function listCustomers(tenantId: string, f: ListFilters) {
  const where: Prisma.CustomerWhereInput = {
    tenantId,
    AND: [
      f.status !== "ALL" ? { status: f.status } : {},
      segmentWhere(f.segment as SegmentId, {
        serviceId: f.serviceId || undefined,
        employeeId: f.employeeId || undefined,
      }),
      f.q
        ? {
            OR: [
              { name: { contains: f.q, mode: "insensitive" } },
              { email: { contains: f.q, mode: "insensitive" } },
              { phone: { contains: f.q } },
              { whatsapp: { contains: f.q } },
            ],
          }
        : {},
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        whatsapp: true,
        locale: true,
        status: true,
        tags: true,
        lastVisitAt: true,
        visitsCount: true,
        totalSpentCents: true,
        createdAt: true,
      },
    }),
  ]);

  return { total, rows, page: f.page, pageSize: f.pageSize, pages: Math.ceil(total / f.pageSize) };
}

export async function getCustomerDetail(tenantId: string, id: string) {
  const customer = await prisma.customer.findFirst({
    where: { id, tenantId },
    include: {
      consents: true,
      preferredEmployee: { select: { id: true, name: true } },
      appointments: {
        orderBy: { startsAt: "desc" },
        take: 50,
        select: {
          id: true,
          status: true,
          startsAt: true,
          serviceName: true,
          priceCents: true,
          currency: true,
          employee: { select: { name: true } },
        },
      },
    },
  });
  return customer;
}

export async function createCustomer(tenantId: string, input: CustomerInput, actor: Actor) {
  await ensureNoDuplicate(tenantId, input);
  const customer = await prisma.customer.create({
    data: {
      tenantId,
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
      whatsapp: input.whatsapp || null,
      locale: input.locale,
      birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null,
      notes: input.notes || null,
      tags: input.tags,
      preferredEmployeeId: input.preferredEmployeeId || null,
      status: input.status,
      source: "DASHBOARD",
    },
  });
  await audit(tenantId, actor, "customer.created", customer.id, { name: customer.name });
  logger.info({ tenantId, customerId: customer.id }, "customer.created");
  return customer;
}

export async function updateCustomer(
  tenantId: string,
  id: string,
  input: CustomerInput,
  actor: Actor,
) {
  const existing = await prisma.customer.findFirst({ where: { id, tenantId } });
  if (!existing) throw named("NotFoundError", "customer_not_found");
  await ensureNoDuplicate(tenantId, input, id);
  if (input.preferredEmployeeId) {
    const emp = await prisma.employee.count({
      where: { id: input.preferredEmployeeId, tenantId },
    });
    if (emp === 0) throw named("ValidationError", "invalid_employee");
  }
  await prisma.customer.update({
    where: { id },
    data: {
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
      whatsapp: input.whatsapp || null,
      locale: input.locale,
      birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null,
      notes: input.notes || null,
      tags: input.tags,
      preferredEmployeeId: input.preferredEmployeeId || null,
      status: input.status,
    },
  });
  await audit(tenantId, actor, "customer.updated", id);
}

export async function setCustomerStatus(
  tenantId: string,
  id: string,
  status: "ACTIVE" | "INACTIVE" | "BLOCKED",
  actor: Actor,
) {
  const res = await prisma.customer.updateMany({ where: { id, tenantId }, data: { status } });
  if (res.count === 0) throw named("NotFoundError", "customer_not_found");
  await audit(tenantId, actor, "customer.status_changed", id, { status });
}

/**
 * GDPR erase: clears PII but keeps the customer row + appointment history
 * (snapshots on Appointment preserve the operational record). Reversible? No —
 * this is a one-way delete of personal data.
 */
export async function anonymizeCustomer(tenantId: string, id: string, actor: Actor) {
  const c = await prisma.customer.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!c) throw named("NotFoundError", "customer_not_found");
  await prisma.$transaction([
    prisma.communicationConsent.deleteMany({ where: { customerId: id } }),
    prisma.customer.update({
      where: { id },
      data: {
        name: "—",
        email: null,
        phone: null,
        whatsapp: null,
        notes: null,
        birthDate: null,
        photoUrl: null,
        tags: [],
        status: "BLOCKED",
        anonymizedAt: new Date(),
      },
    }),
  ]);
  await audit(tenantId, actor, "customer.anonymized", id);
}

export async function setConsent(
  tenantId: string,
  input: { customerId: string; channel: "EMAIL" | "WHATSAPP" | "SMS"; granted: boolean },
  actor: Actor,
  source = "dashboard",
) {
  const c = await prisma.customer.findFirst({
    where: { id: input.customerId, tenantId },
    select: { id: true },
  });
  if (!c) throw named("NotFoundError", "customer_not_found");

  await prisma.communicationConsent.upsert({
    where: { customerId_channel: { customerId: input.customerId, channel: input.channel } },
    create: {
      customerId: input.customerId,
      channel: input.channel,
      granted: input.granted,
      source,
      grantedAt: input.granted ? new Date() : null,
      revokedAt: input.granted ? null : new Date(),
    },
    update: {
      granted: input.granted,
      source,
      grantedAt: input.granted ? new Date() : undefined,
      revokedAt: input.granted ? null : new Date(),
    },
  });
  await audit(
    tenantId,
    actor,
    input.granted ? "customer.opt_in" : "customer.opt_out",
    input.customerId,
    {
      channel: input.channel,
    },
  );
}

export async function getCrmMetrics(tenantId: string) {
  const now = Date.now();
  const d30 = new Date(now - 30 * 86_400_000);
  const d90 = new Date(now - 90 * 86_400_000);
  const [total, active, blocked, newest, recurring, inactive, optInWhatsapp, optInEmail] =
    await Promise.all([
      prisma.customer.count({ where: { tenantId } }),
      prisma.customer.count({ where: { tenantId, status: "ACTIVE" } }),
      prisma.customer.count({ where: { tenantId, status: "BLOCKED" } }),
      prisma.customer.count({ where: { tenantId, createdAt: { gte: d30 } } }),
      prisma.customer.count({ where: { tenantId, visitsCount: { gte: 2 } } }),
      prisma.customer.count({
        where: {
          tenantId,
          status: { not: "BLOCKED" },
          OR: [{ lastVisitAt: null }, { lastVisitAt: { lt: d90 } }],
        },
      }),
      prisma.communicationConsent.count({
        where: { customer: { tenantId }, channel: "WHATSAPP", granted: true, revokedAt: null },
      }),
      prisma.communicationConsent.count({
        where: { customer: { tenantId }, channel: "EMAIL", granted: true, revokedAt: null },
      }),
    ]);
  return { total, active, blocked, new: newest, recurring, inactive, optInWhatsapp, optInEmail };
}

// ---- helpers -------------------------------------------------------
function named(name: string, message: string) {
  const e = new Error(message);
  e.name = name;
  return e;
}

async function ensureNoDuplicate(tenantId: string, input: CustomerInput, exceptId?: string) {
  const or: Prisma.CustomerWhereInput[] = [];
  if (input.email) or.push({ email: input.email });
  if (input.phone) or.push({ phone: input.phone });
  if (or.length === 0) return;
  const dup = await prisma.customer.findFirst({
    where: { tenantId, OR: or, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (dup) throw named("ConflictError", "duplicate_customer");
}
