"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireAdminSession } from "@/server/auth/current-user";
import { createSession, revokeSession } from "@/server/auth/session";
import {
  APP_SESSION_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
} from "@/server/auth/cookies";
import { logger } from "@/lib/logger";
import { pickImpersonationTarget } from "./service";

/**
 * Start impersonating a tenant. Creates a SHORT, NON-admin app session for the
 * admin's own user with `impersonatedTenantId` set — `resolveActiveTenant` then
 * grants OWNER power on that tenant only. Always audited. The admin session
 * cookie is untouched, so "exit" returns straight to /admin.
 */
export async function impersonateTenantAction(fd: FormData): Promise<void> {
  const admin = await requireAdminSession();
  const tenantId = String(fd.get("tenantId") ?? "");
  if (!tenantId) redirect("/admin/tenants");

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) redirect("/admin/tenants");

  const target = await pickImpersonationTarget(tenantId);
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // Revoke any existing app session on this browser first.
  const existing = await readSessionCookie(APP_SESSION_COOKIE);
  if (existing) await revokeSession(existing);

  const { rawToken, expiresAt } = await createSession({
    userId: admin.userId,
    isAdminSession: false,
    impersonatedTenantId: tenantId,
    ip,
    userAgent: h.get("user-agent"),
  });
  await setSessionCookie(APP_SESSION_COOKIE, rawToken, expiresAt);

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorType: "PLATFORM_ADMIN",
      actorId: admin.userId,
      actorLabel: admin.email,
      action: "admin.impersonation.start",
      targetType: "Tenant",
      targetId: tenantId,
      ip,
      metadata: { impersonatedUserEmail: target?.user.email ?? null },
    },
  });
  logger.warn({ adminId: admin.userId, tenantId }, "admin.impersonation.start");
  redirect("/pt-BR/dashboard");
}

/** Called from the impersonation banner inside the tenant app. */
export async function stopImpersonationAction(): Promise<void> {
  const token = await readSessionCookie(APP_SESSION_COOKIE);
  if (token) await revokeSession(token);
  await clearSessionCookie(APP_SESSION_COOKIE);
  await prisma.auditLog
    .create({
      data: {
        actorType: "PLATFORM_ADMIN",
        action: "admin.impersonation.stop",
      },
    })
    .catch(() => undefined);
  redirect("/admin");
}
