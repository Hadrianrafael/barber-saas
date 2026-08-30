"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenantContext } from "@/server/rbac/guard";
import { gateLimit } from "@/features/billing/gate-helpers";
import { customerSchema, consentSchema } from "./schema";
import {
  createCustomer,
  updateCustomer,
  setCustomerStatus,
  anonymizeCustomer,
  setConsent,
  getCustomerDetail,
} from "./service";

export interface CustomerDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  locale: string;
  birthDate: string;
  notes: string | null;
  tags: string[];
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
  preferredEmployeeId: string | null;
  preferredEmployeeName: string | null;
  totalSpentCents: number;
  visitsCount: number;
  lastVisitAt: string | null;
  anonymizedAt: string | null;
  consents: { channel: "EMAIL" | "WHATSAPP" | "SMS"; granted: boolean }[];
  appointments: {
    id: string;
    status: string;
    startsAt: string;
    serviceName: string;
    priceCents: number;
    currency: string;
    employeeName: string;
  }[];
}

export interface CrmState {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: { customer?: CustomerDetail; rows?: unknown };
}
const OK: CrmState = { ok: true, code: "saved" };

function zerr(e: ZodError): CrmState {
  return {
    ok: false,
    fieldErrors: Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "_", i.message])),
  };
}
async function actor(ctx: Awaited<ReturnType<typeof requireTenantContext>>) {
  const h = await headers();
  return {
    userId: ctx.session.userId,
    label: ctx.session.email,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}
const rev = (locale: string) => revalidatePath(`/${locale}/clients`);

export async function saveCustomerAction(_prev: CrmState, fd: FormData): Promise<CrmState> {
  const ctx = await requireTenantContext({ permission: "customer.write" });
  const parsed = customerSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zerr(parsed.error);
  const id = String(fd.get("id") ?? "");
  if (!id) {
    const gate = await gateLimit(ctx.tenantId, "customers");
    if (gate) return gate;
  }
  try {
    if (id) await updateCustomer(ctx.tenantId, id, parsed.data, await actor(ctx));
    else await createCustomer(ctx.tenantId, parsed.data, await actor(ctx));
  } catch (e) {
    if (e instanceof Error && e.name === "ConflictError") return { ok: false, code: "duplicate" };
    if (e instanceof Error && e.name === "ValidationError")
      return { ok: false, code: "invalidEmployee" };
    if (e instanceof Error && e.name === "NotFoundError") return { ok: false, code: "notFound" };
    throw e;
  }
  rev(String(fd.get("locale") ?? "pt-BR"));
  return OK;
}

export async function setCustomerStatusAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "customer.write" });
  const id = String(fd.get("id") ?? "");
  const status = String(fd.get("status") ?? "");
  if (!id || !["ACTIVE", "INACTIVE", "BLOCKED"].includes(status)) return;
  await setCustomerStatus(ctx.tenantId, id, status as never, await actor(ctx));
  rev(String(fd.get("locale") ?? "pt-BR"));
}

export async function anonymizeCustomerAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "customer.delete" });
  const id = String(fd.get("id") ?? "");
  if (id) await anonymizeCustomer(ctx.tenantId, id, await actor(ctx));
  rev(String(fd.get("locale") ?? "pt-BR"));
}

export async function getCustomerDetailAction(id: string): Promise<CrmState> {
  const ctx = await requireTenantContext({ permission: "customer.read" });
  const c = await getCustomerDetail(ctx.tenantId, id);
  if (!c) return { ok: false, code: "notFound" };
  const customer: CustomerDetail = {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    whatsapp: c.whatsapp,
    locale: c.locale,
    birthDate: c.birthDate ? c.birthDate.toISOString().slice(0, 10) : "",
    notes: c.notes,
    tags: c.tags,
    status: c.status,
    preferredEmployeeId: c.preferredEmployeeId,
    preferredEmployeeName: c.preferredEmployee?.name ?? null,
    totalSpentCents: c.totalSpentCents,
    visitsCount: c.visitsCount,
    lastVisitAt: c.lastVisitAt ? c.lastVisitAt.toISOString() : null,
    anonymizedAt: c.anonymizedAt ? c.anonymizedAt.toISOString() : null,
    consents: c.consents.map((x) => ({
      channel: x.channel,
      granted: x.granted && !x.revokedAt,
    })),
    appointments: c.appointments.map((a) => ({
      id: a.id,
      status: a.status,
      startsAt: a.startsAt.toISOString(),
      serviceName: a.serviceName,
      priceCents: a.priceCents,
      currency: a.currency,
      employeeName: a.employee.name,
    })),
  };
  return { ok: true, data: { customer } };
}

export async function setConsentAction(_prev: CrmState, fd: FormData): Promise<CrmState> {
  const ctx = await requireTenantContext({ permission: "customer.write" });
  const parsed = consentSchema.safeParse({
    customerId: fd.get("customerId"),
    channel: fd.get("channel"),
    granted: fd.get("granted") === "true" || fd.get("granted") === "on",
  });
  if (!parsed.success) return zerr(parsed.error);
  try {
    await setConsent(ctx.tenantId, parsed.data, await actor(ctx));
  } catch (e) {
    if (e instanceof Error && e.name === "NotFoundError") return { ok: false, code: "notFound" };
    throw e;
  }
  rev(String(fd.get("locale") ?? "pt-BR"));
  return OK;
}
