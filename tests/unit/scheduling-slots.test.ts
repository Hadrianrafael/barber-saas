import { describe, it, expect } from "vitest";
import { computeSlots, type ComputeSlotsInput } from "@/features/scheduling/slots";
import { wallClockToUtc } from "@/features/scheduling/time";

const TZ = "America/Sao_Paulo";
const DATE = "2026-03-16"; // Monday

function base(overrides: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput {
  return {
    dateISO: DATE,
    tz: TZ,
    workRows: [
      { weekday: 1, startMin: 9 * 60, endMin: 12 * 60, breakStartMin: null, breakEndMin: null },
    ],
    holidayClosed: false,
    blocks: [],
    busy: [],
    serviceDurationMin: 30,
    serviceBufferMin: 0,
    slotGranularityMin: 30,
    earliest: new Date("2026-01-01T00:00:00Z"),
    latest: new Date("2027-01-01T00:00:00Z"),
    ...overrides,
  };
}

const at = (min: number) => wallClockToUtc(DATE, min, TZ).toISOString();

describe("computeSlots", () => {
  it("produces slots across the working window on the grid", () => {
    const slots = computeSlots(base());
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      at(9 * 60),
      at(9 * 60 + 30),
      at(10 * 60),
      at(10 * 60 + 30),
      at(11 * 60),
      at(11 * 60 + 30),
    ]);
  });

  it("returns nothing when closed for a holiday", () => {
    expect(computeSlots(base({ holidayClosed: true }))).toEqual([]);
  });

  it("returns nothing with no work rows", () => {
    expect(computeSlots(base({ workRows: [] }))).toEqual([]);
  });

  it("subtracts the daily break", () => {
    const slots = computeSlots(
      base({
        workRows: [
          {
            weekday: 1,
            startMin: 9 * 60,
            endMin: 12 * 60,
            breakStartMin: 10 * 60,
            breakEndMin: 10 * 60 + 30,
          },
        ],
      }),
    );
    const iso = slots.map((s) => s.startsAt.toISOString());
    expect(iso).not.toContain(at(10 * 60));
    expect(iso).toContain(at(9 * 60 + 30)); // 09:30 ends 10:00, still fits
    expect(iso).toContain(at(10 * 60 + 30));
  });

  it("subtracts one-off blocks (time off)", () => {
    const slots = computeSlots(
      base({
        blocks: [
          {
            startsAt: new Date(at(10 * 60)),
            endsAt: new Date(at(11 * 60)),
          },
        ],
      }),
    );
    const iso = slots.map((s) => s.startsAt.toISOString());
    expect(iso).not.toContain(at(10 * 60));
    expect(iso).not.toContain(at(10 * 60 + 30));
    expect(iso).toContain(at(11 * 60));
  });

  it("subtracts existing appointments plus their buffer", () => {
    const slots = computeSlots(
      base({
        busy: [
          {
            startsAt: new Date(at(10 * 60)),
            endsAt: new Date(at(10 * 60 + 30)),
            bufferMin: 15,
          },
        ],
      }),
    );
    const iso = slots.map((s) => s.startsAt.toISOString());
    expect(iso).not.toContain(at(10 * 60)); // taken
    expect(iso).not.toContain(at(10 * 60 + 30)); // inside the 15-min buffer
    expect(iso).toContain(at(11 * 60)); // buffer clears at 10:45, next grid point 11:00
  });

  it("accounts for the service's own buffer when checking fit", () => {
    // window 09:00–12:00, service 30 + buffer 30 = 60 block, step 30
    const slots = computeSlots(base({ serviceBufferMin: 30 }));
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      at(9 * 60),
      at(9 * 60 + 30),
      at(10 * 60),
      at(10 * 60 + 30),
      at(11 * 60), // 11:00 + 60 = 12:00 fits (half-open)
    ]);
  });

  it("honours earliest / latest", () => {
    const slots = computeSlots(
      base({
        earliest: new Date(at(10 * 60)),
        latest: new Date(at(11 * 60)),
      }),
    );
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      at(10 * 60),
      at(10 * 60 + 30),
      at(11 * 60),
    ]);
  });

  it("returns nothing when the day is fully booked", () => {
    const slots = computeSlots(
      base({
        busy: [{ startsAt: new Date(at(9 * 60)), endsAt: new Date(at(12 * 60)), bufferMin: 0 }],
      }),
    );
    expect(slots).toEqual([]);
  });

  it("computes the same wall-clock differently per timezone", () => {
    const spSlots = computeSlots(base());
    const nySlots = computeSlots(base({ tz: "America/New_York" }));
    expect(spSlots[0]!.startsAt.toISOString()).toBe("2026-03-16T12:00:00.000Z"); // 09:00 -03
    expect(nySlots[0]!.startsAt.toISOString()).toBe("2026-03-16T13:00:00.000Z"); // 09:00 -04
  });
});
