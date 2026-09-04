import "server-only";
import type { SalesCampaign } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { campaignCreateSchema } from "./schema";
import { getActiveAgentConfig, listAgentConfigs, localeContent } from "./agent-config";
import { renderTemplate } from "./conversation";
import { sendOutbound } from "./outbound";

/**
 * Campaign = a paced sequence of first-touch messages to a chosen set of leads.
 * Never a blast: the `sdr-dispatch` cron ticks every few minutes and releases at
 * most one message per campaign per tick, and only when
 *   - the current local time is inside [windowStartMin, windowEndMin] on an
 *     allowed weekday (campaign timezone),
 *   - at least `minIntervalSec` (± jitter) elapsed since the last dispatch,
 *   - the per-campaign `dailyCap` is not yet reached.
 * Per-recipient consent / TEST-MODE / suppression / global cap are enforced
 * downstream by `sendOutbound` → `assertContactable`.
 */

export async function listCampaigns() {
  return prisma.salesCampaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { leads: true, messages: true } } },
  });
}

export async function getCampaign(id: string) {
  return prisma.salesCampaign.findUnique({
    where: { id },
    include: {
      agentConfig: true,
      _count: { select: { leads: true, messages: true } },
    },
  });
}

export async function createCampaign(input: unknown, actorId: string): Promise<SalesCampaign> {
  const data = campaignCreateSchema.parse(input);
  if (data.windowEndMin <= data.windowStartMin) {
    throw new Error("windowEndMin must be after windowStartMin");
  }
  return prisma.salesCampaign.create({
    data: {
      name: data.name,
      channel: data.channel,
      firstTouch: data.firstTouch,
      locale: data.locale,
      agentConfigId: data.agentConfigId ?? null,
      dailyCap: data.dailyCap,
      minIntervalSec: data.minIntervalSec,
      jitterPct: data.jitterPct,
      windowStartMin: data.windowStartMin,
      windowEndMin: data.windowEndMin,
      sendDays: data.sendDays,
      timezone: data.timezone,
      templateName: data.templateName ?? null,
      status: "DRAFT",
      mode: "TEST",
      createdById: actorId,
    },
  });
}

export async function addLeadsToCampaign(
  campaignId: string,
  leadIds: string[],
): Promise<{ added: number }> {
  const existing = new Set(
    (
      await prisma.salesCampaignLead.findMany({
        where: { campaignId, leadId: { in: leadIds } },
        select: { leadId: true },
      })
    ).map((r) => r.leadId),
  );
  const fresh = leadIds.filter((id) => !existing.has(id));
  if (fresh.length) {
    await prisma.salesCampaignLead.createMany({
      data: fresh.map((leadId) => ({ campaignId, leadId })),
      skipDuplicates: true,
    });
  }
  await refreshCampaignTotals(campaignId);
  return { added: fresh.length };
}

export async function removeLeadFromCampaign(campaignId: string, leadId: string): Promise<void> {
  await prisma.salesCampaignLead.deleteMany({ where: { campaignId, leadId, state: "PENDING" } });
  await refreshCampaignTotals(campaignId);
}

async function refreshCampaignTotals(campaignId: string): Promise<void> {
  const total = await prisma.salesCampaignLead.count({ where: { campaignId } });
  await prisma.salesCampaign.update({ where: { id: campaignId }, data: { totalLeads: total } });
}

export async function startCampaign(id: string): Promise<void> {
  await prisma.salesCampaign.update({
    where: { id },
    data: { status: "RUNNING", startedAt: new Date(), pausedAt: null },
  });
  logger.info({ campaignId: id }, "sdr.campaign.started");
}

export async function pauseCampaign(id: string): Promise<void> {
  await prisma.salesCampaign.update({
    where: { id },
    data: { status: "PAUSED", pausedAt: new Date() },
  });
}

export async function resumeCampaign(id: string): Promise<void> {
  await prisma.salesCampaign.update({ where: { id }, data: { status: "RUNNING", pausedAt: null } });
}

export async function setCampaignMode(id: string, mode: "TEST" | "PRODUCTION"): Promise<void> {
  await prisma.salesCampaign.update({ where: { id }, data: { mode } });
}

// --- pacing / dispatch --------------------------------------------------

/** Local weekday (0=Sun..6=Sat) and minute-of-day for a timezone. */
export function localWindow(now: Date, timezone: string): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const wdName = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: map[wdName] ?? 1, minutes: (hour % 24) * 60 + minute };
}

function withinWindow(c: SalesCampaign, now: Date): boolean {
  const { weekday, minutes } = localWindow(now, c.timezone);
  if (!c.sendDays.includes(weekday)) return false;
  return minutes >= c.windowStartMin && minutes <= c.windowEndMin;
}

function intervalElapsed(c: SalesCampaign, now: Date): boolean {
  if (!c.lastDispatchAt) return true;
  const jitter = 1 + ((Math.random() * 2 - 1) * c.jitterPct) / 100;
  const needMs = Math.max(5, c.minIntervalSec * jitter) * 1000;
  return now.getTime() - c.lastDispatchAt.getTime() >= needMs;
}

async function sentTodayForCampaign(campaignId: string): Promise<number> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  return prisma.salesCampaignLead.count({
    where: { campaignId, state: "SENT", sentAt: { gte: since } },
  });
}

/** First-touch copy for a campaign, from the (active) agent config for its locale. */
async function firstTouchText(c: SalesCampaign): Promise<string> {
  const cfg = c.agentConfigId
    ? ((await prisma.salesAgentConfig.findUnique({ where: { id: c.agentConfigId } })) ??
      (await getActiveAgentConfig()))
    : await getActiveAgentConfig();
  const content = localeContent(cfg, c.locale);
  const parts = [content.greeting, content.intro].filter(Boolean) as string[];
  return renderTemplate(parts.join(" "), {
    assistente: cfg.assistantName,
    empresa: cfg.companyName,
  });
}

export interface DispatchTickResult {
  campaigns: number;
  sent: number;
  skipped: number;
  details: { campaignId: string; action: string; leadId?: string; reason?: string }[];
}

/** One dispatch tick. Called by the `sdr-dispatch` cron. Releases ≤1 msg/campaign. */
export async function dispatchDueCampaigns(now = new Date()): Promise<DispatchTickResult> {
  const running = await prisma.salesCampaign.findMany({ where: { status: "RUNNING" } });
  const out: DispatchTickResult = { campaigns: running.length, sent: 0, skipped: 0, details: [] };

  for (const c of running) {
    if (!withinWindow(c, now)) {
      out.skipped++;
      out.details.push({ campaignId: c.id, action: "skip", reason: "outside_window" });
      continue;
    }
    if (!intervalElapsed(c, now)) {
      out.skipped++;
      out.details.push({ campaignId: c.id, action: "skip", reason: "interval" });
      continue;
    }
    if ((await sentTodayForCampaign(c.id)) >= c.dailyCap) {
      out.skipped++;
      out.details.push({ campaignId: c.id, action: "skip", reason: "daily_cap" });
      continue;
    }

    const next = await prisma.salesCampaignLead.findFirst({
      where: { campaignId: c.id, state: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { lead: true },
    });
    if (!next) {
      await prisma.salesCampaign.update({
        where: { id: c.id },
        data: { status: "COMPLETED", completedAt: now },
      });
      out.details.push({ campaignId: c.id, action: "completed" });
      continue;
    }

    const text = c.templateName ? "" : await firstTouchText(c);
    const res = await sendOutbound({
      lead: next.lead,
      channel: c.channel === "EMAIL" ? "EMAIL" : "WHATSAPP",
      kind: c.firstTouch === "AUDIO" && c.channel !== "EMAIL" ? "AUDIO" : "TEXT",
      text: text || "Olá! Sou consultor(a) e queria falar rapidamente sobre a sua barbearia.",
      campaignId: c.id,
      advanceStatusTo: "ABORDADO",
    });

    await prisma.salesCampaignLead.update({
      where: { id: next.id },
      data: res.ok
        ? { state: "SENT", sentAt: now }
        : { state: "FAILED", skippedReason: res.blockedReason ?? res.error ?? "send_failed" },
    });
    await prisma.salesCampaign.update({
      where: { id: c.id },
      data: {
        lastDispatchAt: now,
        sentCount: res.ok ? { increment: 1 } : undefined,
        failedCount: res.ok ? undefined : { increment: 1 },
      },
    });

    if (res.ok) {
      out.sent++;
      out.details.push({ campaignId: c.id, action: "sent", leadId: next.leadId });
    } else {
      out.skipped++;
      out.details.push({
        campaignId: c.id,
        action: "send_failed",
        leadId: next.leadId,
        reason: res.blockedReason ?? res.error,
      });
    }
  }

  logger.info({ ...out, details: undefined }, "sdr.dispatch.tick");
  return out;
}

export { listAgentConfigs };
