import {
  type Interval,
  wallClockToUtc,
  subtractIntervals,
  mergeIntervals,
  generateStartTimes,
} from "./time";

/**
 * Pure slot computation. `getAvailableSlots` (DB layer) loads the inputs and
 * delegates here so the availability rules are unit-testable without a database
 * and are the single source of truth for the dashboard, the public page and the
 * chatbot alike.
 */

export interface WorkRow {
  weekday: number;
  startMin: number;
  endMin: number;
  breakStartMin: number | null;
  breakEndMin: number | null;
}

export interface BlockRow {
  startsAt: Date;
  endsAt: Date;
}

export interface BusyAppointment {
  startsAt: Date;
  endsAt: Date;
  bufferMin: number;
}

export interface ComputeSlotsInput {
  dateISO: string; // calendar day, interpreted in `tz`
  tz: string;
  /** Effective weekly work rows for this employee on `dateISO`'s weekday. */
  workRows: WorkRow[];
  /** Closed for a holiday? -> no slots. */
  holidayClosed: boolean;
  /** One-off blocks (time off, vacation, manual blocks, tenant-wide blocks). */
  blocks: BlockRow[];
  /** Existing appointments that still hold their slot. */
  busy: BusyAppointment[];
  serviceDurationMin: number;
  serviceBufferMin: number;
  slotGranularityMin: number;
  /** Earliest bookable instant (e.g. now + minLeadTime). */
  earliest: Date;
  /** Latest bookable instant (e.g. now + maxAdvanceDays). */
  latest: Date;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

export function computeSlots(input: ComputeSlotsInput): Slot[] {
  if (input.holidayClosed || input.workRows.length === 0) return [];

  // 1. Working windows for the day (minus each row's break), as UTC intervals.
  const working: Interval[] = [];
  for (const row of input.workRows) {
    if (row.endMin <= row.startMin) continue;
    const dayStart = wallClockToUtc(input.dateISO, row.startMin, input.tz).getTime();
    const dayEnd = wallClockToUtc(input.dateISO, row.endMin, input.tz).getTime();
    let pieces: Interval[] = [{ start: dayStart, end: dayEnd }];
    if (
      row.breakStartMin != null &&
      row.breakEndMin != null &&
      row.breakEndMin > row.breakStartMin
    ) {
      const bStart = wallClockToUtc(input.dateISO, row.breakStartMin, input.tz).getTime();
      const bEnd = wallClockToUtc(input.dateISO, row.breakEndMin, input.tz).getTime();
      pieces = subtractIntervals(pieces, [{ start: bStart, end: bEnd }]);
    }
    working.push(...pieces);
  }

  // 2. Subtract one-off blocks and busy appointments (expanded by their buffer).
  const cuts: Interval[] = [
    ...input.blocks.map((b) => ({ start: b.startsAt.getTime(), end: b.endsAt.getTime() })),
    ...input.busy.map((a) => ({
      start: a.startsAt.getTime(),
      end: a.endsAt.getTime() + a.bufferMin * 60_000,
    })),
  ];
  const free = subtractIntervals(mergeIntervals(working), cuts);

  // 3. Walk the free windows; a start is valid if service + buffer fits.
  const blockMs = (input.serviceDurationMin + input.serviceBufferMin) * 60_000;
  const stepMs = input.slotGranularityMin * 60_000;
  const starts = generateStartTimes(
    free,
    blockMs,
    stepMs,
    input.earliest.getTime(),
    input.latest.getTime(),
  );

  return starts.map((t) => ({
    startsAt: new Date(t),
    endsAt: new Date(t + input.serviceDurationMin * 60_000),
  }));
}
