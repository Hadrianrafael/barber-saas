import { Worker } from "bullmq";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { QUEUE_NAMES } from "./queues";

/**
 * Background worker entrypoint. Runs as its own Azure Container Apps container.
 * Concrete processors are added per slice (email → Slice 8, campaigns → Slice
 * 11, reminders → Slice 8, webhooks retry → Slice 5/6).
 */
const connection = redis;
const workers: Worker[] = [];

function register(name: string) {
  const w = new Worker(
    name,
    async (job) => {
      logger.info({ queue: name, jobId: job.id, kind: job.name }, "job.received");
      // TODO(slice-8+): dispatch to a per-queue processor module.
      return { skipped: true, reason: "no processor registered yet" };
    },
    { connection, concurrency: 5 },
  );
  w.on("failed", (job, err) => logger.error({ queue: name, jobId: job?.id, err }, "job.failed"));
  workers.push(w);
}

Object.values(QUEUE_NAMES).forEach(register);
logger.info({ queues: Object.values(QUEUE_NAMES) }, "worker.started");

async function shutdown(signal: string) {
  logger.info({ signal }, "worker.shutdown");
  await Promise.allSettled(workers.map((w) => w.close()));
  await redis.quit().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
