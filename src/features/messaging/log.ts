import "server-only";
import type { MessageChannel, MessageStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";

export async function listMessages(
  tenantId: string,
  opts: {
    channel?: MessageChannel;
    status?: MessageStatus;
    direction?: "OUTBOUND" | "INBOUND";
    page?: number;
    pageSize?: number;
  } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, opts.pageSize ?? 30);
  const where = {
    tenantId,
    ...(opts.channel ? { channel: opts.channel } : {}),
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.direction ? { direction: opts.direction } : {}),
  };
  const [total, rows, counts] = await Promise.all([
    prisma.message.count({ where }),
    prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        channel: true,
        direction: true,
        status: true,
        category: true,
        templateKey: true,
        toAddress: true,
        subject: true,
        body: true,
        locale: true,
        error: true,
        attempts: true,
        sentAt: true,
        deliveredAt: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.message.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: true,
    }),
  ]);
  return {
    total,
    page,
    pages: Math.ceil(total / pageSize),
    rows,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  };
}
