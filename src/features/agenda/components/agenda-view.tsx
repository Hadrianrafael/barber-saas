"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AppointmentDialog, RescheduleDialog } from "./appointment-dialog";
import {
  confirmAppointmentAction,
  startAppointmentAction,
  completeAppointmentAction,
  noShowAppointmentAction,
  cancelAppointmentAction,
} from "../actions";

type View = "day" | "week" | "month";
export type Appt = {
  id: string;
  status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | "NO_SHOW";
  source: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  serviceName: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  employee: { id: string; name: string };
  customer: { id: string; name: string; phone: string | null };
};
type ServiceOpt = { id: string; name: string; durationMin: number; employeeIds: string[] };

const STATUSES = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELED",
  "NO_SHOW",
] as const;

function addDaysISO(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function addMonthsISO(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}

export function AgendaView(props: {
  timezone: string;
  view: View;
  dateISO: string;
  employeeId: string;
  status: string;
  canManageAll: boolean;
  employees: { id: string; name: string }[];
  services: ServiceOpt[];
  appointments: Appt[];
}) {
  const t = useTranslations("agenda");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [rescheduleFor, setRescheduleFor] = useState<Appt | null>(null);

  const fmtTime = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: props.timezone,
      }),
    [locale, props.timezone],
  );
  const fmtDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "2-digit",
        month: "short",
        timeZone: props.timezone,
      }),
    [locale, props.timezone],
  );

  function setParam(next: Record<string, string>) {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push(`${pathname}?${p.toString()}`);
  }

  function shift(dir: -1 | 1) {
    if (props.view === "day") setParam({ date: addDaysISO(props.dateISO, dir) });
    else if (props.view === "week") setParam({ date: addDaysISO(props.dateISO, dir * 7) });
    else setParam({ date: addMonthsISO(props.dateISO, dir) });
  }

  const dayKey = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: props.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button onClick={() => setShowNew(true)}>{t("new")}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border">
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setParam({ view: v })}
              className={`px-3 py-1.5 text-sm ${
                props.view === v ? "bg-primary text-primary-foreground" : ""
              }`}
            >
              {t(v)}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => shift(-1)}>
          {t("prev")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setParam({ date: dayKey(new Date().toISOString()) })}
        >
          {t("today")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => shift(1)}>
          {t("next")}
        </Button>
        <span className="text-sm text-muted-foreground">{props.dateISO}</span>

        <Select
          className="w-44"
          value={props.employeeId}
          onChange={(e) => setParam({ employee: e.target.value })}
        >
          <option value="">{t("allBarbers")}</option>
          {props.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-44"
          value={props.status}
          onChange={(e) => setParam({ status: e.target.value })}
        >
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status${s}`)}
            </option>
          ))}
        </Select>
      </div>

      {props.view === "day" && (
        <DayList appts={props.appointments} fmtTime={fmtTime} onReschedule={setRescheduleFor} />
      )}

      {props.view === "week" && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 7 }, (_, i) => {
            const iso = addDaysISO(mondayOf(props.dateISO), i);
            const dayAppts = props.appointments.filter((a) => dayKey(a.startsAt) === iso);
            return (
              <div key={iso} className="rounded-lg border p-2">
                <button
                  className="mb-2 text-xs font-medium text-muted-foreground hover:underline"
                  onClick={() => setParam({ view: "day", date: iso })}
                >
                  {fmtDate.format(new Date(`${iso}T12:00:00Z`))}
                </button>
                <DayList
                  compact
                  appts={dayAppts}
                  fmtTime={fmtTime}
                  onReschedule={setRescheduleFor}
                />
              </div>
            );
          })}
        </div>
      )}

      {props.view === "month" && (
        <MonthGrid
          dateISO={props.dateISO}
          appts={props.appointments}
          dayKey={dayKey}
          onPickDay={(iso) => setParam({ view: "day", date: iso })}
        />
      )}

      {showNew && (
        <AppointmentDialog
          timezone={props.timezone}
          employees={props.employees}
          services={props.services}
          defaultDateISO={props.dateISO}
          onClose={() => setShowNew(false)}
        />
      )}
      {rescheduleFor && (
        <RescheduleDialog
          appt={rescheduleFor}
          timezone={props.timezone}
          services={props.services}
          onClose={() => setRescheduleFor(null)}
        />
      )}
    </div>
  );

  function mondayOf(iso: string) {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    return addDaysISO(iso, -dow);
  }
}

function statusClass(s: Appt["status"]) {
  return {
    PENDING: "bg-amber-100 text-amber-800",
    CONFIRMED: "bg-blue-100 text-blue-800",
    IN_PROGRESS: "bg-violet-100 text-violet-800",
    COMPLETED: "bg-emerald-100 text-emerald-800",
    CANCELED: "bg-zinc-100 text-zinc-500 line-through",
    NO_SHOW: "bg-red-100 text-red-800",
  }[s];
}

function DayList({
  appts,
  fmtTime,
  compact,
  onReschedule,
}: {
  appts: Appt[];
  fmtTime: Intl.DateTimeFormat;
  compact?: boolean;
  onReschedule: (a: Appt) => void;
}) {
  const t = useTranslations("agenda");
  const sorted = [...appts].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (sorted.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <ul className={compact ? "space-y-1" : "divide-y rounded-lg border"}>
      {sorted.map((a) => (
        <li key={a.id} className={compact ? "rounded border p-2 text-xs" : "p-3"}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium">
                {fmtTime.format(new Date(a.startsAt))}–{fmtTime.format(new Date(a.endsAt))}
                {" · "}
                {a.customer.name}
              </div>
              <div className={compact ? "text-muted-foreground" : "text-sm text-muted-foreground"}>
                {a.serviceName} · {a.employee.name} · {t("minutes", { n: String(a.durationMin) })}
              </div>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusClass(a.status)}`}>
              {t(`status${a.status}`)}
            </span>
          </div>
          {!compact && <Actions appt={a} onReschedule={onReschedule} />}
        </li>
      ))}
    </ul>
  );
}

function Actions({ appt, onReschedule }: { appt: Appt; onReschedule: (a: Appt) => void }) {
  const t = useTranslations("agenda");
  const locale = useLocale();
  const Hidden = () => (
    <>
      <input type="hidden" name="id" value={appt.id} />
      <input type="hidden" name="locale" value={locale} />
    </>
  );
  const SubmitBtn = ({ label }: { label: string }) => (
    <Button type="submit" size="sm" variant="outline">
      {label}
    </Button>
  );
  const active =
    appt.status !== "COMPLETED" && appt.status !== "CANCELED" && appt.status !== "NO_SHOW";

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {appt.status === "PENDING" && (
        <form action={confirmAppointmentAction}>
          <Hidden />
          <SubmitBtn label={t("confirm")} />
        </form>
      )}
      {(appt.status === "PENDING" || appt.status === "CONFIRMED") && (
        <form action={startAppointmentAction}>
          <Hidden />
          <SubmitBtn label={t("start")} />
        </form>
      )}
      {(appt.status === "CONFIRMED" || appt.status === "IN_PROGRESS") && (
        <form action={completeAppointmentAction}>
          <Hidden />
          <SubmitBtn label={t("complete")} />
        </form>
      )}
      {(appt.status === "PENDING" || appt.status === "CONFIRMED") && (
        <>
          <form action={noShowAppointmentAction}>
            <Hidden />
            <SubmitBtn label={t("noShow")} />
          </form>
          <Button size="sm" variant="outline" onClick={() => onReschedule(appt)}>
            {t("reschedule")}
          </Button>
        </>
      )}
      {active && (
        <form action={cancelAppointmentAction}>
          <Hidden />
          <SubmitBtn label={t("cancel")} />
        </form>
      )}
    </div>
  );
}

function MonthGrid({
  dateISO,
  appts,
  dayKey,
  onPickDay,
}: {
  dateISO: string;
  appts: Appt[];
  dayKey: (iso: string) => string;
  onPickDay: (iso: string) => void;
}) {
  const locale = useLocale();
  const [y, m] = dateISO.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startDow = (first.getUTCDay() + 6) % 7;
  const gridStart = new Date(Date.UTC(y, m - 1, 1 - startDow));
  const counts = new Map<string, number>();
  for (const a of appts) counts.set(dayKey(a.startsAt), (counts.get(dayKey(a.startsAt)) ?? 0) + 1);

  return (
    <div className="grid grid-cols-7 gap-1 text-sm">
      {Array.from({ length: 42 }, (_, i) => {
        const d = new Date(gridStart.getTime() + i * 86400000);
        const iso = d.toISOString().slice(0, 10);
        const inMonth = d.getUTCMonth() === m - 1;
        const n = counts.get(iso) ?? 0;
        return (
          <button
            key={iso}
            onClick={() => onPickDay(iso)}
            className={`min-h-16 rounded border p-1 text-left ${
              inMonth ? "" : "opacity-40"
            } hover:bg-accent`}
          >
            <div className="text-xs text-muted-foreground">{d.getUTCDate()}</div>
            {n > 0 && (
              <div className="mt-1 inline-block rounded bg-primary px-1.5 text-xs text-primary-foreground">
                {n}
              </div>
            )}
          </button>
        );
      })}
      <span className="sr-only">{locale}</span>
    </div>
  );
}
