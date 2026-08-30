import { describe, it, expect } from "vitest";
import {
  bookingSubmitSchema,
  publicSlotsSchema,
  manageBookingSchema,
} from "@/features/booking/schema";

describe("bookingSubmitSchema", () => {
  const base = {
    serviceId: "svc_1",
    startsAt: "2026-09-10T13:00:00.000Z",
    name: "Ana Silva",
  };

  it("accepts a minimal valid submission and coerces checkboxes", () => {
    const r = bookingSubmitSchema.parse({ ...base, whatsappOptIn: "true", payNow: "" });
    expect(r.whatsappOptIn).toBe(true);
    expect(r.payNow).toBe(false);
    expect(r.locale).toBe("pt-BR");
  });

  it("normalises a formatted phone to bare digits (keeps a leading +)", () => {
    expect(bookingSubmitSchema.parse({ ...base, phone: "(11) 98888-7777" }).phone).toBe(
      "11988887777",
    );
    expect(bookingSubmitSchema.parse({ ...base, phone: "+34 600 123 456" }).phone).toBe(
      "+34600123456",
    );
  });

  it("rejects a non-datetime startsAt and a too-short name", () => {
    expect(bookingSubmitSchema.safeParse({ ...base, startsAt: "2026-09-10" }).success).toBe(false);
    expect(bookingSubmitSchema.safeParse({ ...base, name: "A" }).success).toBe(false);
  });

  it("rejects a bad email but allows an empty one", () => {
    expect(bookingSubmitSchema.safeParse({ ...base, email: "nope" }).success).toBe(false);
    expect(bookingSubmitSchema.safeParse({ ...base, email: "" }).success).toBe(true);
  });
});

describe("publicSlotsSchema", () => {
  it("requires an ISO date", () => {
    expect(publicSlotsSchema.safeParse({ serviceId: "s", dateISO: "2026-1-1" }).success).toBe(
      false,
    );
    expect(publicSlotsSchema.safeParse({ serviceId: "s", dateISO: "2026-01-01" }).success).toBe(
      true,
    );
  });
});

describe("manageBookingSchema", () => {
  it("only allows cancel / reschedule", () => {
    expect(manageBookingSchema.safeParse({ token: "x".repeat(12), action: "delete" }).success).toBe(
      false,
    );
    expect(manageBookingSchema.safeParse({ token: "x".repeat(12), action: "cancel" }).success).toBe(
      true,
    );
  });
});
