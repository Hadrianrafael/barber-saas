import { z } from "zod";

/**
 * Per-tenant loyalty program config, persisted as `Tenant.loyaltyConfig` (JSON)
 * and validated here. Points are earned automatically when an appointment is
 * marked COMPLETED.
 */
export const loyaltyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Flat points for any completed visit. */
  pointsPerVisit: z.number().int().min(0).max(10_000).default(10),
  /** Extra points = floor(priceCents / pointsPerCurrencyCents). 0 disables the value-based bonus. */
  pointsPerCurrencyCents: z.number().int().min(0).max(1_000_000).default(0),
  /** 0 = points never expire. */
  pointsExpireDays: z.number().int().min(0).max(3650).default(0),
});

export type LoyaltyConfig = z.infer<typeof loyaltyConfigSchema>;
export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = loyaltyConfigSchema.parse({});

export function parseLoyaltyConfig(value: unknown): LoyaltyConfig {
  const r = loyaltyConfigSchema.safeParse(value ?? {});
  return r.success ? r.data : DEFAULT_LOYALTY_CONFIG;
}

/** Points a completed appointment earns. `serviceOverride` wins outright. */
export function pointsForVisit(
  cfg: LoyaltyConfig,
  priceCents: number,
  serviceOverride?: number | null,
): number {
  if (serviceOverride != null) return Math.max(0, serviceOverride);
  const value =
    cfg.pointsPerCurrencyCents > 0 ? Math.floor(priceCents / cfg.pointsPerCurrencyCents) : 0;
  return cfg.pointsPerVisit + value;
}
