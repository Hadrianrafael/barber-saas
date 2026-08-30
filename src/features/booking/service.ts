import "server-only";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { generateToken, hashToken } from "@/lib/crypto";
import { isConfigured } from "@/env";
import { parseBookingConfig, type BookingConfig } from "@/features/tenant/booking-config";
import { getAvailableSlots } from "@/features/scheduling/availability";
import {
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
} from "@/features/scheduling/appointments";
import { SchedulingError } from "@/features/scheduling/errors";
import { resolveOrCreateCustomer, CustomerBlockedError } from "@/features/customers/resolve";
import type { BookingSubmitInput } from "./schema";

const PUBLIC_ACTOR = { userId: null as string | null, label: "public-booking" };

export interface BookingContext {
  tenant: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    currency: string;
    locale: string;
    logoUrl: string | null;
  };
  config: BookingConfig;
  onlineBookingEnabled: boolean;
  /** Online card payment is offered only when Connect is live *and* enabled. */
  paymentEnabled: boolean;
  services: {
    id: string;
    name: string;
    description: string | null;
    durationMin: number;
    priceCents: number;
    currency: string;
    employeeIds: string[];
  }[];
  employees: { id: string; name: string; photoUrl: string | null; specialties: string[] }[];
}

/**
 * Read model for the public booking flow. Returns null when the shop cannot be
 * booked at all (missing / suspended tenant, no active service+barber pair).
 */
export async function getBookingContext(slug: string): Promise<BookingContext | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      timezone: true,
      currency: true,
      locale: true,
      logoUrl: true,
      bookingConfig: true,
      services: {
        where: { status: "ACTIVE" },
        orderBy: { priceCents: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          durationMin: true,
          priceCents: true,
          currency: true,
          employees: {
            select: { employee: { select: { id: true, status: true } } },
          },
        },
      },
      employees: {
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, photoUrl: true, specialties: true },
      },
    },
  });
  if (!tenant) return null;
  if (tenant.status === "SUSPENDED" || tenant.status === "CANCELED") return null;

  const config = parseBookingConfig(tenant.bookingConfig);

  const services = tenant.services
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMin: s.durationMin,
      priceCents: s.priceCents,
      currency: s.currency,
      employeeIds: s.employees
        .filter((se) => se.employee.status === "ACTIVE")
        .map((se) => se.employee.id),
    }))
    .filter((s) => s.employeeIds.length > 0);

  if (services.length === 0) return null;

  let paymentEnabled = false;
  if (isConfigured.stripeConnect) {
    const acct = await prisma.payoutAccount.findUnique({
      where: { tenantId: tenant.id },
      select: { chargesEnabled: true, providerAccountId: true },
    });
    paymentEnabled = !!acct?.providerAccountId && acct.chargesEnabled;
  }

  return {
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      timezone: tenant.timezone,
      currency: tenant.currency,
      locale: tenant.locale,
      logoUrl: tenant.logoUrl,
    },
    config,
    onlineBookingEnabled: config.onlineBookingEnabled,
    paymentEnabled,
    services,
    employees: tenant.employees,
  };
}

/** Public availability — thin wrapper so the action layer never imports the domain directly. */
export function getPublicSlots(args: {
  tenantId: string;
  serviceId: string;
  dateISO: string;
  employeeId?: string;
}) {
  return getAvailableSlots(args);
}

/** Record an explicit WhatsApp opt-in from the booking form (double opt-in style). */
async function recordWhatsappOptIn(customerId: string) {
  await prisma.communicationConsent
    .upsert({
      where: { customerId_channel: { customerId, channel: "WHATSAPP" } },
      update: { granted: true, grantedAt: new Date(), revokedAt: null, source: "public_form" },
      create: {
        customerId,
        channel: "WHATSAPP",
        granted: true,
        grantedAt: new Date(),
        source: "public_form",
      },
    })
    .catch((e) => logger.warn({ err: (e as Error).message, customerId }, "consent.optin_failed"));
}

export interface BookingResult {
  appointmentId: string;
  token: string;
  checkoutUrl?: string;
}

/**
 * The one entry point the public flow calls. Reuses the scheduling domain for
 * every rule (lead time, advance limit, working hours, holidays, blocks,
 * double-booking) — nothing about availability is re-implemented here.
 */
export async function createPublicBooking(
  ctx: BookingContext,
  input: BookingSubmitInput,
): Promise<BookingResult> {
  if (!ctx.onlineBookingEnabled) throw new SchedulingError("VALIDATION", "online booking disabled");

  const svc = ctx.services.find((s) => s.id === input.serviceId);
  if (!svc) throw new SchedulingError("SERVICE_NOT_FOUND");

  const startsAt = new Date(input.startsAt);
  const dateISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: ctx.tenant.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(startsAt);

  // Resolve "any available barber" server-side against real availability.
  let employeeId = input.employeeId || undefined;
  if (employeeId && !svc.employeeIds.includes(employeeId)) {
    throw new SchedulingError("EMPLOYEE_CANT_DO_SERVICE");
  }
  if (!employeeId) {
    if (ctx.config.requireEmployeeSelection) {
      throw new SchedulingError("VALIDATION", "employee selection required");
    }
    const avail = await getAvailableSlots({
      tenantId: ctx.tenant.id,
      serviceId: input.serviceId,
      dateISO,
    });
    const wanted = startsAt.toISOString();
    const match = avail.byEmployee.find((e) => e.slots.some((s) => s.startsAt === wanted));
    if (!match) throw new SchedulingError("SLOT_TAKEN");
    employeeId = match.employeeId;
  }

  let customerId: string;
  try {
    customerId = await resolveOrCreateCustomer(ctx.tenant.id, {
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
      locale: input.locale,
      source: "PUBLIC_PAGE",
    });
  } catch (e) {
    if (e instanceof CustomerBlockedError) throw new SchedulingError("VALIDATION", "customer blocked");
    throw e;
  }
  if (input.whatsappOptIn && input.phone) await recordWhatsappOptIn(customerId);

  const appt = await createAppointment({
    tenantId: ctx.tenant.id,
    serviceId: input.serviceId,
    employeeId,
    customerId,
    startsAt,
    source: "PUBLIC_PAGE",
    notes: input.notes || null,
    actor: PUBLIC_ACTOR,
  });

  const rawToken = generateToken(24);
  await prisma.appointment.update({
    where: { id: appt.id },
    data: { publicToken: hashToken(rawToken) },
  });

  let checkoutUrl: string | undefined;
  if (input.payNow && ctx.paymentEnabled) {
    try {
      const { createPaymentLink } = await import("@/features/payments/links");
      const link = await createPaymentLink({
        tenantId: ctx.tenant.id,
        description: `${svc.name} — ${ctx.tenant.name}`,
        amountCents: appt.priceCents,
        currency: appt.currency,
        customerId,
        appointmentId: appt.id,
        locale: input.locale,
        notify: false,
      });
      checkoutUrl = link.url ?? undefined;
    } catch (e) {
      // Payment setup failing must not lose the booking — it stays PENDING and
      // the shop can collect in person.
      logger.warn(
        { err: (e as Error).message, appointmentId: appt.id },
        "booking.payment_link_failed",
      );
    }
  }

  logger.info(
    { tenantId: ctx.tenant.id, appointmentId: appt.id, paid: !!checkoutUrl },
    "public_booking.created",
  );
  return { appointmentId: appt.id, token: rawToken, checkoutUrl };
}

export interface PublicBookingView {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  serviceId: string;
  serviceName: string;
  priceCents: number;
  currency: string;
  employeeName: string;
  tenantName: string;
  tenantSlug: string;
  timezone: string;
  locale: string;
  canCancel: boolean;
  canReschedule: boolean;
  cutoffHours: number;
  paid: boolean;
}

export async function getBookingByToken(rawToken: string): Promise<PublicBookingView | null> {
  const appt = await prisma.appointment.findUnique({
    where: { publicToken: hashToken(rawToken) },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      serviceId: true,
      serviceName: true,
      priceCents: true,
      currency: true,
      employee: { select: { name: true } },
      tenant: {
        select: { name: true, slug: true, timezone: true, locale: true, bookingConfig: true },
      },
      payments: {
        where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } },
        select: { id: true },
      },
    },
  });
  if (!appt) return null;

  const cfg = parseBookingConfig(appt.tenant.bookingConfig);
  const cutoffMs = cfg.clientCancellationCutoffHours * 3_600_000;
  const withinCutoff = appt.startsAt.getTime() - Date.now() > cutoffMs;
  const open = appt.status === "PENDING" || appt.status === "CONFIRMED";

  return {
    id: appt.id,
    status: appt.status,
    startsAt: appt.startsAt.toISOString(),
    endsAt: appt.endsAt.toISOString(),
    serviceId: appt.serviceId,
    serviceName: appt.serviceName,
    priceCents: appt.priceCents,
    currency: appt.currency,
    employeeName: appt.employee.name,
    tenantName: appt.tenant.name,
    tenantSlug: appt.tenant.slug,
    timezone: appt.tenant.timezone,
    locale: appt.tenant.locale,
    canCancel: open && withinCutoff,
    canReschedule: open && withinCutoff,
    cutoffHours: cfg.clientCancellationCutoffHours,
    paid: appt.payments.length > 0,
  };
}

async function loadManageable(rawToken: string) {
  const appt = await prisma.appointment.findUnique({
    where: { publicToken: hashToken(rawToken) },
    select: {
      id: true,
      tenantId: true,
      serviceId: true,
      status: true,
      startsAt: true,
      tenant: { select: { timezone: true, bookingConfig: true } },
    },
  });
  if (!appt) throw new SchedulingError("APPOINTMENT_NOT_FOUND");
  if (appt.status !== "PENDING" && appt.status !== "CONFIRMED") {
    throw new SchedulingError("INVALID_TRANSITION", `cannot change a ${appt.status} booking`);
  }
  const cfg = parseBookingConfig(appt.tenant.bookingConfig);
  const cutoffMs = cfg.clientCancellationCutoffHours * 3_600_000;
  if (appt.startsAt.getTime() - Date.now() <= cutoffMs) {
    throw new SchedulingError("VALIDATION", "past the online change cutoff");
  }
  return appt;
}

export async function cancelPublicBooking(rawToken: string) {
  const appt = await loadManageable(rawToken);
  await cancelAppointment(appt.tenantId, appt.id, PUBLIC_ACTOR, "client_cancelled_online");
}

export async function reschedulePublicBooking(
  rawToken: string,
  startsAt: Date,
  employeeId?: string,
) {
  const appt = await loadManageable(rawToken);
  await rescheduleAppointment({
    tenantId: appt.tenantId,
    appointmentId: appt.id,
    startsAt,
    employeeId,
    actor: PUBLIC_ACTOR,
  });
}
