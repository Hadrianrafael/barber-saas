"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenantContext } from "@/server/rbac/guard";
import { SEGMENT_IDS } from "@/features/crm/segments";
import {
  createCampaign,
  estimateRecipients,
  launchCampaign,
  cancelCampaign,
  CampaignError,
  type CampaignAudience,
} from "./service";

export interface CampaignState {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: { count?: number };
}

const audienceSchema = z.object({
  segment: z.enum(SEGMENT_IDS as [string, ...string[]]),
  serviceId: z.string().optional().or(z.literal("")),
  employeeId: z.string().optional().or(z.literal("")),
  channel: z.enum(["EMAIL", "WHATSAPP", "SMS"]).optional(),
  inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
});

function toAudience(d: z.infer<typeof audienceSchema>): CampaignAudience {
  return {
    segment: d.segment as CampaignAudience["segment"],
    params: {
      serviceId: d.serviceId || undefined,
      employeeId: d.employeeId || undefined,
      channel: d.channel,
      inactiveDays: d.inactiveDays,
    },
  };
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  channel: z.enum(["EMAIL", "WHATSAPP", "SMS"]),
  locale: z.string().default("pt-BR"),
  subject: z.string().trim().max(200).optional().or(z.literal("")),
  body: z.string().trim().min(4).max(4000),
});

export async function estimateAction(fd: FormData): Promise<CampaignState> {
  const ctx = await requireTenantContext({ permission: "campaign.read" });
  const a = audienceSchema.safeParse(Object.fromEntries(fd));
  const channel = String(fd.get("channel") ?? "EMAIL") as "EMAIL" | "WHATSAPP" | "SMS";
  if (!a.success) return { ok: false, code: "invalid" };
  const count = await estimateRecipients(ctx.tenantId, channel, toAudience(a.data));
  return { ok: true, data: { count } };
}

export async function createCampaignAction(
  _prev: CampaignState,
  fd: FormData,
): Promise<CampaignState> {
  const ctx = await requireTenantContext({ permission: "campaign.write" });
  const parsed = createSchema.safeParse(Object.fromEntries(fd));
  const aud = audienceSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success || !aud.success) {
    return {
      ok: false,
      fieldErrors: parsed.success
        ? { audience: "invalid" }
        : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message])),
    };
  }
  const d = parsed.data;
  const campaign = await createCampaign(
    ctx.tenantId,
    {
      name: d.name,
      channel: d.channel,
      locale: d.locale,
      subject: d.subject || null,
      body: d.body,
      audience: toAudience(aud.data),
    },
    { userId: ctx.session.userId },
  );
  redirect(`/${d.locale}/campaigns?created=${campaign.id}`);
}

export async function launchCampaignAction(
  _prev: CampaignState,
  fd: FormData,
): Promise<CampaignState> {
  const ctx = await requireTenantContext({ permission: "campaign.write" });
  const id = String(fd.get("id") ?? "");
  const locale = String(fd.get("locale") ?? "pt-BR");
  if (!id) return { ok: false, code: "invalid" };
  try {
    const { total } = await launchCampaign(ctx.tenantId, id, { userId: ctx.session.userId });
    revalidatePath(`/${locale}/campaigns`);
    return { ok: true, code: "launched", data: { count: total } };
  } catch (e) {
    if (e instanceof CampaignError) return { ok: false, code: e.code };
    throw e;
  }
}

export async function cancelCampaignAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "campaign.write" });
  const id = String(fd.get("id") ?? "");
  if (id) await cancelCampaign(ctx.tenantId, id);
  revalidatePath(`/${String(fd.get("locale") ?? "pt-BR")}/campaigns`);
}
