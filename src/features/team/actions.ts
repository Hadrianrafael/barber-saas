"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenantContext, AuthorizationError } from "@/server/rbac/guard";
import { prisma } from "@/server/db/client";
import { employeeSchema, selfProfileSchema, workHoursSchema, timeOffSchema } from "./schema";
import {
  createEmployee,
  updateEmployee,
  setEmployeeStatus,
  updateSelfProfile,
  replaceEmployeeWorkHours,
  addTimeOff,
  removeTimeOff,
  getEmployeeByUser,
} from "./service";

export interface TeamState {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: Record<string, unknown>;
}
const OK: TeamState = { ok: true, code: "saved" };

function zerr(e: ZodError): TeamState {
  return {
    ok: false,
    fieldErrors: Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "_", i.message])),
  };
}

async function ctxActor(ctx: Awaited<ReturnType<typeof requireTenantContext>>) {
  const h = await headers();
  return {
    userId: ctx.session.userId,
    label: ctx.session.email,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

function rev(locale: string) {
  revalidatePath(`/${locale}/team`);
}

function parseServiceIds(fd: FormData): string[] {
  return fd.getAll("serviceIds").map(String).filter(Boolean);
}

export async function saveEmployeeAction(_prev: TeamState, fd: FormData): Promise<TeamState> {
  const ctx = await requireTenantContext({ permission: "employee.write" });
  const parsed = employeeSchema.safeParse({
    ...Object.fromEntries(fd),
    serviceIds: parseServiceIds(fd),
  });
  if (!parsed.success) return zerr(parsed.error);
  const id = String(fd.get("id") ?? "");
  try {
    if (id) await updateEmployee(ctx.tenantId, id, parsed.data, await ctxActor(ctx));
    else await createEmployee(ctx.tenantId, parsed.data, await ctxActor(ctx));
  } catch (e) {
    if (e instanceof Error && e.name === "ValidationError")
      return { ok: false, code: "invalidServices" };
    if (e instanceof Error && e.name === "NotFoundError") return { ok: false, code: "notFound" };
    throw e;
  }
  rev(String(fd.get("locale") ?? "pt-BR"));
  return OK;
}

export async function setEmployeeStatusAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "employee.write" });
  const id = String(fd.get("id") ?? "");
  const status = String(fd.get("status") ?? "");
  if (!id || !["ACTIVE", "INACTIVE", "ON_VACATION"].includes(status)) return;
  await setEmployeeStatus(ctx.tenantId, id, status as never, await ctxActor(ctx));
  rev(String(fd.get("locale") ?? "pt-BR"));
}

export async function saveWorkHoursAction(_prev: TeamState, fd: FormData): Promise<TeamState> {
  const ctx = await requireTenantContext({ permission: "employee.write" });
  const employeeId = String(fd.get("employeeId") ?? "");
  let json: unknown;
  try {
    json = JSON.parse(String(fd.get("rows") ?? ""));
  } catch {
    return { ok: false, code: "invalid" };
  }
  const parsed = workHoursSchema.safeParse(json);
  if (!parsed.success) return zerr(parsed.error);
  try {
    await replaceEmployeeWorkHours(ctx.tenantId, employeeId, parsed.data, await ctxActor(ctx));
  } catch (e) {
    if (e instanceof Error && e.name === "NotFoundError") return { ok: false, code: "notFound" };
    throw e;
  }
  rev(String(fd.get("locale") ?? "pt-BR"));
  return OK;
}

/** BARBER edits their own profile subset; OWNER/MANAGER use saveEmployeeAction. */
export async function saveSelfProfileAction(_prev: TeamState, fd: FormData): Promise<TeamState> {
  const ctx = await requireTenantContext({ permission: "employee.self.write" });
  const me = await getEmployeeByUser(ctx.tenantId, ctx.session.userId);
  if (!me) return { ok: false, code: "notLinked" };
  const parsed = selfProfileSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zerr(parsed.error);
  await updateSelfProfile(ctx.tenantId, me.id, parsed.data, await ctxActor(ctx));
  rev(String(fd.get("locale") ?? "pt-BR"));
  return OK;
}

export async function addTimeOffAction(_prev: TeamState, fd: FormData): Promise<TeamState> {
  const ctx = await requireTenantContext();
  const requestedEmployeeId = String(fd.get("employeeId") ?? "") || null;

  // OWNER/MANAGER (employee.write) can set time off for anyone; a BARBER
  // (employee.self.write only) may only set it for their own linked record.
  let employeeId = requestedEmployeeId;
  if (!ctx.can("employee.write")) {
    if (!ctx.can("employee.self.write")) throw new AuthorizationError();
    const me = await getEmployeeByUser(ctx.tenantId, ctx.session.userId);
    if (!me) return { ok: false, code: "notLinked" };
    if (requestedEmployeeId && requestedEmployeeId !== me.id) throw new AuthorizationError();
    employeeId = me.id;
  }

  const parsed = timeOffSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zerr(parsed.error);
  try {
    await addTimeOff(ctx.tenantId, { ...parsed.data, employeeId }, await ctxActor(ctx));
  } catch (e) {
    if (e instanceof Error && e.name === "NotFoundError") return { ok: false, code: "notFound" };
    throw e;
  }
  rev(String(fd.get("locale") ?? "pt-BR"));
  return OK;
}

export async function removeTimeOffAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(fd.get("id") ?? "");
  if (!id) return;

  if (!ctx.can("employee.write")) {
    if (!ctx.can("employee.self.write")) throw new AuthorizationError();
    const me = await getEmployeeByUser(ctx.tenantId, ctx.session.userId);
    const row = await prisma.blockedTime.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { employeeId: true },
    });
    if (!me || !row || row.employeeId !== me.id) throw new AuthorizationError();
  }
  await removeTimeOff(ctx.tenantId, id, await ctxActor(ctx));
  rev(String(fd.get("locale") ?? "pt-BR"));
}
