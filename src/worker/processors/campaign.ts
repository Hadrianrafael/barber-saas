import type { Job } from "bullmq";
import { logger } from "@/lib/logger";

/**
 * Consumer for the `campaign` queue. Fully implemented in Slice 11
 * (import + campaigns). The queue + producer already exist so campaign
 * dispatch never runs in the web request path.
 */
export async function processCampaignJob(job: Job) {
  logger.warn({ jobId: job.id }, "campaign processor not implemented yet (Slice 11)");
  return { skipped: true };
}
