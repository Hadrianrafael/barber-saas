import type { Job } from "bullmq";
import { logger } from "@/lib/logger";
import { notifyAppointment } from "@/features/messaging/notify";
import { attemptSend } from "@/features/messaging/dispatch";
import type { TemplateKey } from "@/features/messaging/templates";

/** Consumer for the `notifications` queue — appointment-triggered messages. */
export async function processNotificationJob(job: Job) {
  const { appointmentId, key, extra } = job.data as {
    appointmentId: string;
    key: TemplateKey;
    extra?: Record<string, string>;
  };
  const res = await notifyAppointment(appointmentId, key, extra ?? {});
  logger.info({ appointmentId, key, sent: res.sent }, "worker.notification.done");
  return res;
}

/** Consumer for the `messages` queue — a single message (re)send attempt. */
export async function processMessageJob(job: Job) {
  const { messageId } = job.data as { messageId: string };
  const m = await attemptSend(messageId);
  return { status: m?.status };
}
