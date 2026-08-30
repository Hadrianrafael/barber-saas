import { describe, it, expect } from "vitest";
import {
  DEFAULT_BOOKING_CONFIG,
  parseBookingConfig,
  bookingConfigSchema,
} from "@/features/tenant/booking-config";

describe("booking config", () => {
  it("has sane defaults", () => {
    expect(DEFAULT_BOOKING_CONFIG.slotGranularityMin).toBe(15);
    expect(DEFAULT_BOOKING_CONFIG.onlineBookingEnabled).toBe(true);
    expect(DEFAULT_BOOKING_CONFIG.maxAdvanceDays).toBe(60);
  });

  it("falls back to defaults on garbage input", () => {
    expect(parseBookingConfig(null)).toEqual(DEFAULT_BOOKING_CONFIG);
    expect(parseBookingConfig("nonsense")).toEqual(DEFAULT_BOOKING_CONFIG);
    expect(parseBookingConfig({ slotGranularityMin: 999 })).toEqual(DEFAULT_BOOKING_CONFIG);
  });

  it("merges partial valid input over defaults", () => {
    const cfg = bookingConfigSchema.parse({ maxAdvanceDays: 30, onlineBookingEnabled: false });
    expect(cfg.maxAdvanceDays).toBe(30);
    expect(cfg.onlineBookingEnabled).toBe(false);
    expect(cfg.slotGranularityMin).toBe(15);
  });

  it("rejects out-of-range values", () => {
    expect(bookingConfigSchema.safeParse({ slotGranularityMin: 3 }).success).toBe(false);
    expect(bookingConfigSchema.safeParse({ maxAdvanceDays: 0 }).success).toBe(false);
  });
});
