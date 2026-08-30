import "server-only";
import { headers } from "next/headers";
import { logger } from "./logger";

/**
 * Per-request correlation id. `middleware.ts` stamps `x-request-id` on every
 * request (echoing an inbound value from the Azure ingress / load balancer when
 * present) and mirrors it onto the response. Server Components, Server Actions
 * and route handlers read it here for correlated structured logs.
 */
export async function getRequestId(): Promise<string | null> {
  try {
    return (await headers()).get("x-request-id");
  } catch {
    return null; // outside a request scope (e.g. worker, scripts)
  }
}

/** A logger bound to the current request id, for use inside a request scope. */
export async function reqLog() {
  const id = await getRequestId();
  return id ? logger.child({ requestId: id }) : logger;
}
