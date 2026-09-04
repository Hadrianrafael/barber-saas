import "server-only";
import type { Prisma, SalesLead, SalesLeadStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { addSuppression } from "./suppression";
import { dedupeKey, normalizeEmail, normalizePhone, isEmail } from "./phone";
import { leadUpdateSchema } from "./schema";
import { logger } from "@/lib/logger";

const PAGE_SIZE = 50;

export async function listLeads(opts: {
  q?: string;
  status?: SalesLeadStatus;
  qualification?: "FRIO" | "MORNO" | "QUENTE";
  page?: number;
}) {
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.SalesLeadWhereInput = {};
  if (opts.status) where.status = opts.status;
  if (opts.qualification) where.qualification = opts.qualification;
  if (opts.q) {
    const q = opts.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { barbershopName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q.replace(/\D/g, "") } },
      { whatsapp: { contains: q.replace(/\D/g, "") } },
      { city: { contains: q, mode: "insensitive" } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.salesLead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.salesLead.count({ where }),
  ]);
  return { rows, total, page, pageSize: PAGE_SIZE };
}

export async function getLead(id: string) {
  return prisma.salesLead.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 50 },
      conversations: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
}

export async function updateLead(id: string, input: unknown, actorId: string): Promise<SalesLead> {
  const data = leadUpdateSchema.parse(input);
  const patch: Prisma.SalesLeadUpdateInput = { ...data } as Prisma.SalesLeadUpdateInput;

  if (data.phone !== undefined)
    patch.phone = data.phone ? normalizePhone(data.phone) || null : null;
  if (data.whatsapp !== undefined)
    patch.whatsapp = data.whatsapp ? normalizePhone(data.whatsapp) || null : null;
  if (data.email !== undefined) {
    const e = data.email ? normalizeEmail(data.email) : null;
    patch.email = e && isEmail(e) ? e : null;
  }

  // keep dedupeKey coherent if contact fields changed
  const before = await prisma.salesLead.findUniqueOrThrow({ where: { id } });
  const key = dedupeKey({
    whatsapp: (patch.whatsapp as string | null | undefined) ?? before.whatsapp,
    phone: (patch.phone as string | null | undefined) ?? before.phone,
    email: (patch.email as string | null | undefined) ?? before.email,
  });
  patch.dedupeKey = key;

  const updated = await prisma.salesLead.update({ where: { id }, data: patch });
  await prisma.salesLeadEvent.create({
    data: { leadId: id, kind: "updated", actorId, data: { fields: Object.keys(data) } },
  });
  return updated;
}

export async function setLeadStatus(
  id: string,
  status: SalesLeadStatus,
  actorId: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  const lead = await prisma.salesLead.findUniqueOrThrow({ where: { id } });
  if (lead.status === status) return;
  await prisma.salesLead.update({ where: { id }, data: { status } });
  await prisma.salesLeadEvent.create({
    data: {
      leadId: id,
      kind: "status_change",
      actorId,
      data: { from: lead.status, to: status, ...meta },
    },
  });
}

/** Opt a lead out on every channel and add to the suppression list. */
export async function optOutLead(id: string, reason: string, source: string): Promise<void> {
  const lead = await prisma.salesLead.findUniqueOrThrow({ where: { id } });
  await prisma.salesLead.update({
    where: { id },
    data: { status: "OPT_OUT", optOutAt: new Date(), optOutReason: reason },
  });
  for (const r of [lead.whatsapp, lead.phone, lead.email].filter(Boolean) as string[]) {
    await addSuppression(r, "opt_out", source);
  }
  await prisma.salesCampaignLead.updateMany({
    where: { leadId: id, state: { in: ["PENDING", "SCHEDULED"] } },
    data: { state: "SKIPPED", skippedReason: "opt_out" },
  });
  await prisma.salesConversation.updateMany({
    where: { leadId: id, status: "OPEN" },
    data: { status: "CLOSED" },
  });
  await prisma.salesLeadEvent.create({
    data: { leadId: id, kind: "opt_out", data: { reason, source } },
  });
  logger.info({ leadId: id, source }, "sdr.lead.opt_out");
}

/** Record a lawful basis for contacting this lead (required before PRODUCTION). */
export async function recordConsent(
  id: string,
  basis: "OPT_IN" | "LEGITIMATE_INTEREST" | "EXISTING_RELATIONSHIP",
  note: string | null,
  actorId: string,
): Promise<void> {
  await prisma.salesLead.update({
    where: { id },
    data: { consentBasis: basis, consentNote: note },
  });
  await prisma.salesLeadEvent.create({
    data: { leadId: id, kind: "consent_recorded", actorId, data: { basis } },
  });
}

/** LGPD: hard-delete a lead and its data. */
export async function eraseLead(id: string, actorId: string): Promise<void> {
  const lead = await prisma.salesLead.findUnique({ where: { id } });
  if (!lead) return;
  // keep the suppression entries so we never contact them again
  for (const r of [lead.whatsapp, lead.phone, lead.email].filter(Boolean) as string[]) {
    await addSuppression(r, "erased", "lgpd_erasure");
  }
  await prisma.salesLead.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      actorType: "PLATFORM_ADMIN",
      actorId,
      action: "sdr.lead.erased",
      targetType: "SalesLead",
      targetId: id,
    },
  });
}

export async function assignLead(
  id: string,
  userId: string | null,
  actorId: string,
): Promise<void> {
  await prisma.salesLead.update({ where: { id }, data: { assignedToId: userId } });
  await prisma.salesLeadEvent.create({
    data: { leadId: id, kind: "assigned", actorId, data: { userId } },
  });
}
