/**
 * Public booking flow (Slice 9) against a real Postgres. Gated on RUN_DB_TESTS=1.
 *
 * Verifies that the public entry point reuses the scheduling domain (no
 * re-implemented availability), prevents double booking, dedupes customers,
 * records explicit consent, and enforces the online change cutoff.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  getBookingContext,
  createPublicBooking,
  getBookingByToken,
  cancelPublicBooking,
} from "@/features/booking/service";
import { wallClockToUtc } from "@/features/scheduling/time";
import type { BookingSubmitInput } from "@/features/booking/schema";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();
const uniq = () => Math.random().toString(36).slice(2, 10);

async function makeShop() {
  const slug = `bk-${uniq()}`;
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: slug,
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      status: "ACTIVE",
      businessHours: {
        create: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 540, endMin: 1080 })),
      },
    },
  });
  const employee = await prisma.employee.create({
    data: { tenantId: tenant.id, name: `emp-${uniq()}`, status: "ACTIVE" },
  });
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: "Corte",
      priceCents: 5000,
      currency: "BRL",
      durationMin: 30,
      bufferMin: 0,
      status: "ACTIVE",
      employees: { create: { employeeId: employee.id } },
    },
  });
  return { tenant, employee, service };
}

/** An ISO date `days` out, snapped forward to Mon–Fri. */
function weekdayISO(days: number): string {
  const dt = new Date(Date.now() + days * 86_400_000);
  while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/** A slot ~10 days out at 10:00 tenant-local on a weekday. */
function futureSlotISO(tz: string): { startsAt: string; dateISO: string } {
  const iso = weekdayISO(10);
  return { startsAt: wallClockToUtc(iso, 10 * 60, tz).toISOString(), dateISO: iso };
}

function submitInput(over: Partial<BookingSubmitInput>): BookingSubmitInput {
  return {
    serviceId: "",
    employeeId: "",
    startsAt: "",
    name: "Cliente Teste",
    email: "",
    phone: "",
    notes: "",
    whatsappOptIn: false,
    payNow: false,
    locale: "pt-BR",
    ...over,
  };
}

d("public booking (DB)", () => {
  const shops: string[] = [];
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterAll(async () => {
    for (const id of shops) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("books through the public flow → PENDING appointment + self-service token", async () => {
    const { tenant, service } = await makeShop();
    shops.push(tenant.id);
    const ctx = await getBookingContext(tenant.slug);
    expect(ctx).not.toBeNull();

    const { startsAt } = futureSlotISO(tenant.timezone);
    const res = await createPublicBooking(
      ctx!,
      submitInput({ serviceId: service.id, startsAt, email: `a-${uniq()}@x.com` }),
    );
    expect(res.appointmentId).toBeTruthy();
    expect(res.token.length).toBeGreaterThan(10);
    expect(res.checkoutUrl).toBeUndefined(); // Connect not configured in tests

    const appt = await prisma.appointment.findUnique({ where: { id: res.appointmentId } });
    expect(appt!.status).toBe("PENDING");
    expect(appt!.source).toBe("PUBLIC_PAGE");
    expect(appt!.publicToken).not.toBeNull();

    const view = await getBookingByToken(res.token);
    expect(view!.id).toBe(res.appointmentId);
    expect(view!.serviceName).toBe("Corte");
  });

  it("rejects a second booking on the same slot/barber (SLOT_TAKEN)", async () => {
    const { tenant, service, employee } = await makeShop();
    shops.push(tenant.id);
    const ctx = await getBookingContext(tenant.slug);
    const { startsAt } = futureSlotISO(tenant.timezone);

    await createPublicBooking(
      ctx!,
      submitInput({
        serviceId: service.id,
        employeeId: employee.id,
        startsAt,
        email: `b-${uniq()}@x.com`,
      }),
    );
    await expect(
      createPublicBooking(
        ctx!,
        submitInput({
          serviceId: service.id,
          employeeId: employee.id,
          startsAt,
          email: `c-${uniq()}@x.com`,
        }),
      ),
    ).rejects.toMatchObject({ code: "SLOT_TAKEN" });
  });

  it("dedupes the customer by email across bookings and records WhatsApp opt-in", async () => {
    const { tenant, service } = await makeShop();
    shops.push(tenant.id);
    const ctx = await getBookingContext(tenant.slug);
    const tz = tenant.timezone;
    const email = `dup-${uniq()}@x.com`;

    const s1 = wallClockToUtc(weekdayISO(10), 600, tz).toISOString();
    const s2 = wallClockToUtc(weekdayISO(15), 600, tz).toISOString();

    await createPublicBooking(
      ctx!,
      submitInput({
        serviceId: service.id,
        startsAt: s1,
        email,
        phone: "+5511988887777",
        whatsappOptIn: true,
      }),
    );
    await createPublicBooking(ctx!, submitInput({ serviceId: service.id, startsAt: s2, email }));

    const customers = await prisma.customer.findMany({ where: { tenantId: tenant.id } });
    expect(customers).toHaveLength(1);
    const consents = await prisma.communicationConsent.findMany({
      where: { customerId: customers[0]!.id, channel: "WHATSAPP" },
    });
    expect(consents[0]?.granted).toBe(true);
    expect(consents[0]?.source).toBe("public_form");
  });

  it("cancels via token far from the appointment, but refuses inside the cutoff", async () => {
    const { tenant, service } = await makeShop();
    shops.push(tenant.id);
    const ctx = await getBookingContext(tenant.slug);
    const tz = tenant.timezone;

    const far = wallClockToUtc(weekdayISO(10), 600, tz).toISOString();
    const r1 = await createPublicBooking(
      ctx!,
      submitInput({ serviceId: service.id, startsAt: far, email: `e-${uniq()}@x.com` }),
    );
    await cancelPublicBooking(r1.token);
    const a1 = await prisma.appointment.findUnique({ where: { id: r1.appointmentId } });
    expect(a1!.status).toBe("CANCELED");

    // default clientCancellationCutoffHours = 12 → an appointment 2h out can't be changed online
    const soon = new Date(Date.now() + 2 * 3_600_000);
    const a2 = await prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        customerId: (await prisma.customer.create({ data: { tenantId: tenant.id, name: "X" } })).id,
        employeeId: (await prisma.employee.findFirstOrThrow({ where: { tenantId: tenant.id } })).id,
        serviceId: service.id,
        status: "CONFIRMED",
        source: "PUBLIC_PAGE",
        startsAt: soon,
        endsAt: new Date(soon.getTime() + 1800_000),
        serviceName: "Corte",
        durationMin: 30,
        bufferMin: 0,
        priceCents: 5000,
        currency: "BRL",
        publicToken: null,
      },
    });
    // give it a token the same way the service does
    const { hashToken } = await import("@/lib/crypto");
    const raw = "raw-" + uniq() + uniq();
    await prisma.appointment.update({
      where: { id: a2.id },
      data: { publicToken: hashToken(raw) },
    });

    await expect(cancelPublicBooking(raw)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
