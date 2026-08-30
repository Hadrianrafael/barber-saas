import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/regions";

export const serviceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  priceCents: z.coerce.number().int().min(0).max(100_000_00),
  currency: z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]),
  durationMin: z.coerce.number().int().min(5).max(480),
  bufferMin: z.coerce.number().int().min(0).max(120).default(0),
  status: z.enum(["ACTIVE", "ARCHIVED"]).default("ACTIVE"),
  employeeIds: z.array(z.string().min(1)).default([]),
});
export type ServiceInput = z.infer<typeof serviceSchema>;
