import type { AppointmentStatus } from "@prisma/client";

/** Statuses whose appointments still occupy the barber's time. */
export const SLOT_HOLDING_STATUSES: AppointmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
];

/** Allowed status transitions (mirrors the DB overlap constraint's WHERE list). */
export const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ["CONFIRMED", "IN_PROGRESS", "CANCELED", "NO_SHOW"],
  CONFIRMED: ["IN_PROGRESS", "COMPLETED", "CANCELED", "NO_SHOW"],
  IN_PROGRESS: ["COMPLETED", "CANCELED"],
  COMPLETED: [],
  CANCELED: [],
  NO_SHOW: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const RESCHEDULABLE_STATUSES: AppointmentStatus[] = ["PENDING", "CONFIRMED"];
