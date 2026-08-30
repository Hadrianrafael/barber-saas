import "server-only";
import type { MessageChannel, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { segmentWhere, type SegmentId, type SegmentParams } from "@/features/crm/segments";
import { canContact } from "@/features/messaging/consent";
import { sendMessage } from "@/features/messaging/dispatch";

export interface CampaignAudience {
  segment: SegmentId;
  params?: SegmentParams;
}

export class CampaignError extends Error {
  code: "NOT_FOUND" | "INVALID_STATE" | "NO_RECIPIENTS";
  constructor(code: CampaignError["code"], m?: string) {
    super(m ?? code);
    this.name = "CampaignError";
    this.code = code;
  }
}

interface Actor {
  userId: string | null;
}

/**
 * Customers matching the audience that are also reachable for MARKETING on
 * `channel`. Marketing requires an explicit opt-in on every channel (this mirrors
 * `canContact(..., "marketing")`, which the worker re-checks per recipient), so
 * a campaign can never blast a customer who never opted in.
 */
function reachableWhere(
  channel: MessageChannel,
  base: Prisma.CustomerWhereInput,
): Prisma.CustomerWhereInput {
  const contactField = channel === "EMAIL" ? { email: { not: null } } : {}; // whatsapp/phone checked per-row in the worker
  return {
    AND: [
      base,
      { status: { not: "BLOCKED" }, anonymizedAt: null },
      contactField,
      {
        consents: {
          some: {
            channel: channel as "EMAIL" | "WHATSAPP" | "SMS",
            granted: true,
            revokedAt: null,
          },
        },
      },
    ],
  };
}

export async function estimateRecipients(
  tenantId: string,
  channel: MessageChannel,
  audience: CampaignAudience,
): Promise<number> {
  const base = segmentWhere(audience.segment, audience.params);
  return prisma.customer.count({ where: { tenantId, ...reachableWhere(channel, base) } });
}

export async function createCampaign(
  tenantId: string,
  input: {
    name: string;
    channel: MessageChannel;
    locale: string;
    subject?: string | null;
    body: string;
    audience: CampaignAudience;
  },
  actor: Actor,
) {
  return prisma.campaign.create({
    data: {
      tenantId,
      name: input.name,
      channel: input.channel,
      status: "DRAFT",
      locale: input.locale,
      subject: input.subject ?? null,
      body: input.body,
      audience: input.audience as unknown as object,
      createdById: actor.userId,
    },
  });
}

export function listCampaigns(tenantId: string) {
  return prisma.campaign.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export function getCampaign(tenantId: string, id: string) {
  return prisma.campaign.findFirst({ where: { id, tenantId } });
}

/** Move a DRAFT/SCHEDULED campaign to RUNNING and enqueue delivery. */
export async function launchCampaign(tenantId: string, id: string, _actor: Actor) {
  const c = await prisma.campaign.findFirst({ where: { id, tenantId } });
  if (!c) throw new CampaignError("NOT_FOUND");
  if (c.status !== "DRAFT" && c.status !== "SCHEDULED") throw new CampaignError("INVALID_STATE");

  const audience = c.audience as unknown as CampaignAudience;
  const total = await estimateRecipients(tenantId, c.channel, audience);
  if (total === 0) throw new CampaignError("NO_RECIPIENTS");

  await prisma.campaign.update({
    where: { id },
    data: { status: "RUNNING", startedAt: new Date(), totalRecipients: total },
  });

  const { campaignQueue } = await import("@/worker/queues");
  await campaignQueue.add("run", { campaignId: id, tenantId });
  logger.info({ tenantId, campaignId: id, total }, "campaign.launched");
  return { total };
}

export async function cancelCampaign(tenantId: string, id: string) {
  await prisma.campaign.updateMany({
    where: { id, tenantId, status: { in: ["DRAFT", "SCHEDULED", "RUNNING"] } },
    data: { status: "CANCELED" },
  });
}

// ---------------------------------------------------------------------------
// Worker-side delivery (called by src/worker/processors/campaign.ts)
// ---------------------------------------------------------------------------

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;
function render(template: string, vars: Record<string, string>): string {
  return template.replace(VAR_RE, (_, k: string) => vars[k.toLowerCase()] ?? "");
}

export async function deliverCampaign(
  campaignId: string,
): Promise<{ sent: number; failed: number }> {
  const c = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!c || c.status !== "RUNNING") return { sent: 0, failed: 0 };

  const tenant = await prisma.tenant.findUnique({
    where: { id: c.tenantId },
    select: { name: true, slug: true },
  });
  const audience = c.audience as unknown as CampaignAudience;
  const base = segmentWhere(audience.segment, audience.params);

  const bookingLink = `${env.APP_URL}/${c.locale}/barber/${tenant?.slug ?? ""}/book`;
  let sent = 0;
  let failed = 0;
  const PAGE = 200;
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.customer.findMany({
      where: { tenantId: c.tenantId, ...reachableWhere(c.channel, base) },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, name: true, email: true, phone: true, whatsapp: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    for (const cust of batch) {
      const allowed = await canContact(
        cust.id,
        c.channel as "EMAIL" | "WHATSAPP" | "SMS",
        "marketing",
      );
      if (!allowed.ok) {
        failed++;
        continue;
      }
      const to = c.channel === "EMAIL" ? cust.email : (cust.whatsapp ?? cust.phone);
      if (!to) {
        failed++;
        continue;
      }

      const last = await prisma.appointment.findFirst({
        where: { tenantId: c.tenantId, customerId: cust.id },
        orderBy: { startsAt: "desc" },
        select: { serviceName: true, employee: { select: { name: true } } },
      });
      const vars: Record<string, string> = {
        nome: cust.name,
        barbearia: tenant?.name ?? "",
        barbeiro: last?.employee.name ?? "",
        ultimo_servico: last?.serviceName ?? "",
        link_agendamento: bookingLink,
      };

      const msg = await sendMessage({
        tenantId: c.tenantId,
        customerId: cust.id,
        campaignId: c.id,
        channel: c.channel,
        category: "marketing",
        locale: c.locale,
        to,
        subject: c.subject ? render(c.subject, vars) : null,
        text: render(c.body, vars),
      });
      if (msg?.status === "SENT") sent++;
      else failed++;
    }

    await prisma.campaign.update({
      where: { id: c.id },
      data: { sentCount: sent, failedCount: failed },
    });
  }

  await prisma.campaign.update({
    where: { id: c.id },
    data: { status: "COMPLETED", completedAt: new Date(), sentCount: sent, failedCount: failed },
  });
  logger.info({ campaignId, sent, failed }, "campaign.delivered");
  return { sent, failed };
}
