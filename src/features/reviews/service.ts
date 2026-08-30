import "server-only";
import { prisma } from "@/server/db/client";
import { hashToken } from "@/lib/crypto";
import { logger } from "@/lib/logger";

export class ReviewError extends Error {
  code: "NOT_FOUND" | "NOT_ELIGIBLE" | "ALREADY_REVIEWED" | "INVALID";
  constructor(code: ReviewError["code"], message?: string) {
    super(message ?? code);
    this.name = "ReviewError";
    this.code = code;
  }
}

/** Public: what the review page shows for a given appointment token. */
export async function getReviewContext(rawToken: string) {
  const appt = await prisma.appointment.findUnique({
    where: { publicToken: hashToken(rawToken) },
    select: {
      id: true,
      status: true,
      serviceName: true,
      startsAt: true,
      employee: { select: { name: true } },
      tenant: { select: { name: true, slug: true, locale: true } },
    },
  });
  if (!appt) return null;
  const existing = await prisma.review.findUnique({ where: { appointmentId: appt.id } });
  return {
    appointmentId: appt.id,
    eligible: appt.status === "COMPLETED",
    alreadyReviewed: !!existing,
    serviceName: appt.serviceName,
    barberName: appt.employee.name,
    startsAt: appt.startsAt.toISOString(),
    tenantName: appt.tenant.name,
    tenantSlug: appt.tenant.slug,
    locale: appt.tenant.locale,
    submittedRating: existing?.rating ?? null,
  };
}

export async function submitReview(rawToken: string, rating: number, comment: string | null) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ReviewError("INVALID");
  const appt = await prisma.appointment.findUnique({
    where: { publicToken: hashToken(rawToken) },
    select: { id: true, tenantId: true, customerId: true, employeeId: true, status: true },
  });
  if (!appt) throw new ReviewError("NOT_FOUND");
  if (appt.status !== "COMPLETED") throw new ReviewError("NOT_ELIGIBLE");

  const existing = await prisma.review.findUnique({ where: { appointmentId: appt.id } });
  if (existing) throw new ReviewError("ALREADY_REVIEWED");

  const review = await prisma.review.create({
    data: {
      tenantId: appt.tenantId,
      appointmentId: appt.id,
      customerId: appt.customerId,
      employeeId: appt.employeeId,
      rating,
      comment: comment?.trim().slice(0, 1000) || null,
      isPublished: false, // moderated before it shows on the public page
    },
  });
  logger.info({ tenantId: appt.tenantId, reviewId: review.id, rating }, "review.submitted");
  return review;
}

// ---- staff moderation -------------------------------------------------------

export async function listReviews(
  tenantId: string,
  opts: { published?: boolean; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, opts.pageSize ?? 20);
  const where = {
    tenantId,
    ...(opts.published === undefined ? {} : { isPublished: opts.published }),
  };
  const [raw, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { customer: { select: { name: true } } },
    }),
    prisma.review.count({ where }),
  ]);
  const empIds = [...new Set(raw.map((r) => r.employeeId).filter(Boolean) as string[])];
  const emps = empIds.length
    ? await prisma.employee.findMany({
        where: { id: { in: empIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(emps.map((e) => [e.id, e.name]));
  const rows = raw.map((r) => ({
    ...r,
    employee: r.employeeId ? { name: nameById.get(r.employeeId) ?? "—" } : null,
  }));
  return { rows, total, page, pageSize };
}

export async function setReviewPublished(tenantId: string, id: string, isPublished: boolean) {
  await prisma.review.updateMany({ where: { id, tenantId }, data: { isPublished } });
}

/** Overall + per-barber averages over published reviews. */
export async function ratingSummary(tenantId: string) {
  const [overall, perEmployee, employees] = await Promise.all([
    prisma.review.aggregate({
      where: { tenantId, isPublished: true },
      _avg: { rating: true },
      _count: true,
    }),
    prisma.review.groupBy({
      by: ["employeeId"],
      where: { tenantId, isPublished: true, employeeId: { not: null } },
      _avg: { rating: true },
      _count: true,
    }),
    prisma.employee.findMany({ where: { tenantId }, select: { id: true, name: true } }),
  ]);
  const nameById = new Map(employees.map((e) => [e.id, e.name]));
  return {
    overall: { avg: overall._avg.rating ?? 0, count: overall._count },
    perBarber: perEmployee
      .map((r) => ({
        employeeId: r.employeeId!,
        name: nameById.get(r.employeeId!) ?? "—",
        avg: r._avg.rating ?? 0,
        count: r._count,
      }))
      .sort((a, b) => b.avg - a.avg),
  };
}
