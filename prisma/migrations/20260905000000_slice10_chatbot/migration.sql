-- Slice 10: per-tenant chatbot configuration.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "chatbotConfig" JSONB;
