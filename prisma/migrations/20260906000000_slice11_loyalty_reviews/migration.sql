-- Slice 11: loyalty program (config + rewards + points ledger).
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "loyaltyConfig" JSONB;
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "loyaltyPoints" INTEGER;

CREATE TABLE IF NOT EXISTS "LoyaltyReward" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "pointsCost" INTEGER NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'discount',
  "amountOffCents" INTEGER,
  "percentOff" INTEGER,
  "serviceId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoyaltyReward_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LoyaltyReward_tenantId_isActive_idx" ON "LoyaltyReward" ("tenantId", "isActive");
ALTER TABLE "LoyaltyReward" DROP CONSTRAINT IF EXISTS "LoyaltyReward_tenantId_fkey";
ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "LoyaltyTransaction" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "appointmentId" TEXT,
  "rewardId" TEXT,
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyTransaction_appointmentId_reason_key" ON "LoyaltyTransaction" ("appointmentId", "reason");
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_tenantId_customerId_createdAt_idx" ON "LoyaltyTransaction" ("tenantId", "customerId", "createdAt");
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT IF EXISTS "LoyaltyTransaction_tenantId_fkey";
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT IF EXISTS "LoyaltyTransaction_customerId_fkey";
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
