"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenantContext } from "@/server/rbac/guard";
import { gateLimit } from "@/features/billing/gate-helpers";
import { serviceSchema } from "./schema";
import { createService, updateService, setServiceStatus, deleteService } from "./service";

export interface ServiceState {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
}
const OK: ServiceState = { ok: true, code: "saved" };

function zerr(e: ZodError): ServiceState {
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
const rev = (locale: string) => revalidatePath(`/${locale}/services`);

export async function saveServiceAction(_prev: ServiceState, fd: FormData): Promise<ServiceState> {
  const ctx = await requireTenantContext({ permission: "service.write" });
  const parsed = serviceSchema.safeParse({
    ...Object.fromEntries(fd),
    employeeIds: fd.getAll("employeeIds").map(String).filter(Boolean),
  });
  if (!parsed.success) return zerr(parsed.error);
  const id = String(fd.get("id") ?? "");
  if (!id) {
    const gate = await gateLimit(ctx.tenantId, "services");
    if (gate) return gate;
  }
  try {
    if (id) await updateService(ctx.tenantId, id, parsed.data, await actor(ctx));
    else await createService(ctx.tenantId, parsed.data, await actor(ctx));
  } catch (e) {
    if (e instanceof Error && e.name === "ValidationError")
      return { ok: false, code: "invalidEmployees" };
    if (e instanceof Error && e.name === "NotFoundError") return { ok: false, code: "notFound" };
    throw e;
  }
  rev(String(fd.get("locale") ?? "pt-BR"));
  return OK;
}

export async function setServiceStatusAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "service.write" });
  const id = String(fd.get("id") ?? "");
  const status = String(fd.get("status") ?? "");
  if (!id || !["ACTIVE", "ARCHIVED"].includes(status)) return;
  await setServiceStatus(ctx.tenantId, id, status as "ACTIVE" | "ARCHIVED", await actor(ctx));
  rev(String(fd.get("locale") ?? "pt-BR"));
}

export async function deleteServiceAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "service.write" });
  const id = String(fd.get("id") ?? "");
  if (id) await deleteService(ctx.tenantId, id, await actor(ctx));
  rev(String(fd.get("locale") ?? "pt-BR"));
}
