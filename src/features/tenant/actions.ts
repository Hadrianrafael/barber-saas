"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenantContext } from "@/server/rbac/guard";
import { storage } from "@/server/storage";
import { logger } from "@/lib/logger";
import {
  tenantProfileSchema,
  tenantRegionalSchema,
  businessHoursSchema,
  holidaySchema,
} from "./schema";
import { bookingConfigSchema } from "./booking-config";
import { chatbotConfigSchema } from "@/features/chatbot/config";
import {
  updateTenantProfile,
  updateTenantRegional,
  updateBookingConfig,
  updateChatbotConfig,
  replaceBusinessHours,
  addHoliday,
  removeHoliday,
  setTenantLogo,
} from "./service";

export interface SettingsState {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
}

const OK: SettingsState = { ok: true, code: "saved" };

async function actorFrom(ctx: Awaited<ReturnType<typeof requireTenantContext>>) {
  const h = await headers();
  return {
    userId: ctx.session.userId,
    label: ctx.session.email,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

function zerr(e: ZodError): SettingsState {
  return {
    ok: false,
    fieldErrors: Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "_", i.message])),
  };
}

function revalidate(locale: string) {
  revalidatePath(`/${locale}/settings`);
}

export async function updateProfileAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireTenantContext({ permission: "tenant.settings.write" });
  const parsed = tenantProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zerr(parsed.error);
  await updateTenantProfile(ctx.tenantId, parsed.data, await actorFrom(ctx));
  revalidate(String(formData.get("locale") ?? "pt-BR"));
  return OK;
}

export async function updateRegionalAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireTenantContext({ permission: "tenant.settings.write" });
  const parsed = tenantRegionalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zerr(parsed.error);
  await updateTenantRegional(ctx.tenantId, parsed.data, await actorFrom(ctx));
  revalidate(String(formData.get("locale") ?? "pt-BR"));
  return OK;
}

export async function updateHoursAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireTenantContext({ permission: "tenant.settings.write" });
  let json: unknown;
  try {
    json = JSON.parse(String(formData.get("hours") ?? ""));
  } catch {
    return { ok: false, code: "invalidHours" };
  }
  const parsed = businessHoursSchema.safeParse(json);
  if (!parsed.success) return zerr(parsed.error);
  await replaceBusinessHours(ctx.tenantId, parsed.data);
  revalidate(String(formData.get("locale") ?? "pt-BR"));
  return OK;
}

export async function addHolidayAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireTenantContext({ permission: "tenant.settings.write" });
  const parsed = holidaySchema.safeParse({
    date: formData.get("date"),
    name: formData.get("name"),
    isClosed: formData.get("isClosed") === "on" || formData.get("isClosed") === "true",
  });
  if (!parsed.success) return zerr(parsed.error);
  await addHoliday(ctx.tenantId, parsed.data);
  revalidate(String(formData.get("locale") ?? "pt-BR"));
  return OK;
}

export async function removeHolidayAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "tenant.settings.write" });
  const id = String(formData.get("id") ?? "");
  if (id) await removeHoliday(ctx.tenantId, id);
  revalidate(String(formData.get("locale") ?? "pt-BR"));
}

export async function updateBookingConfigAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireTenantContext({ permission: "tenant.settings.write" });
  const raw = Object.fromEntries(formData);
  const parsed = bookingConfigSchema.safeParse({
    slotGranularityMin: Number(raw.slotGranularityMin),
    minLeadTimeMin: Number(raw.minLeadTimeMin),
    maxAdvanceDays: Number(raw.maxAdvanceDays),
    onlineBookingEnabled: raw.onlineBookingEnabled === "on" || raw.onlineBookingEnabled === "true",
    requireEmployeeSelection:
      raw.requireEmployeeSelection === "on" || raw.requireEmployeeSelection === "true",
    clientCancellationCutoffHours: Number(raw.clientCancellationCutoffHours),
    defaultBufferMin: Number(raw.defaultBufferMin),
  });
  if (!parsed.success) return zerr(parsed.error);
  await updateBookingConfig(ctx.tenantId, parsed.data, await actorFrom(ctx));
  revalidate(String(raw.locale ?? "pt-BR"));
  return OK;
}

export async function updateChatbotConfigAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const ctx = await requireTenantContext({ permission: "tenant.settings.write" });
  const raw = Object.fromEntries(formData);
  const parsed = chatbotConfigSchema.safeParse({
    enabled: raw.enabled === "on" || raw.enabled === "true",
    displayName: String(raw.displayName ?? "").trim() || "Assistente",
    greeting: {
      "pt-BR": String(raw["greeting.pt-BR"] ?? ""),
      en: String(raw["greeting.en"] ?? ""),
      es: String(raw["greeting.es"] ?? ""),
    },
    instructions: String(raw.instructions ?? ""),
    handoffKeywords: String(raw.handoffKeywords ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });
  if (!parsed.success) return zerr(parsed.error);
  await updateChatbotConfig(ctx.tenantId, parsed.data, await actorFrom(ctx));
  revalidate(String(raw.locale ?? "pt-BR"));
  return OK;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadImageAction(formData: FormData): Promise<SettingsState> {
  const ctx = await requireTenantContext({ permission: "tenant.settings.write" });
  const kind = formData.get("kind") === "cover" ? "cover" : "logo";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, code: "noFile" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, code: "tooLarge" };
  if (!ALLOWED_IMAGE.has(file.type)) return { ok: false, code: "badType" };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `tenants/${ctx.tenantId}/${kind}-${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { url } = await storage.put(key, buf, file.type);
  await setTenantLogo(ctx.tenantId, kind, url);
  logger.info({ tenantId: ctx.tenantId, kind, key }, "tenant.image_uploaded");
  revalidate(String(formData.get("locale") ?? "pt-BR"));
  return { ok: true, code: "saved" };
}
