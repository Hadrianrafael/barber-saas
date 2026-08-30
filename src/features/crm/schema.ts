import { z } from "zod";
import { SUPPORTED_LOCALES } from "@/lib/regions";
import { optionalPhone } from "@/lib/validation";

const phone = optionalPhone;

export const customerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(160).optional().or(z.literal("")),
  phone,
  whatsapp: phone,
  locale: z.enum(SUPPORTED_LOCALES).default("pt-BR"),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  tags: z
    .string()
    .trim()
    .max(300)
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20),
    )
    .optional()
    .default(""),
  preferredEmployeeId: z.string().min(1).optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]).default("ACTIVE"),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const consentSchema = z.object({
  customerId: z.string().min(1),
  channel: z.enum(["EMAIL", "WHATSAPP", "SMS"]),
  granted: z.coerce.boolean(),
});

export const listFiltersSchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  status: z.enum(["ALL", "ACTIVE", "INACTIVE", "BLOCKED"]).default("ALL"),
  segment: z
    .enum([
      "all",
      "active",
      "inactive",
      "new",
      "recurring",
      "by_service",
      "by_employee",
      "opted_in",
    ])
    .default("all"),
  serviceId: z.string().optional().default(""),
  employeeId: z.string().optional().default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListFilters = z.infer<typeof listFiltersSchema>;
