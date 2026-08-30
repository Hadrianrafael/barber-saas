-- Slice 4: CRM — customer tags, GDPR anonymization marker, extra indexes.
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "anonymizedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Customer_tenantId_createdAt_idx" ON "Customer"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Customer_tenantId_preferredEmployeeId_idx" ON "Customer"("tenantId", "preferredEmployeeId");
