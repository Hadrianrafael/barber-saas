import "server-only";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { formatMoney } from "@/lib/utils";
import { isConfigured } from "@/env";
import { getAvailableSlots } from "@/features/scheduling/availability";
import {
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
} from "@/features/scheduling/appointments";
import { isSchedulingError } from "@/features/scheduling/errors";
import { resolveOrCreateCustomer, CustomerBlockedError } from "@/features/customers/resolve";
import { createPaymentLink } from "@/features/payments/links";
import type { AnthropicToolDef } from "./anthropic";

/**
 * The chatbot's capabilities are FIXED here — they are not a member role and can
 * never be widened by tenant config or by the model. Every tool:
 *   - is hard-scoped to `ctx.tenantId`
 *   - only ever touches the ONE customer bound to the conversation
 *     (`ctx.customerId`, set by `identify_customer`)
 *   - goes through the same scheduling domain as staff/public booking, so every
 *     business rule (hours, lead time, double-booking, buffers) still applies
 *   - returns plain data; it never performs a staff-only operation (finance,
 *     team, settings, other customers, campaigns, audit).
 */
export interface ChatToolContext {
  tenantId: string;
  conversationId: string;
  locale: string;
  customerId: string | null;
}

const BOT_ACTOR = { userId: null as string | null, label: "chatbot" };

export const CHATBOT_TOOLS: AnthropicToolDef[] = [
  {
    name: "list_services",
    description:
      "List the barbershop's active services with real prices and durations. Use this before quoting any price — never guess.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_barbers",
    description: "List the barbershop's active barbers/professionals.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "check_availability",
    description:
      "Get real bookable start times for a service on a given date (the shop's timezone). Optionally restrict to one barber. Never invent availability.",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        dateISO: { type: "string", description: "YYYY-MM-DD" },
        employeeId: { type: "string", description: "optional barber id" },
      },
      required: ["serviceId", "dateISO"],
      additionalProperties: false,
    },
  },
  {
    name: "identify_customer",
    description:
      "Register who you are talking to before booking or looking up their appointments. Ask for their name and an email or phone first.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "my_appointments",
    description: "List the identified customer's upcoming appointments.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "book_appointment",
    description:
      "Book an appointment for the identified customer. Requires a start time you obtained from check_availability.",
    input_schema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        startsAt: { type: "string", description: "ISO 8601 instant from check_availability" },
        employeeId: { type: "string", description: "optional; omit for any available barber" },
        notes: { type: "string" },
      },
      required: ["serviceId", "startsAt"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_appointment",
    description: "Cancel one of the identified customer's own appointments.",
    input_schema: {
      type: "object",
      properties: { appointmentId: { type: "string" } },
      required: ["appointmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "reschedule_appointment",
    description:
      "Move one of the identified customer's own appointments to a new start time obtained from check_availability.",
    input_schema: {
      type: "object",
      properties: {
        appointmentId: { type: "string" },
        startsAt: { type: "string" },
        employeeId: { type: "string" },
      },
      required: ["appointmentId", "startsAt"],
      additionalProperties: false,
    },
  },
  {
    name: "create_payment_link",
    description:
      "Create a secure card payment link for one of the identified customer's appointments and send it to them. Only if the shop has online payments enabled.",
    input_schema: {
      type: "object",
      properties: { appointmentId: { type: "string" } },
      required: ["appointmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "handoff_to_human",
    description:
      "Hand the conversation to a staff member when the customer asks for a human, is unhappy, or needs something you cannot do. After calling this, tell the customer a person will follow up.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];

type ToolResult = Record<string, unknown>;

function needIdentity(): ToolResult {
  return {
    error: "not_identified",
    message: "Call identify_customer first (need name + email or phone).",
  };
}

async function assertOwnAppointment(ctx: ChatToolContext, appointmentId: string) {
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId: ctx.tenantId, customerId: ctx.customerId ?? "__none__" },
    select: {
      id: true,
      serviceId: true,
      status: true,
      startsAt: true,
      priceCents: true,
      currency: true,
    },
  });
  return appt;
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "list_services": {
        const rows = await prisma.service.findMany({
          where: { tenantId: ctx.tenantId, status: "ACTIVE" },
          orderBy: { priceCents: "asc" },
          select: {
            id: true,
            name: true,
            description: true,
            durationMin: true,
            priceCents: true,
            currency: true,
          },
        });
        return {
          services: rows.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description ?? undefined,
            durationMin: s.durationMin,
            price: formatMoney(s.priceCents, s.currency, ctx.locale),
          })),
        };
      }

      case "list_barbers": {
        const rows = await prisma.employee.findMany({
          where: { tenantId: ctx.tenantId, status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true, specialties: true },
        });
        return { barbers: rows };
      }

      case "check_availability": {
        const serviceId = String(input.serviceId ?? "");
        const dateISO = String(input.dateISO ?? "");
        const employeeId = input.employeeId ? String(input.employeeId) : undefined;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { error: "bad_date" };
        const result = await getAvailableSlots({
          tenantId: ctx.tenantId,
          serviceId,
          dateISO,
          employeeId,
        });
        const times = new Map<string, string>();
        for (const emp of result.byEmployee) {
          for (const s of emp.slots)
            if (!times.has(s.startsAt)) times.set(s.startsAt, emp.employeeId);
        }
        return {
          timezone: result.timezone,
          service: result.service.name,
          slots: [...times.entries()]
            .sort()
            .slice(0, 40)
            .map(([startsAt, employeeId]) => ({ startsAt, employeeId })),
        };
      }

      case "identify_customer": {
        const name = String(input.name ?? "").trim();
        if (name.length < 2) return { error: "name_required" };
        const id = await resolveOrCreateCustomer(ctx.tenantId, {
          name,
          email: input.email ? String(input.email) : null,
          phone: input.phone ? String(input.phone) : null,
          locale: ctx.locale,
          source: "CHATBOT",
        });
        ctx.customerId = id;
        await prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: { customerId: id },
        });
        return { ok: true, customerId: id };
      }

      case "my_appointments": {
        if (!ctx.customerId) return needIdentity();
        const rows = await prisma.appointment.findMany({
          where: {
            tenantId: ctx.tenantId,
            customerId: ctx.customerId,
            status: { in: ["PENDING", "CONFIRMED"] },
            startsAt: { gte: new Date() },
          },
          orderBy: { startsAt: "asc" },
          take: 10,
          select: {
            id: true,
            startsAt: true,
            serviceName: true,
            status: true,
            employee: { select: { name: true } },
          },
        });
        return {
          appointments: rows.map((a) => ({
            id: a.id,
            startsAt: a.startsAt.toISOString(),
            service: a.serviceName,
            barber: a.employee.name,
            status: a.status,
          })),
        };
      }

      case "book_appointment": {
        if (!ctx.customerId) return needIdentity();
        const appt = await createAppointment({
          tenantId: ctx.tenantId,
          serviceId: String(input.serviceId ?? ""),
          employeeId: input.employeeId ? String(input.employeeId) : await pickBarber(ctx, input),
          customerId: ctx.customerId,
          startsAt: new Date(String(input.startsAt ?? "")),
          source: "CHATBOT",
          notes: input.notes ? String(input.notes).slice(0, 500) : null,
          actor: BOT_ACTOR,
        });
        return {
          ok: true,
          appointmentId: appt.id,
          startsAt: appt.startsAt.toISOString(),
          price: formatMoney(appt.priceCents, appt.currency, ctx.locale),
        };
      }

      case "cancel_appointment": {
        if (!ctx.customerId) return needIdentity();
        const appt = await assertOwnAppointment(ctx, String(input.appointmentId ?? ""));
        if (!appt) return { error: "not_found" };
        await cancelAppointment(ctx.tenantId, appt.id, BOT_ACTOR, "customer_via_chatbot");
        return { ok: true };
      }

      case "reschedule_appointment": {
        if (!ctx.customerId) return needIdentity();
        const appt = await assertOwnAppointment(ctx, String(input.appointmentId ?? ""));
        if (!appt) return { error: "not_found" };
        await rescheduleAppointment({
          tenantId: ctx.tenantId,
          appointmentId: appt.id,
          startsAt: new Date(String(input.startsAt ?? "")),
          employeeId: input.employeeId ? String(input.employeeId) : undefined,
          actor: BOT_ACTOR,
        });
        return { ok: true };
      }

      case "create_payment_link": {
        if (!ctx.customerId) return needIdentity();
        if (!isConfigured.stripeConnect) return { error: "payments_unavailable" };
        const appt = await assertOwnAppointment(ctx, String(input.appointmentId ?? ""));
        if (!appt) return { error: "not_found" };
        try {
          const link = await createPaymentLink({
            tenantId: ctx.tenantId,
            description: `Appointment ${appt.serviceId}`,
            amountCents: appt.priceCents,
            currency: appt.currency,
            customerId: ctx.customerId,
            appointmentId: appt.id,
            locale: ctx.locale,
            notify: true,
          });
          return { ok: true, url: link.url };
        } catch (e) {
          if (e instanceof Error && e.name === "ConnectNotReadyError")
            return { error: "payments_unavailable" };
          throw e;
        }
      }

      case "handoff_to_human": {
        await prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: { status: "PENDING_HUMAN" },
        });
        logger.info(
          { conversationId: ctx.conversationId, reason: String(input.reason ?? "") },
          "chatbot.handoff",
        );
        return { ok: true, handedOff: true };
      }

      default:
        return { error: "unknown_tool" };
    }
  } catch (e) {
    if (isSchedulingError(e)) return { error: e.code };
    if (e instanceof CustomerBlockedError) return { error: "customer_blocked" };
    logger.warn({ err: (e as Error).message, tool: name }, "chatbot.tool_failed");
    return { error: "tool_failed" };
  }
}

/** Resolve "any barber" the same way the public flow does. */
async function pickBarber(ctx: ChatToolContext, input: Record<string, unknown>): Promise<string> {
  const serviceId = String(input.serviceId ?? "");
  const startsAt = new Date(String(input.startsAt ?? ""));
  const dateISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: (
      await prisma.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { timezone: true },
      })
    ).timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(startsAt);
  const avail = await getAvailableSlots({ tenantId: ctx.tenantId, serviceId, dateISO });
  const wanted = startsAt.toISOString();
  const match = avail.byEmployee.find((e) => e.slots.some((s) => s.startsAt === wanted));
  if (!match)
    throw new (await import("@/features/scheduling/errors")).SchedulingError("SLOT_TAKEN");
  return match.employeeId;
}
