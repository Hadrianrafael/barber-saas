import "server-only";
import { prisma } from "@/server/db/client";

/**
 * Dashboard aggregates for the SDR module. All platform-scoped (no tenant).
 * `sinceDays` windows the time-bounded counters; lifetime totals ignore it.
 */

export interface SdrMetrics {
  leads: {
    total: number;
    byStatus: Record<string, number>;
    byQualification: Record<string, number>;
    imported: number;
    optOut: number;
  };
  conversations: { open: number; withHuman: number; total: number };
  messages: { outbound: number; inbound: number; failed: number; audioOut: number };
  campaigns: { running: number; draft: number; completed: number };
  cost: { aiMicroUsd: number; estUsd: number };
  window: { sinceDays: number };
}

export async function getSdrMetrics(sinceDays = 30): Promise<SdrMetrics> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const [
    total,
    statusGroups,
    qualGroups,
    imported,
    optOut,
    convOpen,
    convHuman,
    convTotal,
    outbound,
    inbound,
    failed,
    audioOut,
    campRunning,
    campDraft,
    campCompleted,
    costAgg,
  ] = await Promise.all([
    prisma.salesLead.count(),
    prisma.salesLead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.salesLead.groupBy({ by: ["qualification"], _count: { _all: true } }),
    prisma.salesLead.count({ where: { importId: { not: null } } }),
    prisma.salesLead.count({ where: { status: "OPT_OUT" } }),
    prisma.salesConversation.count({ where: { status: "OPEN" } }),
    prisma.salesConversation.count({ where: { handledBy: "HUMAN" } }),
    prisma.salesConversation.count(),
    prisma.salesMessage.count({ where: { direction: "OUTBOUND", createdAt: { gte: since } } }),
    prisma.salesMessage.count({ where: { direction: "INBOUND", createdAt: { gte: since } } }),
    prisma.salesMessage.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
    prisma.salesMessage.count({
      where: { direction: "OUTBOUND", kind: "AUDIO", createdAt: { gte: since } },
    }),
    prisma.salesCampaign.count({ where: { status: "RUNNING" } }),
    prisma.salesCampaign.count({ where: { status: "DRAFT" } }),
    prisma.salesCampaign.count({ where: { status: "COMPLETED" } }),
    prisma.salesMessage.aggregate({
      _sum: { costMicroUsd: true },
      where: { createdAt: { gte: since } },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const g of statusGroups) byStatus[g.status] = g._count._all;
  const byQualification: Record<string, number> = {};
  for (const g of qualGroups) byQualification[g.qualification ?? "NENHUMA"] = g._count._all;

  const aiMicroUsd = costAgg._sum.costMicroUsd ?? 0;

  return {
    leads: { total, byStatus, byQualification, imported, optOut },
    conversations: { open: convOpen, withHuman: convHuman, total: convTotal },
    messages: { outbound, inbound, failed, audioOut },
    campaigns: { running: campRunning, draft: campDraft, completed: campCompleted },
    cost: { aiMicroUsd, estUsd: Math.round(aiMicroUsd / 10_000) / 100 },
    window: { sinceDays },
  };
}
