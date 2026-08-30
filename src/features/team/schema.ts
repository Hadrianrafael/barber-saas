import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/regions";

const phone = z
  .string()
  .trim()
  .max(24)
  .refine((v) => v === "" || /^\+?[0-9][0-9\s().-]{6,20}$/.test(v), { message: "invalidPhone" })
  .transform((v) => v.replace(/[^\d+]/g, ""))
  .optional()
  .or(z.literal(""));

const specialties = z
  .string()
  .trim()
  .max(300)
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20),
  );

export const employeeSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    title: z.string().trim().max(80).optional().or(z.literal("")),
    email: z.string().trim().email().max(160).optional().or(z.literal("")),
    phone,
    specialties,
    commissionType: z.enum(["PERCENT", "FIXED"]),
    commissionBps: z.coerce.number().int().min(0).max(10000).default(0),
    commissionFixedCents: z.coerce.number().int().min(0).max(100_000_00).default(0),
    status: z.enum(["ACTIVE", "INACTIVE", "ON_VACATION"]).default("ACTIVE"),
    serviceIds: z.array(z.string().min(1)).default([]),
  })
  .refine(
    (d) => (d.commissionType === "PERCENT" ? d.commissionBps >= 0 : d.commissionFixedCents >= 0),
    {
      message: "commissionValue",
      path: ["commissionBps"],
    },
  );
export type EmployeeInput = z.infer<typeof employeeSchema>;

/** Fields a BARBER may change on their own record. */
export const selfProfileSchema = z.object({
  bio: z.string().trim().max(600).optional().or(z.literal("")),
  phone,
  photoUrl: z.string().trim().max(400).optional().or(z.literal("")),
  specialties,
});

export const workHourRowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    open: z.boolean(),
    startMin: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    endMin: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    breakStartMin: z
      .number()
      .int()
      .min(0)
      .max(24 * 60)
      .nullable(),
    breakEndMin: z
      .number()
      .int()
      .min(0)
      .max(24 * 60)
      .nullable(),
  })
  .refine((r) => !r.open || r.endMin > r.startMin, { message: "endBeforeStart", path: ["endMin"] })
  .refine(
    (r) =>
      r.breakStartMin == null ||
      r.breakEndMin == null ||
      (r.breakEndMin > r.breakStartMin &&
        r.breakStartMin >= r.startMin &&
        r.breakEndMin <= r.endMin),
    { message: "invalidBreak", path: ["breakEndMin"] },
  );

export const workHoursSchema = z.object({ rows: z.array(workHourRowSchema).length(7) });
export type WorkHoursInput = z.infer<typeof workHoursSchema>;

export const timeOffSchema = z
  .object({
    kind: z.enum(["TIME_OFF", "VACATION", "OTHER"]),
    startsAt: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)),
    endsAt: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)),
    reason: z.string().trim().max(200).optional().or(z.literal("")),
  })
  .refine((d) => new Date(d.endsAt).getTime() > new Date(d.startsAt).getTime(), {
    message: "endBeforeStart",
    path: ["endsAt"],
  });
export type TimeOffInput = z.infer<typeof timeOffSchema>;

export const currencyEnum = z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]);
