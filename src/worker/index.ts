import { Worker, type Job } from "bullmq";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { QUEUE_NAMES } from "./queues";
import { processNotificationJob, processMessageJob } from "./processors/messaging";
import { processCampaignJob } from "./processors/campaign";
import { processSdrInboundJob, processSdrOutboundJob } from "./processors/sdr";

/**
 * Background worker — its own Azure Container Apps container. Consumes the
 * BullMQ queues; scheduled work (reminders, message retry, campaign dispatch)
 * runs as separate Container Apps cron jobs in src/worker/cron/*.
 */
const connection = redis;
const workers: Worker[] = [];

const HANDLERS: Record<string, (job: Job) => Promise<unknown>> = {
  [QUEUE_NAMES.notifications]: processNotificationJob,
  [QUEUE_NAMES.messages]: processMessageJob,
  [QUEUE_NAMES.campaign]: processCampaignJob,
  [QUEUE_NAMES.webhooks]: async (job) => {
    logger.warn({ jobId: job.id }, "webhooks queue has no processor yet");
    return { skipped: true };
  },
  [QUEUE_NAMES.sdrInbound]: processSdrInboundJob,
  [QUEUE_NAMES.sdrOutbound]: processSdrOutboundJob,
};

for (const [name, handler] of Object.entries(HANDLERS)) {
  const w = new Worker(name, handler, { connection, concurrency: 5 });
  w.on("failed", (job, err) =>
    logger.error(
      { queue: name, jobId: job?.id, attemptsMade: job?.attemptsMade, err },
      "job.failed",
    ),
  );
  w.on("completed", (job) => logger.debug({ queue: name, jobId: job.id }, "job.completed"));
  workers.push(w);
}
logger.info({ queues: Object.keys(HANDLERS) }, "worker.started");

async function shutdown(signal: string) {
  logger.info({ signal }, "worker.shutdown");
  await Promise.allSettled(workers.map((w) => w.close()));
  await redis.quit().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
