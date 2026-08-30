import { describe, it, expect } from "vitest";
import { mapAccountStatus } from "@/features/payments/connect";

describe("mapAccountStatus", () => {
  it("ENABLED when charges + payouts are on and nothing is due", () => {
    expect(mapAccountStatus({ chargesEnabled: true, payoutsEnabled: true, requirements: {} })).toBe(
      "ENABLED",
    );
  });
  it("PENDING_VERIFICATION when requirements are currently/past due", () => {
    expect(
      mapAccountStatus({
        chargesEnabled: false,
        payoutsEnabled: false,
        requirements: { currently_due: ["individual.id_number"] },
      }),
    ).toBe("PENDING_VERIFICATION");
  });
  it("DISABLED when rejected, RESTRICTED for other disabled reasons", () => {
    expect(
      mapAccountStatus({
        chargesEnabled: false,
        payoutsEnabled: false,
        requirements: { disabled_reason: "rejected.fraud" },
      }),
    ).toBe("DISABLED");
    expect(
      mapAccountStatus({
        chargesEnabled: false,
        payoutsEnabled: false,
        requirements: { disabled_reason: "requirements.past_due" },
      }),
    ).toBe("RESTRICTED");
  });
  it("ONBOARDING otherwise", () => {
    expect(
      mapAccountStatus({ chargesEnabled: false, payoutsEnabled: false, requirements: {} }),
    ).toBe("ONBOARDING");
  });
});
