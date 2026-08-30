import { TZDate } from "@date-fns/tz";

/**
 * Timezone + interval math for scheduling.
 *
 * The barbershop's working hours are stored as minutes-of-day in the tenant's
 * timezone (`BusinessHour.startMin` etc). Appointments are stored as absolute
 * `timestamptz`. This module bridges the two: it turns "09:00 on 2026-03-15 in
 * America/Sao_Paulo" into the correct UTC instant (DST-aware via `TZDate`), and
 * provides pure interval arithmetic used to compute free slots.
 *
 * All `Interval`s here are half-open `[start, end)` in epoch milliseconds.
 */

export interface Interval {
  start: number;
  end: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateParts(dateISO: string): [number, number, number] {
  if (!ISO_DATE.test(dateISO)) throw new Error(`Invalid date: ${dateISO}`);
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

/** UTC instant for a wall-clock time (minutes from midnight) on a date in `tz`. */
export function wallClockToUtc(dateISO: string, minutes: number, tz: string): Date {
  const [y, m, d] = parseDateParts(dateISO);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  // TZDate interprets the Y/M/D h:m as local time in `tz`, DST included.
  return new Date(new TZDate(y, m - 1, d, hour, minute, 0, 0, tz).getTime());
}

/** Weekday (0=Sun..6=Sat) of a calendar date as observed in `tz`. */
export function weekdayInTz(dateISO: string, tz: string): number {
  const [y, m, d] = parseDateParts(dateISO);
  return new TZDate(y, m - 1, d, 12, 0, 0, 0, tz).getDay();
}

/** `YYYY-MM-DD` for the calendar date containing `instant` in `tz`. */
export function dateISOInTz(instant: Date, tz: string): string {
  const z = new TZDate(instant.getTime(), tz);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const d = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Sort + merge touching/overlapping intervals. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Remove every `cut` region from `base`, returning the remaining free pieces. */
export function subtractIntervals(base: Interval[], cuts: Interval[]): Interval[] {
  const merged = mergeIntervals(cuts);
  let pieces = base.filter((i) => i.end > i.start).map((i) => ({ ...i }));
  for (const cut of merged) {
    const next: Interval[] = [];
    for (const piece of pieces) {
      if (cut.end <= piece.start || cut.start >= piece.end) {
        next.push(piece); // no overlap
        continue;
      }
      if (cut.start > piece.start) next.push({ start: piece.start, end: cut.start });
      if (cut.end < piece.end) next.push({ start: cut.end, end: piece.end });
    }
    pieces = next;
  }
  return pieces.filter((i) => i.end > i.start);
}

/**
 * Candidate start times within `free` where a block of `durationMs` fits
 * entirely. Times are aligned to a **global** `stepMs` grid (anchored at the
 * epoch, so e.g. a 15-minute granularity always lands on :00/:15/:30/:45), never
 * to each free piece's start — a buffer after one appointment must not push
 * every later slot off the grid. Excludes anything before `earliest` / after
 * `latest`.
 */
export function generateStartTimes(
  free: Interval[],
  durationMs: number,
  stepMs: number,
  earliest: number,
  latest: number,
): number[] {
  const out: number[] = [];
  for (const piece of mergeIntervals(free)) {
    const lo = Math.max(piece.start, earliest);
    let t = Math.ceil(lo / stepMs) * stepMs;
    for (; t + durationMs <= piece.end; t += stepMs) {
      if (t < piece.start || t < earliest || t > latest) continue;
      out.push(t);
    }
  }
  return out;
}
