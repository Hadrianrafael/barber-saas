import { z } from "zod";
import {
  COUNTRY_CODES,
  SUPPORTED_CURRENCIES,
  SUPPORTED_LOCALES,
  isValidTimezone,
} from "@/lib/regions";
import { SLUG_MAX, SLUG_MIN } from "./slug";
import { optionalPhone } from "@/lib/validation";

const localeEnum = z.enum(SUPPORTED_LOCALES);
const countryEnum = z.enum(COUNTRY_CODES as [string, ...string[]]);
const currencyEnum = z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]);
const timezone = z.string().refine(isValidTimezone, { message: "invalidTimezone" });

const optionalUrl = z
  .string()
  .trim()
  .max(200)
  .refine((v) => v === "" || /^https?:\/\/.+/.test(v), { message: "invalidUrl" })
  .optional()
  .or(z.literal(""));

// ---- Onboarding: create barbershop --------------------------------------
export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().min(SLUG_MIN).max(SLUG_MAX),
  country: countryEnum,
  currency: currencyEnum,
  timezone,
  locale: localeEnum,
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

// ---- Settings: public profile / contact --------------------------------
export const tenantProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  instagram: z
    .string()
    .trim()
    .max(60)
    .transform((v) => v.replace(/^@/, ""))
    .optional()
    .or(z.literal("")),
  website: optionalUrl,
  addressLine1: z.string().trim().max(180).optional().or(z.literal("")),
  addressLine2: z.string().trim().max(180).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state: z.string().trim().max(120).optional().or(z.literal("")),
  postalCode: z.string().trim().max(32).optional().or(z.literal("")),
});
export type TenantProfileInput = z.infer<typeof tenantProfileSchema>;

// ---- Settings: regional --------------------------------------------------
export const tenantRegionalSchema = z.object({
  country: countryEnum,
  currency: currencyEnum,
  timezone,
  locale: localeEnum,
});

// ---- Business hours ----------------------------------------------------
export const businessHourRowSchema = z
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
  })
  .refine((r) => !r.open || r.endMin > r.startMin, {
    message: "endBeforeStart",
    path: ["endMin"],
  });

export const businessHoursSchema = z.object({
  rows: z.array(businessHourRowSchema).length(7),
});
export type BusinessHoursInput = z.infer<typeof businessHoursSchema>;

// ---- Holidays -------------------------------------------------------
export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate"),
  name: z.string().trim().min(1).max(120),
  isClosed: z.boolean().default(true),
});
export type HolidayInput = z.infer<typeof holidaySchema>;
