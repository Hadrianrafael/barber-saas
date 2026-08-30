import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { parseBookingConfig } from "@/features/tenant/booking-config";
import { enqueueAppointmentNotification } from "@/worker/queues";

/**
 * Scheduled job (Azure Container Apps cron, e.g. every 15 min). Finds
 * appointments whose start is within the reminder window and enqueues a
 * reminder notification exactly once (guarded by `Appointment.reminderSentAt`).
 *
 * Reminder lead time defaults to 24h; tenants can tune it via
 * `bookingConfig.reminderLeadHours` (added lazily — falls back to 24).
 */
export async function runReminders(now = new Date()): Promise<{ enqueued: number }> {
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    select: { id: true, bookingConfig: true },
  });

  let enqueued = 0;
  for (const t of tenants) {
    const cfg = parseBookingConfig(t.bookingConfig) as { reminderLeadHours?: number };
    const leadH = Math.min(72, Math.max(1, Number(cfg.reminderLeadHours) || 24));
    const windowStart = new Date(now.getTime() + (leadH - 0.5) * 3_600_000);
    const windowEnd = new Date(now.getTime() + (leadH + 0.5) * 3_600_000);

    const due = await prisma.appointment.findMany({
      where: {
        tenantId: t.id,
        status: { in: ["PENDING", "CONFIRMED"] },
        reminderSentAt: null,
        startsAt: { gte: windowStart, lt: windowEnd },
      },
      select: { id: true },
      take: 500,
    });

    for (const a of due) {
      await prisma.appointment.update({
        where: { id: a.id },
        data: { reminderSentAt: new Date() },
      });
      await enqueueAppointmentNotification(a.id, "appointment_reminder").catch((e) =>
        logger.warn({ err: (e as Error).message, appointmentId: a.id }, "reminder.enqueue_failed"),
      );
      enqueued += 1;
    }
  }
  logger.info({ enqueued }, "cron.reminders.done");
  return { enqueued };
}

if (process.argv[1]?.endsWith("reminders.ts") || process.argv[1]?.endsWith("reminders.js")) {
  runReminders()
    .then((r) => {
      logger.info(r, "reminders finished");
      process.exit(0);
    })
    .catch((e) => {
      logger.error({ err: e }, "reminders failed");
      process.exit(1);
    });
}
