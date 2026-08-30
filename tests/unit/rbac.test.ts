import { describe, it, expect } from "vitest";
import { roleCan } from "@/server/rbac/permissions";

describe("RBAC permission matrix", () => {
  it("OWNER can manage billing, MANAGER cannot", () => {
    expect(roleCan("OWNER", "tenant.billing.manage")).toBe(true);
    expect(roleCan("MANAGER", "tenant.billing.manage")).toBe(false);
    expect(roleCan("MANAGER", "tenant.billing.read")).toBe(true);
  });

  it("BARBER is read-mostly and cannot delete customers or manage all agendas", () => {
    expect(roleCan("BARBER", "customer.read")).toBe(true);
    expect(roleCan("BARBER", "customer.delete")).toBe(false);
    expect(roleCan("BARBER", "appointment.manageAll")).toBe(false);
    expect(roleCan("BARBER", "finance.read")).toBe(false);
  });

  it("only OWNER manages members and payouts", () => {
    expect(roleCan("OWNER", "tenant.members.manage")).toBe(true);
    expect(roleCan("MANAGER", "tenant.members.manage")).toBe(false);
    expect(roleCan("OWNER", "payout.manage")).toBe(true);
    expect(roleCan("MANAGER", "payout.manage")).toBe(false);
  });
});
