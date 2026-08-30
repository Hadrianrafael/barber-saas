import { describe, it, expect } from "vitest";
import { commissionForAppointmentCents } from "@/features/finance/commission";

describe("commissionForAppointmentCents", () => {
  it("PERCENT = round(price * bps / 10000)", () => {
    expect(
      commissionForAppointmentCents(
        { commissionType: "PERCENT", commissionBps: 3000, commissionFixedCents: 0 },
        7000,
      ),
    ).toBe(2100); // 30% of 70.00
    expect(
      commissionForAppointmentCents(
        { commissionType: "PERCENT", commissionBps: 3333, commissionFixedCents: 0 },
        4999,
      ),
    ).toBe(1666); // rounds
  });

  it("FIXED ignores the service price", () => {
    expect(
      commissionForAppointmentCents(
        { commissionType: "FIXED", commissionBps: 9999, commissionFixedCents: 1500 },
        99999,
      ),
    ).toBe(1500);
  });

  it("never negative", () => {
    expect(
      commissionForAppointmentCents(
        { commissionType: "PERCENT", commissionBps: -5, commissionFixedCents: 0 },
        5000,
      ),
    ).toBe(0);
  });
});
