import type { Prisma } from "@prisma/client";

/**
 * Reusable customer segmentation. Produces a Prisma `where` fragment (already
 * tenant-scoped by the caller) so the CRM list, campaign audiences (Slice 11)
 * and the chatbot (Slice 10) all segment identically.
 */
export type SegmentId =
  "all" | "active" | "inactive" | "new" | "recurring" | "by_service" | "by_employee" | "opted_in";

export interface SegmentParams {
  /** days without a visit that counts as "inactive" */
  inactiveDays?: number;
  /** days since creation that counts as "new" */
  newDays?: number;
  serviceId?: string;
  employeeId?: string;
  /** channel for the opted_in segment */
  channel?: "EMAIL" | "WHATSAPP" | "SMS";
}

export function segmentWhere(
  segment: SegmentId,
  params: SegmentParams = {},
): Prisma.CustomerWhereInput {
  const inactiveDays = params.inactiveDays ?? 90;
  const newDays = params.newDays ?? 30;
  const now = Date.now();
  const cutoff = (days: number) => new Date(now - days * 86_400_000);

  switch (segment) {
    case "all":
      return {};
    case "active":
      return { status: "ACTIVE", lastVisitAt: { gte: cutoff(inactiveDays) } };
    case "inactive":
      return {
        status: { not: "BLOCKED" },
        OR: [{ lastVisitAt: null }, { lastVisitAt: { lt: cutoff(inactiveDays) } }],
      };
    case "new":
      return { createdAt: { gte: cutoff(newDays) } };
    case "recurring":
      return { visitsCount: { gte: 2 } };
    case "by_service":
      return params.serviceId ? { appointments: { some: { serviceId: params.serviceId } } } : {};
    case "by_employee":
      return params.employeeId ? { appointments: { some: { employeeId: params.employeeId } } } : {};
    case "opted_in":
      return {
        consents: {
          some: { channel: params.channel ?? "WHATSAPP", granted: true, revokedAt: null },
        },
      };
    default:
      return {};
  }
}

export const SEGMENT_IDS: SegmentId[] = [
  "all",
  "active",
  "inactive",
  "new",
  "recurring",
  "by_service",
  "by_employee",
  "opted_in",
];
