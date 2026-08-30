-- Slice 5: Stripe SaaS billing — plan pricing/price-ids, tenant Stripe customer.
ALTER TABLE "Plan"
  ADD COLUMN IF NOT EXISTS "priceCentsYearly" INTEGER,
  ADD COLUMN IF NOT EXISTS "stripePriceIdYearly" TEXT;
ALTER TABLE "Plan" DROP COLUMN IF EXISTS "interval";

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_stripeCustomerId_key" ON "Tenant"("stripeCustomerId");
