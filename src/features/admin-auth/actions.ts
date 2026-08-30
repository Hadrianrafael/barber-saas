"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "@/server/auth/password";
import { createSession, revokeSession } from "@/server/auth/session";
import {
  ADMIN_SESSION_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
} from "@/server/auth/cookies";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export interface AdminActionState {
  ok: boolean;
  error?: string;
}

export async function adminSignInAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Preencha e-mail e senha." };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await rateLimit(`admin-signin:${ip}`, 5, 60 * 10);
  if (!rl.ok) return { ok: false, error: "Muitas tentativas. Aguarde." };

  const user = await prisma.user.findUnique({ where: { email } });
  const hash = user?.passwordHash ?? "$2a$12$0000000000000000000000000000000000000000000000000000";
  const passwordOk = await verifyPassword(password, hash);

  if (!user || !passwordOk || !user.isPlatformAdmin || user.disabledAt) {
    logger.warn({ email, ip }, "admin.signin.denied");
    return { ok: false, error: "Credenciais inválidas." };
  }

  const { rawToken, expiresAt } = await createSession({
    userId: user.id,
    isAdminSession: true,
    ip,
    userAgent: h.get("user-agent"),
  });
  await setSessionCookie(ADMIN_SESSION_COOKIE, rawToken, expiresAt);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await prisma.auditLog.create({
    data: {
      actorType: "PLATFORM_ADMIN",
      actorId: user.id,
      actorLabel: user.email,
      action: "admin.signin",
      ip,
    },
  });
  logger.info({ userId: user.id }, "admin.signin.ok");
  redirect("/admin");
}

export async function adminSignOutAction(): Promise<void> {
  const token = await readSessionCookie(ADMIN_SESSION_COOKIE);
  if (token) await revokeSession(token);
  await clearSessionCookie(ADMIN_SESSION_COOKIE);
  redirect("/admin/sign-in");
}
