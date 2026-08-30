import { describe, it, expect } from "vitest";
import { employeeSchema, workHoursSchema, timeOffSchema } from "@/features/team/schema";
import { serviceSchema } from "@/features/services/schema";

const baseEmployee = {
  name: "Rafa",
  title: "",
  email: "",
  phone: "",
  specialties: "fade, beard",
  commissionType: "PERCENT" as const,
  commissionBps: "3000",
  commissionFixedCents: "0",
  status: "ACTIVE" as const,
  serviceIds: [],
};

describe("employeeSchema", () => {
  it("parses specialties from a comma list and coerces commission", () => {
    const r = employeeSchema.parse(baseEmployee);
    expect(r.specialties).toEqual(["fade", "beard"]);
    expect(r.commissionBps).toBe(3000);
  });
  it("rejects a bad phone", () => {
    expect(employeeSchema.safeParse({ ...baseEmployee, phone: "abc" }).success).toBe(false);
  });
  it("accepts a fixed commission", () => {
    const r = employeeSchema.parse({
      ...baseEmployee,
      commissionType: "FIXED",
      commissionFixedCents: "1500",
    });
    expect(r.commissionType).toBe("FIXED");
    expect(r.commissionFixedCents).toBe(1500);
  });
});

describe("workHoursSchema", () => {
  const row = (o: Partial<Record<string, unknown>> = {}) => ({
    weekday: 1,
    open: true,
    startMin: 540,
    endMin: 1140,
    breakStartMin: null,
    breakEndMin: null,
    ...o,
  });
  it("requires exactly 7 rows", () => {
    expect(workHoursSchema.safeParse({ rows: [row()] }).success).toBe(false);
  });
  it("rejects end before start on an open day", () => {
    const rows = Array.from({ length: 7 }, () => row());
    rows[1] = row({ endMin: 400 });
    expect(workHoursSchema.safeParse({ rows }).success).toBe(false);
  });
  it("rejects a break outside the working window", () => {
    const rows = Array.from({ length: 7 }, () => row());
    rows[1] = row({ breakStartMin: 500, breakEndMin: 560 }); // before startMin 540
    expect(workHoursSchema.safeParse({ rows }).success).toBe(false);
  });
  it("accepts a valid break", () => {
    const rows = Array.from({ length: 7 }, () => row());
    rows[1] = row({ breakStartMin: 720, breakEndMin: 780 });
    expect(workHoursSchema.safeParse({ rows }).success).toBe(true);
  });
});

describe("timeOffSchema", () => {
  it("rejects end before start", () => {
    expect(
      timeOffSchema.safeParse({
        kind: "VACATION",
        startsAt: "2026-05-10T09:00",
        endsAt: "2026-05-09T09:00",
        reason: "",
      }).success,
    ).toBe(false);
  });
});

describe("serviceSchema", () => {
  const base = {
    name: "Corte",
    description: "",
    priceCents: "4000",
    currency: "BRL",
    durationMin: "30",
    bufferMin: "0",
    status: "ACTIVE" as const,
    employeeIds: [],
  };
  it("coerces numeric fields", () => {
    const r = serviceSchema.parse(base);
    expect(r.priceCents).toBe(4000);
    expect(r.durationMin).toBe(30);
  });
  it("rejects a duration below 5 or above 480", () => {
    expect(serviceSchema.safeParse({ ...base, durationMin: "3" }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...base, durationMin: "500" }).success).toBe(false);
  });
});
