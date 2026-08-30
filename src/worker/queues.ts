import { Queue } from "bullmq";
import { redis } from "@/lib/redis";

/**
 * Job queues (Azure Cache for Redis in prod). Producers import these from the
 * web app; the worker process (src/worker/index.ts) consumes them. Scheduled
 * jobs (reminders, campaign dispatch, message retry) run as Azure Container
 * Apps cron jobs (src/worker/cron/*).
 */
export const QUEUE_NAMES = {
  notifications: "notifications",
  messages: "messages",
  campaign: "campaign",
  webhooks: "webhooks",
} as const;

const connection = redis;

export const notificationsQueue = new Queue(QUEUE_NAMES.notifications, { connection });
export const messagesQueue = new Queue(QUEUE_NAMES.messages, { connection });
export const campaignQueue = new Queue(QUEUE_NAMES.campaign, { connection });
export const webhooksQueue = new Queue(QUEUE_NAMES.webhooks, { connection });

const JOB_OPTS = {
  attempts: 4,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** Enqueue an appointment-triggered customer notification (non-blocking). */
export async function enqueueAppointmentNotification(
  appointmentId: string,
  key: string,
  extra?: Record<string, string>,
): Promise<void> {
  await notificationsQueue.add("appointment", { appointmentId, key, extra }, JOB_OPTS);
}

export async function enqueueMessageRetry(messageId: string): Promise<void> {
  await messagesQueue.add("retry", { messageId }, JOB_OPTS);
}
