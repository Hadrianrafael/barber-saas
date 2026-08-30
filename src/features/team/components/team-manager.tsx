"use client";

import { useActionState, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/features/auth/components/form-bits";
import {
  saveEmployeeAction,
  setEmployeeStatusAction,
  saveWorkHoursAction,
  addTimeOffAction,
  removeTimeOffAction,
  type TeamState,
} from "../actions";

type Emp = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  specialties: string[];
  commissionType: "PERCENT" | "FIXED";
  commissionBps: number;
  commissionFixedCents: number;
  status: "ACTIVE" | "INACTIVE" | "ON_VACATION";
  serviceIds: string[];
};
type WorkRow = {
  weekday: number;
  startMin: number;
  endMin: number;
  breakStartMin: number | null;
  breakEndMin: number | null;
};
type TimeOff = {
  id: string;
  employeeId?: string | null;
  kind: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
};

const initial: TeamState = { ok: false };
const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const toHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const errText = (t: ReturnType<typeof useTranslations>, code?: string) =>
  code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic");

export function TeamManager({
  employees,
  serviceOptions,
  workHoursByEmployee,
  timeOff,
  readOnly = false,
}: {
  employees: Emp[];
  serviceOptions: { id: string; name: string }[];
  workHoursByEmployee: Record<string, WorkRow[]>;
  timeOff: TimeOff[];
  readOnly?: boolean;
}) {
  const t = useTranslations("team");
  const [editing, setEditing] = useState<Emp | null | "new">(null);
  const [hoursFor, setHoursFor] = useState<Emp | null>(null);

  return (
    <div className="space-y-6">
      {!readOnly && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>{t("new")}</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">{t("name")}</th>
              <th className="p-3">{t("jobTitle")}</th>
              <th className="p-3">{t("commission")}</th>
              <th className="p-3">{t("status")}</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {employees.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            )}
            {employees.map((e) => (
              <tr key={e.id}>
                <td className="p-3 font-medium">
                  {e.name}
                  {e.specialties.length > 0 && (
                    <div className="text-xs font-normal text-muted-foreground">
                      {e.specialties.join(", ")}
                    </div>
                  )}
                </td>
                <td className="p-3 text-muted-foreground">{e.title ?? "—"}</td>
                <td className="p-3 text-muted-foreground">
                  {e.commissionType === "PERCENT"
                    ? `${(e.commissionBps / 100).toFixed(1)}%`
                    : (e.commissionFixedCents / 100).toFixed(2)}
                </td>
                <td className="p-3">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {t(`status${e.status}`)}
                  </span>
                </td>
                <td className="p-3 text-right">
                  {!readOnly && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(e)}>
                        {t("edit")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setHoursFor(e)}>
                        {t("workHours")}
                      </Button>
                      <StatusToggle emp={e} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && <TimeOffPanel employees={employees} rows={timeOff} />}

      {editing && (
        <EmployeeFormModal
          emp={editing === "new" ? null : editing}
          serviceOptions={serviceOptions}
          onClose={() => setEditing(null)}
        />
      )}
      {hoursFor && (
        <WorkHoursModal
          emp={hoursFor}
          rows={workHoursByEmployee[hoursFor.id] ?? []}
          onClose={() => setHoursFor(null)}
        />
      )}
    </div>
  );
}

function StatusToggle({ emp }: { emp: Emp }) {
  const t = useTranslations("team");
  const locale = useLocale();
  const next = emp.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  return (
    <form action={setEmployeeStatusAction}>
      <input type="hidden" name="id" value={emp.id} />
      <input type="hidden" name="status" value={next} />
      <input type="hidden" name="locale" value={locale} />
      <Button variant="ghost" size="sm" type="submit">
        {next === "ACTIVE" ? t("activate") : t("deactivate")}
      </Button>
    </form>
  );
}

function EmployeeFormModal({
  emp,
  serviceOptions,
  onClose,
}: {
  emp: Emp | null;
  serviceOptions: { id: string; name: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("team");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [state, action] = useActionState(saveEmployeeAction, initial);
  const [ctype, setCtype] = useState<"PERCENT" | "FIXED">(emp?.commissionType ?? "PERCENT");
  const [commValue, setCommValue] = useState(
    emp
      ? emp.commissionType === "PERCENT"
        ? String(emp.commissionBps / 100)
        : String(emp.commissionFixedCents / 100)
      : "0",
  );

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const bps = ctype === "PERCENT" ? Math.round(Number(commValue || 0) * 100) : 0;
  const fixedCents = ctype === "FIXED" ? Math.round(Number(commValue || 0) * 100) : 0;

  return (
    <Modal open onClose={onClose} title={emp ? t("edit") : t("new")}>
      <form action={action} className="space-y-3">
        {emp && <input type="hidden" name="id" value={emp.id} />}
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="commissionBps" value={bps} />
        <input type="hidden" name="commissionFixedCents" value={fixedCents} />
        {state.code && !state.ok && (
          <Alert variant="destructive" className="text-sm">
            {errText(t, state.code)}
          </Alert>
        )}
        <Row label={t("name")}>
          <Input name="name" defaultValue={emp?.name} required minLength={2} />
        </Row>
        <div className="grid grid-cols-2 gap-3">
          <Row label={t("jobTitle")}>
            <Input name="title" defaultValue={emp?.title ?? ""} />
          </Row>
          <Row label={t("phone")}>
            <Input name="phone" defaultValue={emp?.phone ?? ""} inputMode="tel" />
          </Row>
          <Row label={t("email")}>
            <Input name="email" type="email" defaultValue={emp?.email ?? ""} />
          </Row>
          <Row label={t("status")}>
            <Select name="status" defaultValue={emp?.status ?? "ACTIVE"}>
              <option value="ACTIVE">{t("statusACTIVE")}</option>
              <option value="INACTIVE">{t("statusINACTIVE")}</option>
              <option value="ON_VACATION">{t("statusON_VACATION")}</option>
            </Select>
          </Row>
        </div>
        <Row label={`${t("specialties")} (${t("specialtiesHint")})`}>
          <Input name="specialties" defaultValue={emp?.specialties.join(", ") ?? ""} />
        </Row>
        <div className="grid grid-cols-2 gap-3">
          <Row label={t("commissionType")}>
            <Select value={ctype} onChange={(e) => setCtype(e.target.value as "PERCENT" | "FIXED")}>
              <option value="PERCENT">{t("commissionPercent")}</option>
              <option value="FIXED">{t("commissionFixed")}</option>
            </Select>
          </Row>
          <Row
            label={ctype === "PERCENT" ? t("commissionPercentValue") : t("commissionFixedValue")}
          >
            <Input
              type="number"
              min={0}
              step="0.01"
              value={commValue}
              onChange={(e) => setCommValue(e.target.value)}
            />
          </Row>
        </div>
        <Row label={t("services")}>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
            {serviceOptions.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
            {serviceOptions.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="serviceIds"
                  value={s.id}
                  defaultChecked={emp?.serviceIds.includes(s.id)}
                />
                {s.name}
              </label>
            ))}
          </div>
        </Row>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <SubmitButton>{t("save")}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function WorkHoursModal({
  emp,
  rows,
  onClose,
}: {
  emp: Emp;
  rows: WorkRow[];
  onClose: () => void;
}) {
  const t = useTranslations("team");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [state, action] = useActionState(saveWorkHoursAction, initial);
  const byDay = new Map(rows.map((r) => [r.weekday, r]));
  const [days, setDays] = useState(
    Array.from({ length: 7 }, (_, w) => {
      const r = byDay.get(w);
      return {
        weekday: w,
        open: !!r,
        start: r ? toHHMM(r.startMin) : "09:00",
        end: r ? toHHMM(r.endMin) : "19:00",
        bStart: r?.breakStartMin != null ? toHHMM(r.breakStartMin) : "",
        bEnd: r?.breakEndMin != null ? toHHMM(r.breakEndMin) : "",
      };
    }),
  );

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const json = JSON.stringify({
    rows: days.map((d) => ({
      weekday: d.weekday,
      open: d.open,
      startMin: toMin(d.start),
      endMin: toMin(d.end),
      breakStartMin: d.bStart ? toMin(d.bStart) : null,
      breakEndMin: d.bEnd ? toMin(d.bEnd) : null,
    })),
  });

  return (
    <Modal open onClose={onClose} title={`${t("workHours")} — ${emp.name}`} className="max-w-2xl">
      <form action={action} className="space-y-3">
        <input type="hidden" name="employeeId" value={emp.id} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="rows" value={json} />
        <p className="text-xs text-muted-foreground">{t("workHoursHint")}</p>
        {state.code && !state.ok && (
          <Alert variant="destructive" className="text-sm">
            {errText(t, state.code)}
          </Alert>
        )}
        <div className="space-y-2">
          {days.map((d, i) => (
            <div key={d.weekday} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex w-16 items-center gap-1">
                <input
                  type="checkbox"
                  checked={d.open}
                  onChange={(e) =>
                    setDays((p) =>
                      p.map((x, j) => (j === i ? { ...x, open: e.target.checked } : x)),
                    )
                  }
                />
                {t(`weekday.${WD[d.weekday]}`)}
              </label>
              <Input
                type="time"
                className="w-28"
                value={d.start}
                disabled={!d.open}
                onChange={(e) =>
                  setDays((p) => p.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))
                }
              />
              <span>—</span>
              <Input
                type="time"
                className="w-28"
                value={d.end}
                disabled={!d.open}
                onChange={(e) =>
                  setDays((p) => p.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))
                }
              />
              <span className="text-xs text-muted-foreground">{t("break")}</span>
              <Input
                type="time"
                className="w-24"
                value={d.bStart}
                disabled={!d.open}
                onChange={(e) =>
                  setDays((p) => p.map((x, j) => (j === i ? { ...x, bStart: e.target.value } : x)))
                }
              />
              <Input
                type="time"
                className="w-24"
                value={d.bEnd}
                disabled={!d.open}
                onChange={(e) =>
                  setDays((p) => p.map((x, j) => (j === i ? { ...x, bEnd: e.target.value } : x)))
                }
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <SubmitButton>{t("save")}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function TimeOffPanel({ employees, rows }: { employees: Emp[]; rows: TimeOff[] }) {
  const t = useTranslations("team");
  const locale = useLocale();
  const [state, action] = useActionState(addTimeOffAction, initial);
  const nameById = new Map(employees.map((e) => [e.id, e.name]));

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">{t("timeOff")}</h3>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="locale" value={locale} />
        <div>
          <Label>{t("name")}</Label>
          <Select name="employeeId" className="w-40">
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("timeOffKind")}</Label>
          <Select name="kind" className="w-32">
            <option value="TIME_OFF">{t("kindTIME_OFF")}</option>
            <option value="VACATION">{t("kindVACATION")}</option>
            <option value="OTHER">{t("kindOTHER")}</option>
          </Select>
        </div>
        <div>
          <Label>{t("from")}</Label>
          <Input type="datetime-local" name="startsAt" required />
        </div>
        <div>
          <Label>{t("to")}</Label>
          <Input type="datetime-local" name="endsAt" required />
        </div>
        <div className="flex-1">
          <Label>{t("reason")}</Label>
          <Input name="reason" maxLength={200} />
        </div>
        <SubmitButton>{t("addTimeOff")}</SubmitButton>
      </form>
      {state.code && !state.ok && (
        <Alert variant="destructive" className="text-sm">
          {errText(t, state.code)}
        </Alert>
      )}
      <ul className="divide-y rounded-md border text-sm">
        {rows.length === 0 && <li className="p-3 text-muted-foreground">{t("noTimeOff")}</li>}
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between p-3">
            <span>
              <strong>{r.employeeId ? nameById.get(r.employeeId) : "—"}</strong> ·{" "}
              {t.has(`kind${r.kind}`) ? t(`kind${r.kind}`) : r.kind} ·{" "}
              {new Date(r.startsAt).toLocaleString(locale)} →{" "}
              {new Date(r.endsAt).toLocaleString(locale)}
            </span>
            <form action={removeTimeOffAction}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="ghost" size="sm">
                ×
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
