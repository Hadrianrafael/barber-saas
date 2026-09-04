import { logger } from "@/lib/logger";
import { dispatchDueCampaigns } from "@/features/sdr/campaigns";
import { dueRetryMessages } from "@/features/sdr/outbound";
import { enqueueSdrOutboundRetry } from "@/worker/queues";

/**
 * Scheduled job (Azure Container Apps cron, every ~5 min). Two responsibilities:
 *
 *  1. Release paced campaign first-touches — `dispatchDueCampaigns` enforces the
 *     send window, per-campaign interval + jitter and daily cap, and emits at
 *     most one message per running campaign per tick. Never a blast.
 *  2. Re-queue FAILED outbound sales messages whose backoff has elapsed.
 *
 * All real sending still passes `assertContactable` (TEST MODE / suppression /
 * consent / global cap) downstream.
 */
export async function runSdrDispatch(now = new Date()): Promise<{
  campaigns: number;
  sent: number;
  skipped: number;
  retriesQueued: number;
}> {
  const tick = await dispatchDueCampaigns(now);

  let retriesQueued = 0;
  const due = await dueRetryMessages(100);
  for (const m of due) {
    await enqueueSdrOutboundRetry(m.id).catch((e) =>
      logger.warn({ err: (e as Error).message, messageId: m.id }, "sdr.dispatch.retry_enqueue_failed"),
    );
    retriesQueued += 1;
  }

  const res = { campaigns: tick.campaigns, sent: tick.sent, skipped: tick.skipped, retriesQueued };
  logger.info(res, "cron.sdr_dispatch.done");
  return res;
}

if (process.argv[1]?.endsWith("sdr-dispatch.ts") || process.argv[1]?.endsWith("sdr-dispatch.js")) {
  runSdrDispatch()
    .then((r) => {
      logger.info(r, "sdr-dispatch finished");
      process.exit(0);
    })
    .catch((e) => {
      logger.error({ err: e }, "sdr-dispatch failed");
      process.exit(1);
    });
}
