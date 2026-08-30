import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/** Liveness/readiness probe for Azure Container Apps. */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = { app: "ok" };
  let status = 200;

  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 2000);
    checks.database = "ok";
  } catch {
    checks.database = "fail";
    status = 503;
  }

  try {
    await withTimeout(redis.ping(), 1000);
    checks.redis = "ok";
  } catch {
    checks.redis = "fail";
    // Redis is non-critical for liveness; degrade but stay up.
  }

  return NextResponse.json({ status: status === 200 ? "healthy" : "degraded", checks }, { status });
}
