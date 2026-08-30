import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness probe — no dependencies. If the process can answer this, it is alive;
 * a failing DB/Redis is a *readiness* concern (see `/api/health`), not a reason
 * for the orchestrator to restart the container.
 */
export function GET() {
  return NextResponse.json({ status: "alive" });
}
