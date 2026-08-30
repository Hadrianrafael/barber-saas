import { describe, it, expect } from "vitest";
import { resolveActiveTenant } from "@/server/auth/active-tenant";
import type { SessionContext } from "@/server/auth/session";
import { slugify } from "@/lib/utils";

const base: SessionContext = {
  sessionId: "s1",
  userId: "u1",
  email: "a@b.com",
  name: "A",
  locale: "pt-BR",
  isPlatformAdmin: false,
  isAdminSession: false,
  impersonatedTenantId: null,
  memberships: [
    { tenantId: "t1", tenantSlug: "one", role: "OWNER" },
    { tenantId: "t2", tenantSlug: "two", role: "BARBER" },
  ],
};

describe("resolveActiveTenant", () => {
  it("defaults to the first membership", () => {
    expect(resolveActiveTenant(base)).toEqual({ tenantId: "t1", role: "OWNER" });
  });

  it("honours an explicit tenant the user belongs to", () => {
    expect(resolveActiveTenant(base, "t2")).toEqual({ tenantId: "t2", role: "BARBER" });
  });

  it("refuses a tenant the user does not belong to", () => {
    expect(resolveActiveTenant(base, "t999")).toBeNull();
  });

  it("gives an impersonating admin OWNER power over the target tenant", () => {
    const admin = { ...base, isPlatformAdmin: true, impersonatedTenantId: "t5", memberships: [] };
    expect(resolveActiveTenant(admin)).toEqual({ tenantId: "t5", role: "OWNER" });
  });

  it("returns null when there is no tenant at all", () => {
    expect(resolveActiveTenant({ ...base, memberships: [] })).toBeNull();
  });
});

describe("slugify", () => {
  it("normalises accents and spacing", () => {
    expect(slugify("Barbearia São João  ")).toBe("barbearia-sao-joao");
    expect(slugify("Corte & Barba!!")).toBe("corte-barba");
  });
});
