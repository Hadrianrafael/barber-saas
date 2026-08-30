-- Stripe integration: one Stripe Product per Plan (monthly + yearly prices hang off it).
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "stripeProductId" TEXT;
