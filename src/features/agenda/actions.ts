"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantContext } from "@/server/rbac/guard";
import { isSchedulingError } from "@/features/scheduling/errors";
import {
  createAppointment,
  rescheduleAppointment,
  confirmAppointment,
  startAppointment,
  completeAppointment,
  markNoShow,
  cancelAppointment,
} from "@/features/scheduling/appointments";
import { getAvailableSlots } from "@/features/scheduling/availability";
import { assertCanManageAppointment, createQuickCustomer, searchCustomers } from "./service";

export interface AgendaState {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: Record<string, unknown>;
}

async function meta(ctx: Awaited<ReturnType<typeof requireTenantContext>>) {
  const h = await headers();
  return {
    userId: ctx.session.userId,
    label: ctx.session.email,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}
const rev = (locale: string) => revalidatePath(`/${locale}/agenda`);

// ---- availability (read) --------------------------------------------
export async function getSlotsAction(input: {
  serviceId: string;
  dateISO: string;
  employeeId?: string;
}): Promise<AgendaState> {
  const ctx = await requireTenantContext({ permission: "appointment.read" });
  const schema = z.object({
    serviceId: z.string().min(1),
    dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    employeeId: z.string().min(1).optional(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  try {
    const result = await getAvailableSlots({ tenantId: ctx.tenantId, ...parsed.data });
    return { ok: true, data: { result } };
  } catch (e) {
    if (isSchedulingError(e)) return { ok: false, code: e.code };
    throw e;
  }
}

export async function searchCustomersAction(term: string): Promise<AgendaState> {
  const ctx = await requireTenantContext({ permission: "customer.read" });
  const rows = await searchCustomers(ctx.tenantId, term);
  return { ok: true, data: { rows } };
}

// ---- create --------------------------------------------------------
const createSchema = z.object({
  serviceId: z.string().min(1),
  employeeId: z.string().min(1),
  startsAt: z.string().datetime({ offset: true }),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  // either an existing customer…
  customerId: z.string().min(1).optional().or(z.literal("")),
  // …or a walk-in
  customerName: z.string().trim().max(120).optional().or(z.literal("")),
  customerPhone: z.string().trim().max(24).optional().or(z.literal("")),
  customerEmail: z.string().trim().max(160).optional().or(z.literal("")),
  locale: z.string().default("pt-BR"),
});

export async function createAppointmentAction(
  _prev: AgendaState,
  fd: FormData,
): Promise<AgendaState> {
  const ctx = await requireTenantContext({ permission: "appointment.write" });
  const parsed = createSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message]),
      ),
    };
  }
  const d = parsed.data;

  let customerId = d.customerId || "";
  if (!customerId) {
    if (!d.customerName || d.customerName.length < 2) {
      return { ok: false, fieldErrors: { customerName: "required" } };
    }
    if (!ctx.can("customer.write")) return { ok: false, code: "forbiddenCustomer" };
    customerId = await createQuickCustomer(
      ctx.tenantId,
      {
        name: d.customerName,
        phone: d.customerPhone || null,
        email: d.customerEmail || null,
        locale: d.locale,
      },
      ctx.session.userId,
      ctx.session.email,
    );
  }

  try {
    const appt = await createAppointment({
      tenantId: ctx.tenantId,
      serviceId: d.serviceId,
      employeeId: d.employeeId,
      customerId,
      startsAt: new Date(d.startsAt),
      source: "DASHBOARD",
      notes: d.notes || null,
      actor: await meta(ctx),
      allowShortNotice: true, // staff can book walk-ins with no lead time
    });
    rev(d.locale);
    return { ok: true, code: "created", data: { id: appt.id } };
  } catch (e) {
    if (isSchedulingError(e)) return { ok: false, code: e.code };
    throw e;
  }
}

// ---- reschedule --------------------------------------------------
const rescheduleSchema = z.object({
  id: z.string().min(1),
  startsAt: z.string().datetime({ offset: true }),
  employeeId: z.string().min(1).optional().or(z.literal("")),
  locale: z.string().default("pt-BR"),
});

export async function rescheduleAppointmentAction(
  _prev: AgendaState,
  fd: FormData,
): Promise<AgendaState> {
  const ctx = await requireTenantContext({ permission: "appointment.write" });
  const parsed = rescheduleSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, code: "invalid" };
  await assertCanManageAppointment(ctx, parsed.data.id);
  try {
    await rescheduleAppointment({
      tenantId: ctx.tenantId,
      appointmentId: parsed.data.id,
      startsAt: new Date(parsed.data.startsAt),
      employeeId: parsed.data.employeeId || undefined,
      actor: await meta(ctx),
      allowShortNotice: true,
    });
    rev(parsed.data.locale);
    return { ok: true, code: "saved" };
  } catch (e) {
    if (isSchedulingError(e)) return { ok: false, code: e.code };
    throw e;
  }
}

// ---- status transitions --------------------------------------------
// Plain form actions: the UI only ever renders a transition button that is valid
// for the current status, so these throw (surfacing the framework error page)
// rather than threading an error state.
async function doTransition(
  fd: FormData,
  fn: (
    tenantId: string,
    id: string,
    actor: Awaited<ReturnType<typeof meta>>,
    reason?: string,
  ) => Promise<unknown>,
): Promise<void> {
  const ctx = await requireTenantContext({ permission: "appointment.write" });
  const id = String(fd.get("id") ?? "");
  const locale = String(fd.get("locale") ?? "pt-BR");
  if (!id) return;
  await assertCanManageAppointment(ctx, id);
  await fn(ctx.tenantId, id, await meta(ctx), String(fd.get("reason") ?? "") || undefined);
  rev(locale);
}

export async function confirmAppointmentAction(fd: FormData): Promise<void> {
  await doTransition(fd, (t, i, a) => confirmAppointment(t, i, a));
}
export async function startAppointmentAction(fd: FormData): Promise<void> {
  await doTransition(fd, (t, i, a) => startAppointment(t, i, a));
}
export async function completeAppointmentAction(fd: FormData): Promise<void> {
  await doTransition(fd, (t, i, a) => completeAppointment(t, i, a));
}
export async function noShowAppointmentAction(fd: FormData): Promise<void> {
  await doTransition(fd, (t, i, a) => markNoShow(t, i, a));
}
export async function cancelAppointmentAction(fd: FormData): Promise<void> {
  await doTransition(fd, (t, i, a, reason) => cancelAppointment(t, i, a, reason));
}
