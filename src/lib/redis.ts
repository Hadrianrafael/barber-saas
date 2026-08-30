import Redis from "ioredis";
import { env } from "@/env";

/**
 * Shared Redis connection (Azure Cache for Redis in production).
 * Used for: session cache, rate limiting, and the BullMQ job queue.
 */
declare global {
  var __redis: Redis | undefined;
}

export const redis =
  globalThis.__redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: true,
    // Connect on first command, not at import — keeps `next build` (no Redis
    // running) quiet and avoids a live connection in statically rendered paths.
    lazyConnect: true,
  });

if (env.NODE_ENV !== "production") globalThis.__redis = redis;

let loggedRedisError = false;
redis.on("error", (err) => {
  // Don't crash the app on transient Redis errors; features degrade gracefully.
  if (!loggedRedisError) {
    loggedRedisError = true;
    console.error("[redis] connection error (suppressing further):", err.message);
  }
});
