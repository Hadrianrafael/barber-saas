"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { requireAdminSession } from "@/server/auth/current-user";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import type { SdrLeadField } from "./schema";
import { commitImport, createImport, parseSpreadsheet, previewImport } from "./import";
import {
  assignLead,
  eraseLead,
  optOutLead,
  recordConsent,
  setLeadStatus,
  updateLead,
} from "./leads";
import {
  addLeadsToCampaign,
  createCampaign,
  pauseCampaign,
  removeLeadFromCampaign,
  resumeCampaign,
  setCampaignMode,
  startCampaign,
} from "./campaigns";
import { activateAgentConfig, upsertAgentConfig } from "./agent-config";
import {
  closeConversation,
  returnConversationToAi,
  sendManualReply,
  takeOverConversation,
} from "./inbox";
import {
  disableProduction,
  enableProduction,
  setDailyGlobalCap,
  updateAllowlist,
} from "./settings";

export interface SdrState {
  ok: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
}

const ADMIN = "/admin/sales";

async function audit(action: string, targetId: string | null, meta?: Record<string, unknown>) {
  const admin = await requireAdminSession();
  await prisma.auditLog
    .create({
      data: {
        actorType: "PLATFORM_ADMIN",
        actorId: admin.userId,
        actorLabel: admin.email,
        action,
        targetType: "Sdr",
        targetId: targetId ?? undefined,
        metadata: (meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
    .catch((e) => logger.warn({ err: (e as Error).message }, "sdr.audit_failed"));
  return admin;
}

// --- import -----------------------------------------------------------

export async function uploadLeadsAction(_prev: SdrState, fd: FormData): Promise<SdrState> {
  const admin = await requireAdminSession();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, code: "no_file" };
  if (file.size > 8 * 1024 * 1024) return { ok: false, code: "too_large" };
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const sheet = await parseSpreadsheet(buf, file.name);
    if (!sheet.headers.length) return { ok: false, code: "empty" };
    const res = await createImport({ fileName: file.name, sheet, createdById: admin.userId });
    return { ok: true, code: "previewed", data: { ...res } };
  } catch (e) {
    logger.error({ err: (e as Error).message }, "sdr.upload_failed");
    return { ok: false, code: "parse_error", message: (e as Error).message };
  }
}

export async function previewImportAction(_prev: SdrState, fd: FormData): Promise<SdrState> {
  await requireAdminSession();
  const importId = String(fd.get("importId") ?? "");
  const mapping = JSON.parse(String(fd.get("mapping") ?? "[]")) as (SdrLeadField | null)[];
  const defaultSource = String(fd.get("defaultSource") ?? "") || undefined;
  const defaultTags = String(fd.get("defaultTags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!importId) return { ok: false, code: "invalid" };
  const res = await previewImport(importId, mapping, { source: defaultSource, tags: defaultTags });
  return { ok: true, code: "preview", data: { ...res } };
}

export async function commitImportAction(_prev: SdrState, fd: FormData): Promise<SdrState> {
  await audit("sdr.import.commit", String(fd.get("importId") ?? ""));
  const importId = String(fd.get("importId") ?? "");
  const mapping = JSON.parse(String(fd.get("mapping") ?? "[]")) as (SdrLeadField | null)[];
  const defaultSource = String(fd.get("defaultSource") ?? "") || undefined;
  const defaultTags = String(fd.get("defaultTags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!importId) return { ok: false, code: "invalid" };
  const res = await commitImport(importId, mapping, { source: defaultSource, tags: defaultTags });
  revalidatePath(`${ADMIN}/leads`);
  return { ok: true, code: "imported", data: { ...res } };
}

// --- leads ----------------------------------------------------------

export async function updateLeadAction(fd: FormData): Promise<void> {
  const admin = await requireAdminSession();
  const id = String(fd.get("id") ?? "");
  if (!id) return;
  const input = {
    name: fd.get("name") ? String(fd.get("name")) : undefined,
    barbershopName: fd.get("barbershopName") ? String(fd.get("barbershopName")) : undefined,
    phone: fd.get("phone") != null ? String(fd.get("phone")) : undefined,
    whatsapp: fd.get("whatsapp") != null ? String(fd.get("whatsapp")) : undefined,
    email: fd.get("email") != null ? String(fd.get("email")) : undefined,
    city: fd.get("city") != null ? String(fd.get("city")) : undefined,
    state: fd.get("state") != null ? String(fd.get("state")) : undefined,
    notes: fd.get("notes") != null ? String(fd.get("notes")) : undefined,
  };
  await updateLead(id, input, admin.userId).catch((e) =>
    logger.warn({ err: (e as Error).message, id }, "sdr.lead.update_failed"),
  );
  revalidatePath(`${ADMIN}/leads/${id}`);
}

export async function setLeadStatusAction(fd: FormData): Promise<void> {
  const admin = await requireAdminSession();
  const id = String(fd.get("id") ?? "");
  const status = String(fd.get("status") ?? "") as Parameters<typeof setLeadStatus>[1];
  if (id && status) await setLeadStatus(id, status, admin.userId);
  revalidatePath(`${ADMIN}/leads/${id}`);
}

export async function optOutLeadAction(fd: FormData): Promise<void> {
  await audit("sdr.lead.opt_out", String(fd.get("id") ?? ""));
  const id = String(fd.get("id") ?? "");
  if (id) await optOutLead(id, String(fd.get("reason") ?? "admin"), "admin");
  revalidatePath(`${ADMIN}/leads/${id}`);
}

export async function recordConsentAction(fd: FormData): Promise<void> {
  const admin = await requireAdminSession();
  const id = String(fd.get("id") ?? "");
  const basis = String(fd.get("basis") ?? "") as
    "OPT_IN" | "LEGITIMATE_INTEREST" | "EXISTING_RELATIONSHIP";
  if (id && basis)
    await recordConsent(id, basis, String(fd.get("note") ?? "") || null, admin.userId);
  await audit("sdr.lead.consent", id, { basis });
  revalidatePath(`${ADMIN}/leads/${id}`);
}

export async function eraseLeadAction(fd: FormData): Promise<void> {
  const admin = await audit("sdr.lead.erase", String(fd.get("id") ?? ""));
  const id = String(fd.get("id") ?? "");
  if (id) await eraseLead(id, admin.userId);
  revalidatePath(`${ADMIN}/leads`);
}

export async function assignLeadAction(fd: FormData): Promise<void> {
  const admin = await requireAdminSession();
  const id = String(fd.get("id") ?? "");
  const userId = String(fd.get("userId") ?? "") || null;
  if (id) await assignLead(id, userId, admin.userId);
  revalidatePath(`${ADMIN}/leads/${id}`);
}

// --- campaigns ----------------------------------------------------

export async function createCampaignAction(_prev: SdrState, fd: FormData): Promise<SdrState> {
  const admin = await requireAdminSession();
  const raw = Object.fromEntries(fd);
  try {
    const c = await createCampaign(
      {
        ...raw,
        sendDays: String(fd.get("sendDays") ?? "1,2,3,4,5")
          .split(",")
          .map((n) => Number(n.trim()))
          .filter((n) => !Number.isNaN(n)),
      },
      admin.userId,
    );
    await audit("sdr.campaign.create", c.id);
    revalidatePath(`${ADMIN}/campaigns`);
    return { ok: true, code: "created", data: { id: c.id } };
  } catch (e) {
    return { ok: false, code: "invalid", message: (e as Error).message };
  }
}

export async function addLeadsAction(_prev: SdrState, fd: FormData): Promise<SdrState> {
  await requireAdminSession();
  const campaignId = String(fd.get("campaignId") ?? "");
  const leadIds = String(fd.get("leadIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!campaignId || !leadIds.length) return { ok: false, code: "invalid" };
  const res = await addLeadsToCampaign(campaignId, leadIds);
  revalidatePath(`${ADMIN}/campaigns/${campaignId}`);
  return { ok: true, code: "added", data: { ...res } };
}

export async function removeLeadAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  const campaignId = String(fd.get("campaignId") ?? "");
  const leadId = String(fd.get("leadId") ?? "");
  if (campaignId && leadId) await removeLeadFromCampaign(campaignId, leadId);
  revalidatePath(`${ADMIN}/campaigns/${campaignId}`);
}

export async function campaignControlAction(fd: FormData): Promise<void> {
  const admin = await requireAdminSession();
  const id = String(fd.get("id") ?? "");
  const op = String(fd.get("op") ?? "");
  if (!id) return;
  if (op === "start") await startCampaign(id);
  else if (op === "pause") await pauseCampaign(id);
  else if (op === "resume") await resumeCampaign(id);
  else if (op === "mode-test") await setCampaignMode(id, "TEST");
  else if (op === "mode-prod") await setCampaignMode(id, "PRODUCTION");
  await audit(`sdr.campaign.${op}`, id, { actor: admin.email });
  revalidatePath(`${ADMIN}/campaigns/${id}`);
}

// --- assistant config -------------------------------------------

export async function saveAgentConfigAction(_prev: SdrState, fd: FormData): Promise<SdrState> {
  const admin = await requireAdminSession();
  const id = String(fd.get("id") ?? "") || null;
  const parseJson = (k: string, fallback: unknown) => {
    try {
      return JSON.parse(String(fd.get(k) ?? "")) as unknown;
    } catch {
      return fallback;
    }
  };
  try {
    const cfg = await upsertAgentConfig(
      id,
      {
        name: String(fd.get("name") ?? "Assistente de Vendas"),
        assistantName: String(fd.get("assistantName") ?? "Hadrian"),
        companyName: String(fd.get("companyName") ?? "HR Tech"),
        replyMode: String(fd.get("replyMode") ?? "MIXED"),
        defaultLocale: String(fd.get("defaultLocale") ?? "pt-BR"),
        content: parseJson("content", {}),
        knowledge: parseJson("knowledge", {}),
        qualificationRules: parseJson("qualificationRules", {}),
        systemPromptOverride: String(fd.get("systemPromptOverride") ?? "") || null,
      },
      admin.userId,
    );
    await audit("sdr.agent_config.save", cfg.id);
    revalidatePath(`${ADMIN}/assistant`);
    return { ok: true, code: "saved", data: { id: cfg.id } };
  } catch (e) {
    return { ok: false, code: "invalid", message: (e as Error).message };
  }
}

export async function activateAgentConfigAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  const id = String(fd.get("id") ?? "");
  if (id) await activateAgentConfig(id);
  await audit("sdr.agent_config.activate", id);
  revalidatePath(`${ADMIN}/assistant`);
}

// --- inbox --------------------------------------------------------

export async function takeOverAction(fd: FormData): Promise<void> {
  const admin = await requireAdminSession();
  const id = String(fd.get("id") ?? "");
  if (id) await takeOverConversation(id, admin.userId);
  revalidatePath(`${ADMIN}/inbox/${id}`);
}

export async function returnToAiAction(fd: FormData): Promise<void> {
  const admin = await requireAdminSession();
  const id = String(fd.get("id") ?? "");
  if (id) await returnConversationToAi(id, admin.userId);
  revalidatePath(`${ADMIN}/inbox/${id}`);
}

export async function closeConversationAction(fd: FormData): Promise<void> {
  const admin = await requireAdminSession();
  const id = String(fd.get("id") ?? "");
  if (id) await closeConversation(id, admin.userId);
  revalidatePath(`${ADMIN}/inbox/${id}`);
}

export async function manualReplyAction(_prev: SdrState, fd: FormData): Promise<SdrState> {
  const admin = await requireAdminSession();
  const conversationId = String(fd.get("conversationId") ?? "");
  const text = String(fd.get("text") ?? "").trim();
  const kind = String(fd.get("kind") ?? "TEXT") === "AUDIO" ? "AUDIO" : "TEXT";
  if (!conversationId || !text) return { ok: false, code: "invalid" };
  const res = await sendManualReply({ conversationId, actorId: admin.userId, text, kind });
  revalidatePath(`${ADMIN}/inbox/${conversationId}`);
  if (!res.ok) return { ok: false, code: "send_failed", message: res.blockedReason ?? res.error };
  return { ok: true, code: "sent" };
}

// --- settings ---------------------------------------------------

export async function updateAllowlistAction(fd: FormData): Promise<void> {
  await audit("sdr.settings.allowlist", null);
  const entries = String(fd.get("entries") ?? "")
    .split(/[\n,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  await updateAllowlist(entries);
  revalidatePath(`${ADMIN}/settings`);
}

export async function setDailyCapAction(fd: FormData): Promise<void> {
  await audit("sdr.settings.daily_cap", null);
  const cap = Number(fd.get("cap") ?? 200);
  await setDailyGlobalCap(Number.isFinite(cap) ? cap : 200);
  revalidatePath(`${ADMIN}/settings`);
}

export async function toggleProductionAction(fd: FormData): Promise<SdrState> {
  const admin = await requireAdminSession();
  const enable = String(fd.get("enable") ?? "") === "true";
  if (enable) {
    const res = await enableProduction(admin.userId);
    await audit("sdr.settings.production_enable", null, { ok: res.ok, reason: res.reason });
    revalidatePath(`${ADMIN}/settings`);
    return res.ok
      ? { ok: true, code: "production_on" }
      : { ok: false, code: "blocked", message: res.reason };
  }
  await disableProduction();
  await audit("sdr.settings.production_disable", null);
  revalidatePath(`${ADMIN}/settings`);
  return { ok: true, code: "production_off" };
}
