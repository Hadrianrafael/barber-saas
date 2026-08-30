import { redis } from "./redis";

/**
 * Fixed-window rate limiter backed by Redis.
 * Fails OPEN (allows the request) if Redis is unavailable — availability of the
 * app is preferred over hard-blocking during a cache outage; abuse windows are
 * short. Auth-critical paths additionally rely on account lockouts.
 */
export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetSeconds: number;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }
    const ttl = await redis.ttl(redisKey);
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      resetSeconds: ttl < 0 ? windowSeconds : ttl,
    };
  } catch {
    return { ok: true, remaining: limit, resetSeconds: windowSeconds };
  }
}
