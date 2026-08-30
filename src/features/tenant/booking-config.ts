import { z } from "zod";

/**
 * Per-tenant booking rules, persisted as `Tenant.bookingConfig` (JSON) and
 * validated here. The agenda + public booking flow (Slices 3 & 9) read this.
 */
export const bookingConfigSchema = z.object({
  /** Slot grid granularity in minutes for the public booking page. */
  slotGranularityMin: z.number().int().min(5).max(120).default(15),
  /** Minimum notice before a slot can be booked online (minutes). */
  minLeadTimeMin: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 7)
    .default(120),
  /** How far ahead clients may book online (days). */
  maxAdvanceDays: z.number().int().min(1).max(365).default(60),
  /** Master switch for online self-booking (dashboard booking still works). */
  onlineBookingEnabled: z.boolean().default(true),
  /** Require a client to choose a specific barber (vs "any available"). */
  requireEmployeeSelection: z.boolean().default(false),
  /** Allow clients to cancel/reschedule online up to N hours before. */
  clientCancellationCutoffHours: z.number().int().min(0).max(168).default(12),
  /** Default gap kept after each appointment (minutes) unless the service overrides. */
  defaultBufferMin: z.number().int().min(0).max(120).default(0),
});

export type BookingConfig = z.infer<typeof bookingConfigSchema>;

export const DEFAULT_BOOKING_CONFIG: BookingConfig = bookingConfigSchema.parse({});

export function parseBookingConfig(value: unknown): BookingConfig {
  const result = bookingConfigSchema.safeParse(value ?? {});
  return result.success ? result.data : DEFAULT_BOOKING_CONFIG;
}
