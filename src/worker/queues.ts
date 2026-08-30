import { Queue } from "bullmq";
import { redis } from "@/lib/redis";

/**
 * Job queues (Azure Cache for Redis in prod). Producers import these from the
 * web app; the worker process (src/worker/index.ts) consumes them. Scheduled
 * jobs (reminders, campaign dispatch) are enqueued by an Azure Container Apps
 * cron job that calls an internal endpoint, or via BullMQ repeatable jobs.
 */
export const QUEUE_NAMES = {
  email: "email",
  whatsapp: "whatsapp",
  campaign: "campaign",
  reminders: "reminders",
  webhooks: "webhooks",
} as const;

const connection = redis;

export const emailQueue = new Queue(QUEUE_NAMES.email, { connection });
export const whatsappQueue = new Queue(QUEUE_NAMES.whatsapp, { connection });
export const campaignQueue = new Queue(QUEUE_NAMES.campaign, { connection });
export const remindersQueue = new Queue(QUEUE_NAMES.reminders, { connection });
export const webhooksQueue = new Queue(QUEUE_NAMES.webhooks, { connection });
