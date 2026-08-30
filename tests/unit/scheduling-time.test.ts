import { describe, it, expect } from "vitest";
import {
  wallClockToUtc,
  weekdayInTz,
  dateISOInTz,
  subtractIntervals,
  mergeIntervals,
  intervalsOverlap,
  generateStartTimes,
  type Interval,
} from "@/features/scheduling/time";

describe("wallClockToUtc", () => {
  it("resolves the same wall clock to different instants per timezone", () => {
    // 2026-03-16 is a Monday; well clear of any DST transition in these zones.
    const sp = wallClockToUtc("2026-03-16", 9 * 60, "America/Sao_Paulo"); // UTC-3
    const ny = wallClockToUtc("2026-03-16", 9 * 60, "America/New_York"); // UTC-4 (EDT)
    const mad = wallClockToUtc("2026-03-16", 9 * 60, "Europe/Madrid"); // UTC+1 (CET)
    expect(sp.toISOString()).toBe("2026-03-16T12:00:00.000Z");
    expect(ny.toISOString()).toBe("2026-03-16T13:00:00.000Z");
    expect(mad.toISOString()).toBe("2026-03-16T08:00:00.000Z");
  });

  it("is DST-aware for US spring-forward", () => {
    // DST began 2026-03-08 in the US → America/New_York is UTC-4 afterwards.
    const before = wallClockToUtc("2026-03-01", 12 * 60, "America/New_York"); // EST UTC-5
    const after = wallClockToUtc("2026-03-15", 12 * 60, "America/New_York"); // EDT UTC-4
    expect(before.toISOString()).toBe("2026-03-01T17:00:00.000Z");
    expect(after.toISOString()).toBe("2026-03-15T16:00:00.000Z");
  });

  it("handles minute 1440 as the next midnight", () => {
    const end = wallClockToUtc("2026-03-16", 24 * 60, "America/Sao_Paulo");
    expect(end.toISOString()).toBe("2026-03-17T03:00:00.000Z");
  });
});

describe("weekdayInTz / dateISOInTz", () => {
  it("returns the local weekday", () => {
    expect(weekdayInTz("2026-03-16", "America/Sao_Paulo")).toBe(1); // Monday
    expect(weekdayInTz("2026-03-15", "America/Sao_Paulo")).toBe(0); // Sunday
  });
  it("round-trips a date through a timezone", () => {
    const instant = wallClockToUtc("2026-06-10", 10 * 60, "Europe/Madrid");
    expect(dateISOInTz(instant, "Europe/Madrid")).toBe("2026-06-10");
    // Same instant, a timezone far west, can be the previous day.
    expect(dateISOInTz(instant, "America/Los_Angeles")).toBe("2026-06-10");
  });
});

describe("interval math", () => {
  const iv = (s: number, e: number): Interval => ({ start: s, end: e });

  it("merges overlapping and touching intervals", () => {
    expect(mergeIntervals([iv(0, 10), iv(10, 20), iv(5, 8), iv(30, 40)])).toEqual([
      iv(0, 20),
      iv(30, 40),
    ]);
  });

  it("subtracts cuts, splitting where needed", () => {
    expect(subtractIntervals([iv(0, 100)], [iv(20, 30), iv(50, 60)])).toEqual([
      iv(0, 20),
      iv(30, 50),
      iv(60, 100),
    ]);
    expect(subtractIntervals([iv(0, 100)], [iv(-10, 10)])).toEqual([iv(10, 100)]);
    expect(subtractIntervals([iv(0, 100)], [iv(0, 100)])).toEqual([]);
  });

  it("detects overlap", () => {
    expect(intervalsOverlap(iv(0, 10), iv(9, 20))).toBe(true);
    expect(intervalsOverlap(iv(0, 10), iv(10, 20))).toBe(false); // half-open
  });

  it("generates aligned start times that fit the block", () => {
    // window [0,60), block 20, step 15 -> 0,15,30 (45+20=65 exceeds 60)
    expect(generateStartTimes([iv(0, 60)], 20, 15, 0, Number.MAX_SAFE_INTEGER)).toEqual([
      0, 15, 30,
    ]);
    // exact fit at the tail is allowed (half-open end)
    expect(generateStartTimes([iv(0, 60)], 30, 30, 0, Number.MAX_SAFE_INTEGER)).toEqual([0, 30]);
  });

  it("respects earliest / latest bounds", () => {
    const starts = generateStartTimes([iv(0, 120)], 30, 30, 45, 90);
    expect(starts).toEqual([60, 90]);
  });
});
