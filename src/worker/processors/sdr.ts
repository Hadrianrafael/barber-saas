import type { Job } from "bullmq";
import { logger } from "@/lib/logger";
import { processInbound, type InboundMessage } from "@/features/sdr/inbound";
import { retryOutbound } from "@/features/sdr/outbound";

/** Consumer for `sdr-inbound` — runs the transcribe → AI → qualify → reply pipeline. */
export async function processSdrInboundJob(job: Job) {
  const msg = job.data as InboundMessage;
  const res = await processInbound(msg);
  logger.info({ jobId: job.id, status: res.status, leadId: res.leadId }, "sdr.inbound.job_done");
  return res;
}

/** Consumer for `sdr-outbound` — retry a single failed outbound sales message. */
export async function processSdrOutboundJob(job: Job) {
  const { messageId } = job.data as { messageId: string };
  const res = await retryOutbound(messageId);
  return { ok: res.ok, error: res.error };
}
