import "server-only";
import { prisma } from "@/server/db/client";
import { getCountry } from "@/lib/regions";
import { logger } from "@/lib/logger";
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from "./booking-config";
import type { ChatbotConfig } from "@/features/chatbot/config";
import { generateUniqueSlug } from "./slug";
import type { CreateTenantInput, TenantProfileInput, BusinessHoursInput } from "./schema";

const TRIAL_DAYS = 14;

/** Default weekly hours seeded on tenant creation: Mon–Sat 09:00–19:00. */
const DEFAULT_OPEN_WEEKDAYS = [1, 2, 3, 4, 5, 6];
const DEFAULT_START_MIN = 9 * 60;
const DEFAULT_END_MIN = 19 * 60;

export async function slugExists(slug: string): Promise<boolean> {
  const row = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return row !== null;
}

export function suggestSlug(name: string): Promise<string> {
  return generateUniqueSlug(name, slugExists);
}

interface CreateTenantArgs {
  userId: string;
  userEmail: string;
  input: CreateTenantInput;
  ip?: string | null;
}

/**
 * Creates the barbershop + owner membership + default weekly hours + a
 * not-connected payout account, atomically. Status starts at TRIALING with a
 * 14-day trial window — a trial is NOT a paid activation. `status = ACTIVE` is
 * only ever set from a verified Stripe webhook (Slice 5).
 */
export async function createTenantWithOwner(args: CreateTenantArgs): Promise<{
  tenantId: string;
  slug: string;
}> {
  const { userId, userEmail, input, ip } = args;
  const country = getCountry(input.country);

  const tenant = await prisma.$transaction(async (tx) => {
    // Re-check slug inside the tx to close the check→create race.
    const taken = await tx.tenant.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (taken) {
      const err = new Error("slug_taken");
      err.name = "SlugTakenError";
      throw err;
    }

    const created = await tx.tenant.create({
      data: {
        name: input.name,
        slug: input.slug,
        status: "TRIALING",
        locale: input.locale,
        timezone: input.timezone,
        currency: input.currency,
        country: input.country || country?.code || "BR",
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
        bookingConfig: DEFAULT_BOOKING_CONFIG,
        members: {
          create: {
            userId,
            role: "OWNER",
            invitedAt: new Date(),
            acceptedAt: new Date(),
          },
        },
        businessHours: {
          create: DEFAULT_OPEN_WEEKDAYS.map((weekday) => ({
            weekday,
            startMin: DEFAULT_START_MIN,
            endMin: DEFAULT_END_MIN,
          })),
        },
        payoutAccount: {
          create: { provider: "stripe", status: "NOT_CONNECTED" },
        },
      },
      select: { id: true, slug: true },
    });

    await tx.auditLog.create({
      data: {
        tenantId: created.id,
        actorType: "USER",
        actorId: userId,
        actorLabel: userEmail,
        action: "tenant.created",
        targetType: "Tenant",
        targetId: created.id,
        ip: ip ?? null,
        metadata: { slug: created.slug, country: input.country, currency: input.currency },
      },
    });

    return created;
  });

  logger.info({ tenantId: tenant.id, userId }, "tenant.created");
  return { tenantId: tenant.id, slug: tenant.slug };
}

export async function getTenantById(tenantId: string) {
  return prisma.tenant.findUnique({ where: { id: tenantId } });
}

interface Actor {
  userId: string;
  label: string;
  ip?: string | null;
}

export async function updateTenantProfile(
  tenantId: string,
  input: TenantProfileInput,
  actor: Actor,
) {
  const clean = (v: string | undefined) => (v && v.length > 0 ? v : null);
  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: input.name,
        description: clean(input.description),
        email: clean(input.email),
        phone: clean(input.phone),
        whatsapp: clean(input.whatsapp),
        instagram: clean(input.instagram),
        website: clean(input.website),
        addressLine1: clean(input.addressLine1),
        addressLine2: clean(input.addressLine2),
        city: clean(input.city),
        state: clean(input.state),
        postalCode: clean(input.postalCode),
      },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: actor.userId,
        actorLabel: actor.label,
        action: "tenant.profile_updated",
        targetType: "Tenant",
        targetId: tenantId,
        ip: actor.ip ?? null,
      },
    }),
  ]);
}

export async function updateTenantRegional(
  tenantId: string,
  input: { country: string; currency: string; timezone: string; locale: string },
  actor: Actor,
) {
  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: tenantId },
      data: {
        country: input.country,
        currency: input.currency,
        timezone: input.timezone,
        locale: input.locale,
      },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: actor.userId,
        actorLabel: actor.label,
        action: "tenant.regional_updated",
        targetType: "Tenant",
        targetId: tenantId,
        ip: actor.ip ?? null,
        metadata: { ...input },
      },
    }),
  ]);
}

export async function setTenantLogo(tenantId: string, kind: "logo" | "cover", url: string) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: kind === "logo" ? { logoUrl: url } : { coverUrl: url },
  });
}

export async function updateBookingConfig(tenantId: string, config: BookingConfig, actor: Actor) {
  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: tenantId },
      data: { bookingConfig: config },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: actor.userId,
        actorLabel: actor.label,
        action: "tenant.booking_config_updated",
        targetType: "Tenant",
        targetId: tenantId,
        ip: actor.ip ?? null,
      },
    }),
  ]);
}

export async function updateChatbotConfig(tenantId: string, config: ChatbotConfig, actor: Actor) {
  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: tenantId },
      data: { chatbotConfig: config },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        actorType: "USER",
        actorId: actor.userId,
        actorLabel: actor.label,
        action: "tenant.chatbot_config_updated",
        targetType: "Tenant",
        targetId: tenantId,
        ip: actor.ip ?? null,
      },
    }),
  ]);
}

// ---- Business hours (tenant-level rows: employeeId = null) --------------
//
// These use the raw client with an explicit tenantId. Multi-step writes inside
// `$transaction` are clearer to reason about with the predicate spelled out than
// relying on the tenant-scope extension propagating into the tx callback.

export async function getBusinessHours(tenantId: string) {
  return prisma.businessHour.findMany({
    where: { tenantId, employeeId: null },
    orderBy: { weekday: "asc" },
  });
}

export async function replaceBusinessHours(tenantId: string, input: BusinessHoursInput) {
  const open = input.rows.filter((r) => r.open);
  await prisma.$transaction([
    prisma.businessHour.deleteMany({ where: { tenantId, employeeId: null } }),
    prisma.businessHour.createMany({
      data: open.map((r) => ({
        tenantId,
        weekday: r.weekday,
        startMin: r.startMin,
        endMin: r.endMin,
      })),
    }),
  ]);
}

// ---- Holidays -------------------------------------------------------

export async function listHolidays(tenantId: string) {
  return prisma.holiday.findMany({ where: { tenantId }, orderBy: { date: "asc" } });
}

export async function addHoliday(
  tenantId: string,
  input: { date: string; name: string; isClosed: boolean },
) {
  const date = new Date(`${input.date}T00:00:00.000Z`);
  await prisma.holiday.upsert({
    where: { tenantId_date: { tenantId, date } },
    update: { name: input.name, isClosed: input.isClosed },
    create: { tenantId, date, name: input.name, isClosed: input.isClosed },
  });
}

export async function removeHoliday(tenantId: string, id: string) {
  await prisma.holiday.deleteMany({ where: { id, tenantId } });
}
