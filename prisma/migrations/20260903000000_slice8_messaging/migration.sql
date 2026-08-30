-- Slice 8: messaging — message metadata + retry, appointment reminder marker.
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "templateKey" TEXT,
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'transactional',
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Message_provider_providerMessageId_key" ON "Message"("provider", "providerMessageId");
CREATE INDEX IF NOT EXISTS "Message_tenantId_createdAt_idx" ON "Message"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_status_nextAttemptAt_idx" ON "Message"("status", "nextAttemptAt");

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);
