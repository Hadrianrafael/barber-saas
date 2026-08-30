import { logger } from "@/lib/logger";
import { retryDueMessages } from "@/features/messaging/dispatch";

/** Scheduled job (e.g. every 5 min): retry FAILED messages whose backoff elapsed. */
export async function runMessageRetry(): Promise<{ retried: number }> {
  const retried = await retryDueMessages(200);
  logger.info({ retried }, "cron.retry_messages.done");
  return { retried };
}

if (process.argv[1]?.includes("retry-messages")) {
  runMessageRetry()
    .then(() => process.exit(0))
    .catch((e) => {
      logger.error({ err: e }, "retry-messages failed");
      process.exit(1);
    });
}
