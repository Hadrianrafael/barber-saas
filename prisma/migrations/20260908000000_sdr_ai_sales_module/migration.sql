-- SDR / AI Sales Assistant module (platform-scoped, no tenantId).

-- CreateEnum
CREATE TYPE "SalesLeadStatus" AS ENUM ('NOVO', 'ABORDADO', 'CONVERSANDO', 'QUALIFICANDO', 'INTERESSADO', 'DEMONSTRACAO', 'HUMANO', 'SEM_INTERESSE', 'OPT_OUT');
CREATE TYPE "SalesQualification" AS ENUM ('FRIO', 'MORNO', 'QUENTE');
CREATE TYPE "SalesConsentBasis" AS ENUM ('OPT_IN', 'LEGITIMATE_INTEREST', 'EXISTING_RELATIONSHIP');
CREATE TYPE "SalesChannel" AS ENUM ('WHATSAPP', 'EMAIL');
CREATE TYPE "SalesCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED');
CREATE TYPE "SalesCampaignLeadState" AS ENUM ('PENDING', 'SCHEDULED', 'SENT', 'REPLIED', 'DONE', 'SKIPPED', 'FAILED');
CREATE TYPE "SalesConvStatus" AS ENUM ('OPEN', 'SNOOZED', 'CLOSED');
CREATE TYPE "SalesConvAgent" AS ENUM ('AI', 'HUMAN');
CREATE TYPE "SalesMsgDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "SalesMsgKind" AS ENUM ('TEXT', 'AUDIO', 'TEMPLATE');
CREATE TYPE "SalesMsgStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'RECEIVED', 'FAILED');
CREATE TYPE "SalesFirstTouch" AS ENUM ('AUDIO', 'TEXT');
CREATE TYPE "SalesMode" AS ENUM ('TEST', 'PRODUCTION');
CREATE TYPE "SalesReplyMode" AS ENUM ('TEXT', 'AUDIO', 'MIXED');

-- CreateTable
CREATE TABLE "SalesSetting" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "testAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dailyGlobalCap" INTEGER NOT NULL DEFAULT 200,
    "productionEnabledAt" TIMESTAMP(3),
    "productionEnabledById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB,
    "report" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLead" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "barbershopName" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "city" TEXT,
    "state" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "notes" TEXT,
    "source" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "SalesLeadStatus" NOT NULL DEFAULT 'NOVO',
    "qualification" "SalesQualification",
    "score" INTEGER NOT NULL DEFAULT 0,
    "qualData" JSONB,
    "consentBasis" "SalesConsentBasis",
    "consentNote" TEXT,
    "optOutAt" TIMESTAMP(3),
    "optOutReason" TEXT,
    "assignedToId" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "importId" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLeadEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesLeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesAgentConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Assistente de Vendas',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "assistantName" TEXT NOT NULL DEFAULT 'Hadrian',
    "companyName" TEXT NOT NULL DEFAULT 'HR Tech',
    "replyMode" "SalesReplyMode" NOT NULL DEFAULT 'MIXED',
    "defaultLocale" TEXT NOT NULL DEFAULT 'pt-BR',
    "content" JSONB NOT NULL DEFAULT '{}',
    "knowledge" JSONB NOT NULL DEFAULT '{}',
    "qualificationRules" JSONB NOT NULL DEFAULT '{}',
    "systemPromptOverride" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesAgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SalesCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "mode" "SalesMode" NOT NULL DEFAULT 'TEST',
    "channel" "SalesChannel" NOT NULL DEFAULT 'WHATSAPP',
    "firstTouch" "SalesFirstTouch" NOT NULL DEFAULT 'AUDIO',
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "agentConfigId" TEXT,
    "dailyCap" INTEGER NOT NULL DEFAULT 30,
    "minIntervalSec" INTEGER NOT NULL DEFAULT 180,
    "jitterPct" INTEGER NOT NULL DEFAULT 40,
    "windowStartMin" INTEGER NOT NULL DEFAULT 540,
    "windowEndMin" INTEGER NOT NULL DEFAULT 1140,
    "sendDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "templateName" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastDispatchAt" TIMESTAMP(3),
    "totalLeads" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesCampaignLead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "state" "SalesCampaignLeadState" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "skippedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesCampaignLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesConversation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL DEFAULT 'WHATSAPP',
    "status" "SalesConvStatus" NOT NULL DEFAULT 'OPEN',
    "handledBy" "SalesConvAgent" NOT NULL DEFAULT 'AI',
    "assignedToId" TEXT,
    "stage" "SalesLeadStatus" NOT NULL DEFAULT 'ABORDADO',
    "contextSummary" TEXT,
    "externalId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT,
    "direction" "SalesMsgDirection" NOT NULL,
    "kind" "SalesMsgKind" NOT NULL DEFAULT 'TEXT',
    "channel" "SalesChannel" NOT NULL DEFAULT 'WHATSAPP',
    "status" "SalesMsgStatus" NOT NULL DEFAULT 'QUEUED',
    "body" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "templateName" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesSuppression" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesLead_dedupeKey_key" ON "SalesLead"("dedupeKey");
CREATE INDEX "SalesLead_status_idx" ON "SalesLead"("status");
CREATE INDEX "SalesLead_qualification_idx" ON "SalesLead"("qualification");
CREATE INDEX "SalesLead_assignedToId_idx" ON "SalesLead"("assignedToId");
CREATE INDEX "SalesLead_createdAt_idx" ON "SalesLead"("createdAt");
CREATE INDEX "SalesLeadEvent_leadId_createdAt_idx" ON "SalesLeadEvent"("leadId", "createdAt");
CREATE INDEX "SalesCampaign_status_idx" ON "SalesCampaign"("status");
CREATE INDEX "SalesCampaign_mode_status_idx" ON "SalesCampaign"("mode", "status");
CREATE UNIQUE INDEX "SalesCampaignLead_campaignId_leadId_key" ON "SalesCampaignLead"("campaignId", "leadId");
CREATE INDEX "SalesCampaignLead_campaignId_state_idx" ON "SalesCampaignLead"("campaignId", "state");
CREATE INDEX "SalesCampaignLead_state_scheduledFor_idx" ON "SalesCampaignLead"("state", "scheduledFor");
CREATE INDEX "SalesConversation_status_handledBy_idx" ON "SalesConversation"("status", "handledBy");
CREATE INDEX "SalesConversation_leadId_idx" ON "SalesConversation"("leadId");
CREATE UNIQUE INDEX "SalesMessage_provider_providerMessageId_key" ON "SalesMessage"("provider", "providerMessageId");
CREATE INDEX "SalesMessage_conversationId_createdAt_idx" ON "SalesMessage"("conversationId", "createdAt");
CREATE INDEX "SalesMessage_leadId_createdAt_idx" ON "SalesMessage"("leadId", "createdAt");
CREATE INDEX "SalesMessage_status_nextAttemptAt_idx" ON "SalesMessage"("status", "nextAttemptAt");
CREATE INDEX "SalesMessage_campaignId_idx" ON "SalesMessage"("campaignId");
CREATE UNIQUE INDEX "SalesSuppression_kind_value_key" ON "SalesSuppression"("kind", "value");
CREATE INDEX "SalesSuppression_value_idx" ON "SalesSuppression"("value");

-- AddForeignKey
ALTER TABLE "SalesSetting" ADD CONSTRAINT "SalesSetting_productionEnabledById_fkey" FOREIGN KEY ("productionEnabledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesImport" ADD CONSTRAINT "SalesImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SalesImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesLeadEvent" ADD CONSTRAINT "SalesLeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesLeadEvent" ADD CONSTRAINT "SalesLeadEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesAgentConfig" ADD CONSTRAINT "SalesAgentConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesCampaign" ADD CONSTRAINT "SalesCampaign_agentConfigId_fkey" FOREIGN KEY ("agentConfigId") REFERENCES "SalesAgentConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesCampaign" ADD CONSTRAINT "SalesCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesCampaignLead" ADD CONSTRAINT "SalesCampaignLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SalesCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesCampaignLead" ADD CONSTRAINT "SalesCampaignLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesConversation" ADD CONSTRAINT "SalesConversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesConversation" ADD CONSTRAINT "SalesConversation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesMessage" ADD CONSTRAINT "SalesMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SalesConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesMessage" ADD CONSTRAINT "SalesMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SalesLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesMessage" ADD CONSTRAINT "SalesMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SalesCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
