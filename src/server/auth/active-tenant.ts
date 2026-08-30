import type { SessionContext } from "./session";
import type { MemberRole } from "@prisma/client";

/**
 * Pure resolution of which tenant + role the current request acts as.
 * Kept free of `server-only` so it is unit-testable in isolation.
 */
export function resolveActiveTenant(
  ctx: SessionContext,
  requestedTenantId?: string,
): { tenantId: string; role: MemberRole } | null {
  // A support session impersonating a tenant acts with OWNER power.
  if (ctx.impersonatedTenantId) {
    return { tenantId: ctx.impersonatedTenantId, role: "OWNER" };
  }
  if (ctx.memberships.length === 0) return null;

  if (requestedTenantId) {
    const m = ctx.memberships.find((x) => x.tenantId === requestedTenantId);
    return m ? { tenantId: m.tenantId, role: m.role } : null;
  }
  const first = ctx.memberships[0]!;
  return { tenantId: first.tenantId, role: first.role };
}
