import { describe, it, expect } from "vitest";
import {
  getCountry,
  isValidTimezone,
  COUNTRIES,
  ALL_TIMEZONES,
  SUPPORTED_CURRENCIES,
} from "@/lib/regions";

describe("regions", () => {
  it("resolves countries case-insensitively with defaults", () => {
    expect(getCountry("br")?.currency).toBe("BRL");
    expect(getCountry("US")?.currency).toBe("USD");
    expect(getCountry("MX")?.defaultLocale).toBe("es");
    expect(getCountry("ZZ")).toBeUndefined();
  });

  it("every country has a valid default timezone and a dial code", () => {
    for (const c of COUNTRIES) {
      expect(c.timezones.length).toBeGreaterThan(0);
      expect(isValidTimezone(c.timezones[0]!)).toBe(true);
      expect(c.dialCode.startsWith("+")).toBe(true);
    }
  });

  it("validates IANA timezones", () => {
    expect(isValidTimezone("America/Sao_Paulo")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });

  it("exposes de-duplicated sorted lists", () => {
    expect(ALL_TIMEZONES).toEqual([...ALL_TIMEZONES].sort());
    expect(new Set(ALL_TIMEZONES).size).toBe(ALL_TIMEZONES.length);
    expect(SUPPORTED_CURRENCIES).toContain("BRL");
    expect(SUPPORTED_CURRENCIES).toContain("USD");
    expect(SUPPORTED_CURRENCIES).toContain("EUR");
  });
});
