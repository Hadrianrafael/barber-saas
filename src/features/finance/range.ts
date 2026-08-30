import { wallClockToUtc, dateISOInTz } from "@/features/scheduling/time";

export type FinancePreset = "today" | "week" | "month" | "quarter" | "year" | "custom";

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Resolve a preset (or explicit from/to dates) into a UTC [fromISO, toISO) window in the tenant timezone. */
export function resolveRange(
  tz: string,
  preset: FinancePreset,
  from?: string,
  to?: string,
): { fromISO: string; toISO: string; label: FinancePreset } {
  const todayISO = dateISOInTz(new Date(), tz);
  const tomorrowISO = addDaysISO(todayISO, 1);

  if (preset === "custom" && from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const end = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? addDaysISO(to, 1) : tomorrowISO;
    return {
      fromISO: wallClockToUtc(from, 0, tz).toISOString(),
      toISO: wallClockToUtc(end, 0, tz).toISOString(),
      label: "custom",
    };
  }

  let startISO = todayISO;
  if (preset === "week") startISO = addDaysISO(todayISO, -6);
  else if (preset === "month") startISO = `${todayISO.slice(0, 7)}-01`;
  else if (preset === "quarter") {
    const [y, m] = todayISO.split("-").map(Number) as [number, number, number];
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
    startISO = `${y}-${String(qStartMonth).padStart(2, "0")}-01`;
  } else if (preset === "year") startISO = `${todayISO.slice(0, 4)}-01-01`;

  return {
    fromISO: wallClockToUtc(startISO, 0, tz).toISOString(),
    toISO: wallClockToUtc(tomorrowISO, 0, tz).toISOString(),
    label: preset === "custom" ? "month" : preset,
  };
}
