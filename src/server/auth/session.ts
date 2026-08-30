import "server-only";
import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { generateToken, hashToken } from "@/lib/crypto";
import { redis } from "@/lib/redis";
import type { MemberRole } from "@prisma/client";

/**
 * Opaque server-side sessions (see docs/adr/0002-auth-approach.md).
 * The cookie carries a random token; only its SHA-256 hash is stored. Session
 * lookups are Redis-cached for a few seconds to keep request latency low while
 * staying instantly revocable (revoke = delete row + bust cache).
 */

export interface SessionContext {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  locale: string;
  isPlatformAdmin: boolean;
  isAdminSession: boolean;
  impersonatedTenantId: string | null;
  memberships: { tenantId: string; tenantSlug: string; role: MemberRole }[];
}

const CACHE_TTL_SECONDS = 10;

interface CreateSessionInput {
  userId: string;
  isAdminSession?: boolean;
  impersonatedTenantId?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}

export async function createSession(input: CreateSessionInput): Promise<{
  rawToken: string;
  expiresAt: Date;
}> {
  const rawToken = generateToken(32);
  const ttl = input.isAdminSession ? env.ADMIN_SESSION_TTL_SECONDS : env.SESSION_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  await prisma.session.create({
    data: {
      tokenHash: hashToken(rawToken),
      userId: input.userId,
      isAdminSession: input.isAdminSession ?? false,
      impersonatedTenantId: input.impersonatedTenantId ?? null,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
      expiresAt,
    },
  });

  return { rawToken, expiresAt };
}

export async function resolveSession(rawToken: string): Promise<SessionContext | null> {
  const tokenHash = hashToken(rawToken);
  const cacheKey = `sess:${tokenHash}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached === "__invalid__") return null;
    if (cached) return JSON.parse(cached) as SessionContext;
  } catch {
    /* cache miss / redis down — fall through to DB */
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          memberships: { include: { tenant: { select: { slug: true } } } },
        },
      },
    },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt.getTime() < Date.now() ||
    session.user.disabledAt
  ) {
    try {
      await redis.set(cacheKey, "__invalid__", "EX", CACHE_TTL_SECONDS);
    } catch {
      /* ignore */
    }
    return null;
  }

  const ctx: SessionContext = {
    sessionId: session.id,
    userId: session.userId,
    email: session.user.email,
    name: session.user.name,
    locale: session.user.locale,
    isPlatformAdmin: session.user.isPlatformAdmin,
    isAdminSession: session.isAdminSession,
    impersonatedTenantId: session.impersonatedTenantId,
    memberships: session.user.memberships.map((m) => ({
      tenantId: m.tenantId,
      tenantSlug: m.tenant.slug,
      role: m.role,
    })),
  };

  try {
    await redis.set(cacheKey, JSON.stringify(ctx), "EX", CACHE_TTL_SECONDS);
  } catch {
    /* ignore */
  }

  // Best-effort last-seen bump (fire and forget).
  void prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);

  return ctx;
}

export async function revokeSession(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await prisma.session
    .updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
  try {
    await redis.del(`sess:${tokenHash}`);
  } catch {
    /* ignore */
  }
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
