import { z } from "zod";
import { optionalPhone } from "@/lib/validation";

/** Availability lookup from the public page (no auth). */
export const publicSlotsSchema = z.object({
  serviceId: z.string().min(1),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeId: z.string().min(1).optional(),
});
export type PublicSlotsInput = z.infer<typeof publicSlotsSchema>;

/** Final booking submission. */
export const bookingSubmitSchema = z.object({
  serviceId: z.string().min(1),
  employeeId: z.string().min(1).optional().or(z.literal("")),
  startsAt: z.string().datetime({ offset: true }),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  phone: optionalPhone.optional(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  /** Explicit opt-in for WhatsApp reminders (never assumed). */
  whatsappOptIn: z.coerce.boolean().default(false),
  /** Whether the client wants to pay online now (only honoured if enabled). */
  payNow: z.coerce.boolean().default(false),
  locale: z.string().default("pt-BR"),
});
export type BookingSubmitInput = z.infer<typeof bookingSubmitSchema>;

/** Manage (cancel / reschedule) an existing booking via its opaque token. */
export const manageBookingSchema = z.object({
  token: z.string().min(10).max(200),
  action: z.enum(["cancel", "reschedule"]),
  startsAt: z.string().datetime({ offset: true }).optional(),
  employeeId: z.string().min(1).optional(),
  locale: z.string().default("pt-BR"),
});
export type ManageBookingInput = z.infer<typeof manageBookingSchema>;
