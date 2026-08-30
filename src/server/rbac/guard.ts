import "server-only";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { forTenant, type TenantPrisma } from "@/server/db/tenant";
import { roleCan, type Permission } from "./permissions";
import type { MemberRole } from "@prisma/client";
import type { SessionContext } from "@/server/auth/session";

export class AuthorizationError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}
export class AuthenticationError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export interface TenantContext {
  session: SessionContext;
  tenantId: string;
  role: MemberRole;
  db: TenantPrisma;
  can: (permission: Permission) => boolean;
  assert: (permission: Permission) => void;
}

/**
 * The single entry point every tenant-scoped server action / route handler uses.
 * Throws if unauthenticated or not a member of the target tenant. Returns a
 * tenant-scoped Prisma client plus permission helpers.
 */
export async function requireTenantContext(opts?: {
  tenantId?: string;
  permission?: Permission;
}): Promise<TenantContext> {
  const session = await getAppSession();
  if (!session) throw new AuthenticationError();

  const active = resolveActiveTenant(session, opts?.tenantId);
  if (!active) throw new AuthorizationError("No tenant membership");

  const ctx: TenantContext = {
    session,
    tenantId: active.tenantId,
    role: active.role,
    db: forTenant(active.tenantId),
    can: (permission) => roleCan(active.role, permission),
    assert: (permission) => {
      if (!roleCan(active.role, permission)) {
        throw new AuthorizationError(`Missing permission: ${permission}`);
      }
    },
  };

  if (opts?.permission) ctx.assert(opts.permission);
  return ctx;
}
