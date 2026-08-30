import { describe, it, expect } from "vitest";
import { planLimitsSchema, parsePlanLimits, TRIAL_LIMITS } from "@/features/billing/plan-limits";

describe("plan limits", () => {
  it("fills sensible defaults", () => {
    const l = planLimitsSchema.parse({});
    expect(l.maxEmployees).toBe(3);
    expect(l.whatsapp).toBe(false);
    expect(l.maxUnits).toBe(1);
  });

  it("parsePlanLimits tolerates garbage", () => {
    expect(parsePlanLimits(null).maxEmployees).toBe(3);
    expect(parsePlanLimits("nope").chatbot).toBe(false);
    expect(parsePlanLimits({ maxEmployees: 10, whatsapp: true }).maxEmployees).toBe(10);
  });

  it("the trial ceiling is conservative", () => {
    expect(TRIAL_LIMITS.maxMonthlyAppointments).toBeLessThanOrEqual(400);
    expect(TRIAL_LIMITS.whatsapp).toBe(false);
    expect(TRIAL_LIMITS.campaigns).toBe(false);
  });

  it("rejects negatives", () => {
    expect(planLimitsSchema.safeParse({ maxEmployees: -1 }).success).toBe(false);
  });
});
