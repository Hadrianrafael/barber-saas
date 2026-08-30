import { z } from "zod";

/**
 * Plan limits + feature flags. Stored as `Plan.limits` JSON, validated here.
 * A limit of `0` means the feature/resource is off for that plan; a positive
 * number is a hard cap enforced server-side at action time.
 */
export const planLimitsSchema = z.object({
  maxEmployees: z.number().int().min(0).default(3),
  maxServices: z.number().int().min(0).default(20),
  maxCustomers: z.number().int().min(0).default(1000),
  maxMonthlyAppointments: z.number().int().min(0).default(400),
  maxMonthlyMessages: z.number().int().min(0).default(0),
  maxCampaignsPerMonth: z.number().int().min(0).default(0),
  maxUnits: z.number().int().min(1).default(1),
  whatsapp: z.boolean().default(false),
  chatbot: z.boolean().default(false),
  campaigns: z.boolean().default(false),
  loyalty: z.boolean().default(false),
});

export type PlanLimits = z.infer<typeof planLimitsSchema>;

/** Sane ceiling for a tenant that is still on the initial trial (no plan chosen). */
export const TRIAL_LIMITS: PlanLimits = planLimitsSchema.parse({
  maxEmployees: 3,
  maxServices: 20,
  maxCustomers: 500,
  maxMonthlyAppointments: 200,
});

export function parsePlanLimits(value: unknown): PlanLimits {
  const r = planLimitsSchema.safeParse(value ?? {});
  return r.success ? r.data : planLimitsSchema.parse({});
}

export type LimitedResource =
  | "employees"
  | "services"
  | "customers"
  | "appointmentsThisMonth"
  | "campaignsThisMonth"
  | "messagesThisMonth";

export type GatedFeature = "whatsapp" | "chatbot" | "campaigns" | "loyalty";
