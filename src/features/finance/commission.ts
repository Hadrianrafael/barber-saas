import type { CommissionType } from "@prisma/client";

export interface CommissionConfig {
  commissionType: CommissionType;
  commissionBps: number; // basis points of the service price (PERCENT)
  commissionFixedCents: number; // per completed appointment (FIXED)
}

/**
 * Commission earned by a barber for **one** completed appointment.
 * PERCENT → `round(price * bps / 10_000)`; FIXED → `commissionFixedCents`
 * (independent of the service price). Never negative.
 */
export function commissionForAppointmentCents(
  cfg: CommissionConfig,
  servicePriceCents: number,
): number {
  if (cfg.commissionType === "FIXED") {
    return Math.max(0, Math.round(cfg.commissionFixedCents));
  }
  const bps = Math.max(0, cfg.commissionBps);
  return Math.max(0, Math.round((servicePriceCents * bps) / 10_000));
}
