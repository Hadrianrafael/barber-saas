import type { Job } from "bullmq";
import { logger } from "@/lib/logger";
import { deliverCampaign } from "@/features/campaigns/service";

/**
 * Consumer for the `campaign` queue. Delivery runs here (never in the web
 * request path): it pages through the audience, re-checks consent per recipient,
 * renders `{{nome}}` / `{{barbearia}}` / `{{barbeiro}}` / `{{ultimo_servico}}` /
 * `{{link_agendamento}}`, and dispatches one Message per recipient (which the
 * messaging retry job then follows up on). Idempotent-ish: a campaign not in
 * RUNNING is a no-op.
 */
export async function processCampaignJob(job: Job) {
  const { campaignId } = job.data as { campaignId: string };
  if (!campaignId) return { skipped: true };
  const res = await deliverCampaign(campaignId);
  logger.info({ jobId: job.id, campaignId, ...res }, "campaign.job_done");
  return res;
}
