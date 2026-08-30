import { describe, it, expect } from "vitest";
import { roleCan } from "@/server/rbac/permissions";

describe("RBAC — team, services, scheduling (Slice 3)", () => {
  it("only OWNER/MANAGER manage the team", () => {
    expect(roleCan("OWNER", "employee.write")).toBe(true);
    expect(roleCan("MANAGER", "employee.write")).toBe(true);
    expect(roleCan("BARBER", "employee.write")).toBe(false);
  });

  it("BARBER may edit their own profile / time off", () => {
    expect(roleCan("BARBER", "employee.self.write")).toBe(true);
    expect(roleCan("BARBER", "employee.read")).toBe(true);
  });

  it("only OWNER/MANAGER manage the service catalogue", () => {
    expect(roleCan("OWNER", "service.write")).toBe(true);
    expect(roleCan("MANAGER", "service.write")).toBe(true);
    expect(roleCan("BARBER", "service.write")).toBe(false);
    expect(roleCan("BARBER", "service.read")).toBe(true);
  });

  it("BARBER manages appointments but not everyone's agenda", () => {
    expect(roleCan("BARBER", "appointment.write")).toBe(true);
    expect(roleCan("BARBER", "appointment.manageAll")).toBe(false);
    expect(roleCan("OWNER", "appointment.manageAll")).toBe(true);
    expect(roleCan("MANAGER", "appointment.manageAll")).toBe(true);
  });

  it("BARBER cannot touch admin/tenant settings", () => {
    expect(roleCan("BARBER", "tenant.settings.write")).toBe(false);
    expect(roleCan("BARBER", "tenant.billing.manage")).toBe(false);
  });
});
