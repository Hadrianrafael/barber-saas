"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";
import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { hashPassword, verifyPassword, needsRehash } from "@/server/auth/password";
import { createSession, revokeAllUserSessions, revokeSession } from "@/server/auth/session";
import {
  APP_SESSION_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
} from "@/server/auth/cookies";
import { generateToken, hashToken } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { sendVerificationEmail, sendPasswordResetEmail } from "@/server/mail";
import {
  signUpSchema,
  signInSchema,
  requestResetSchema,
  resetPasswordSchema,
  resendVerificationSchema,
} from "./schema";

export interface ActionState {
  ok: boolean;
  /** message code — the client maps it to a localized string */
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: Record<string, unknown>;
}

const VERIFY_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const RESET_TTL_MS = 1000 * 60 * 60; // 1h

async function clientMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
}

function fieldErrorsFromZod(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------
export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { name, email, password, locale } = parsed.data;
  const { ip } = await clientMeta();

  const rl = await rateLimit(`signup:${ip ?? "unknown"}`, 5, 60 * 15);
  if (!rl.ok) return { ok: false, code: "rateLimited" };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Do not reveal which emails exist beyond what a signup form inherently does.
    return { ok: false, code: "emailTaken", fieldErrors: { email: "emailTaken" } };
  }

  const user = await prisma.user.create({
    data: { name, email, passwordHash: await hashPassword(password), locale },
  });

  const rawToken = generateToken(32);
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });

  const url = `${env.APP_URL}/${locale}/verify-email?token=${rawToken}`;
  await sendVerificationEmail(email, url, locale);
  logger.info({ userId: user.id }, "auth.signup");

  return { ok: true, code: "verifyPending", data: { email } };
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { email, password } = parsed.data;
  const locale = String(formData.get("locale") ?? env.APP_DEFAULT_LOCALE);
  const { ip, userAgent } = await clientMeta();

  const rlIp = await rateLimit(`signin:ip:${ip ?? "unknown"}`, 10, 60 * 10);
  const rlEmail = await rateLimit(`signin:email:${email}`, 5, 60 * 10);
  if (!rlIp.ok || !rlEmail.ok) return { ok: false, code: "rateLimited" };

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: true },
  });

  // Constant-ish work whether or not the user exists.
  const hash = user?.passwordHash ?? "$2a$12$0000000000000000000000000000000000000000000000000000";
  const passwordOk = await verifyPassword(password, hash);

  if (!user || !passwordOk) {
    logger.warn({ email, ip }, "auth.signin.invalid");
    return { ok: false, code: "invalidCredentials" };
  }
  if (user.disabledAt) return { ok: false, code: "accountDisabled" };
  if (!user.emailVerifiedAt) {
    return { ok: false, code: "emailNotVerified", data: { email } };
  }

  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
  }

  const { rawToken, expiresAt } = await createSession({
    userId: user.id,
    isAdminSession: false,
    ip,
    userAgent,
  });
  await setSessionCookie(APP_SESSION_COOKIE, rawToken, expiresAt);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  logger.info({ userId: user.id }, "auth.signin.ok");

  const target = user.memberships.length === 0 ? "onboarding" : "dashboard";
  redirect(`/${locale}/${target}`);
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------
export async function signOutAction(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? env.APP_DEFAULT_LOCALE);
  const token = await readSessionCookie(APP_SESSION_COOKIE);
  if (token) await revokeSession(token);
  await clearSessionCookie(APP_SESSION_COOKIE);
  redirect(`/${locale}/sign-in`);
}

// ---------------------------------------------------------------------------
// Password reset — request
// ---------------------------------------------------------------------------
export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = requestResetSchema.safeParse(Object.fromEntries(formData));
  const locale = String(formData.get("locale") ?? env.APP_DEFAULT_LOCALE);
  // Always return the same response — no account enumeration.
  const done: ActionState = { ok: true, code: "forgotDone" };
  if (!parsed.success) return done;

  const { email } = parsed.data;
  const { ip } = await clientMeta();
  const rl = await rateLimit(`reset:${ip ?? "unknown"}:${email}`, 3, 60 * 15);
  if (!rl.ok) return done;

  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.disabledAt) {
    const rawToken = generateToken(32);
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    const url = `${env.APP_URL}/${locale}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail(email, url, user.locale);
    logger.info({ userId: user.id }, "auth.reset.requested");
  }
  return done;
}

// ---------------------------------------------------------------------------
// Password reset — confirm
// ---------------------------------------------------------------------------
export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { token, password } = parsed.data;

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: "verifyInvalid" };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(password) },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);
  await revokeAllUserSessions(record.userId);
  logger.info({ userId: record.userId }, "auth.reset.done");

  return { ok: true, code: "resetDone" };
}

// ---------------------------------------------------------------------------
// Email verification — confirm + resend
// ---------------------------------------------------------------------------
export async function verifyEmailAction(token: string): Promise<ActionState> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: "verifyInvalid" };
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);
  logger.info({ userId: record.userId }, "auth.verify.ok");
  return { ok: true, code: "verifySuccess" };
}

export async function resendVerificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resendVerificationSchema.safeParse(Object.fromEntries(formData));
  const locale = String(formData.get("locale") ?? env.APP_DEFAULT_LOCALE);
  const done: ActionState = { ok: true, code: "verifyPending" };
  if (!parsed.success) return done;

  const { email } = parsed.data;
  const { ip } = await clientMeta();
  const rl = await rateLimit(`resend:${ip ?? "unknown"}:${email}`, 3, 60 * 15);
  if (!rl.ok) return { ok: false, code: "rateLimited" };

  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.emailVerifiedAt) {
    const rawToken = generateToken(32);
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
      },
    });
    const url = `${env.APP_URL}/${locale}/verify-email?token=${rawToken}`;
    await sendVerificationEmail(email, url, user.locale);
  }
  return { ...done, data: { email } };
}
