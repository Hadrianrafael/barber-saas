"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/features/auth/components/form-bits";
import {
  createAppointmentAction,
  rescheduleAppointmentAction,
  getSlotsAction,
  searchCustomersAction,
  type AgendaState,
} from "../actions";
import type { Appt } from "./agenda-view";

type ServiceOpt = { id: string; name: string; durationMin: number; employeeIds: string[] };
const initial: AgendaState = { ok: false };

interface SlotResult {
  timezone: string;
  service: { id: string; name: string; durationMin: number };
  byEmployee: {
    employeeId: string;
    employeeName: string;
    slots: { startsAt: string; endsAt: string }[];
  }[];
}

function errText(t: ReturnType<typeof useTranslations>, code?: string) {
  return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic");
}

function useSlots(timezone: string) {
  const locale = useLocale();
  const [slots, setSlots] = useState<{ startsAt: string; label: string; employeeId: string }[]>([]);
  const [loading, startLoad] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });

  function load(serviceId: string, dateISO: string, employeeId?: string) {
    setError(null);
    startLoad(async () => {
      const res = await getSlotsAction({ serviceId, dateISO, employeeId });
      if (!res.ok) {
        setSlots([]);
        setError(res.code ?? "generic");
        return;
      }
      const r = res.data!.result as SlotResult;
      const flat = r.byEmployee.flatMap((e) =>
        e.slots.map((s) => ({
          startsAt: s.startsAt,
          employeeId: e.employeeId,
          label: `${fmt.format(new Date(s.startsAt))} · ${e.employeeName}`,
        })),
      );
      flat.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      setSlots(flat);
    });
  }
  return { slots, loading, error, load, setSlots };
}

export function AppointmentDialog({
  timezone,
  employees,
  services,
  defaultDateISO,
  onClose,
}: {
  timezone: string;
  employees: { id: string; name: string }[];
  services: ServiceOpt[];
  defaultDateISO: string;
  onClose: () => void;
}) {
  const t = useTranslations("agenda");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [state, action] = useActionState(createAppointmentAction, initial);
  const { slots, loading, error, load } = useSlots(timezone);

  const [serviceId, setServiceId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [dateISO, setDateISO] = useState(defaultDateISO);
  const [slot, setSlot] = useState("");
  const [mode, setMode] = useState<"existing" | "walkin">("walkin");

  // customer search
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; phone: string | null }[]>([]);
  const [customerId, setCustomerId] = useState("");
  useEffect(() => {
    if (mode !== "existing" || term.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      const res = await searchCustomersAction(term);
      setResults((res.data?.rows as typeof results) ?? []);
    }, 300);
    return () => clearTimeout(id);
  }, [term, mode]);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const chosenEmployeeId = slots.find((s) => s.startsAt === slot)?.employeeId ?? employeeId;

  const eligibleEmployees = serviceId
    ? employees.filter((e) => services.find((s) => s.id === serviceId)?.employeeIds.includes(e.id))
    : employees;

  return (
    <Modal open onClose={onClose} title={t("new")} className="max-w-lg">
      <form action={action} className="space-y-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="startsAt" value={slot} />
        <input type="hidden" name="employeeId" value={chosenEmployeeId} />
        <input type="hidden" name="serviceId" value={serviceId} />
        {mode === "existing" && <input type="hidden" name="customerId" value={customerId} />}

        {state.code && !state.ok && (
          <Alert variant="destructive" className="text-sm">
            {errText(t, state.code)}
          </Alert>
        )}

        <div>
          <Label>{t("pickService")}</Label>
          <Select
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setSlot("");
            }}
            required
          >
            <option value="">—</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {t("minutes", { n: String(s.durationMin) })}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("pickBarber")}</Label>
            <Select
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                setSlot("");
              }}
            >
              <option value="">{t("anyBarber")}</option>
              {eligibleEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{t("pickDate")}</Label>
            <Input
              type="date"
              value={dateISO}
              onChange={(e) => {
                setDateISO(e.target.value);
                setSlot("");
              }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label>{t("pickSlot")}</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!serviceId || loading}
              onClick={() => load(serviceId, dateISO, employeeId || undefined)}
            >
              {loading ? t("loading") : "↻"}
            </Button>
          </div>
          <Select value={slot} onChange={(e) => setSlot(e.target.value)} required>
            <option value="">—</option>
            {slots.map((s) => (
              <option key={`${s.startsAt}-${s.employeeId}`} value={s.startsAt}>
                {s.label}
              </option>
            ))}
          </Select>
          {error && <p className="mt-1 text-xs text-destructive">{errText(t, error)}</p>}
          {!error && !loading && slots.length === 0 && serviceId && (
            <p className="mt-1 text-xs text-muted-foreground">{t("noSlots")}</p>
          )}
        </div>

        <div>
          <Label>{t("customer")}</Label>
          <div className="mb-2 flex gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === "walkin"} onChange={() => setMode("walkin")} />
              {t("walkIn")}
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={mode === "existing"}
                onChange={() => setMode("existing")}
              />
              {t("existingCustomer")}
            </label>
          </div>
          {mode === "walkin" ? (
            <div className="grid grid-cols-2 gap-2">
              <Input name="customerName" placeholder={t("customerName")} required minLength={2} />
              <Input name="customerPhone" placeholder={t("customerPhone")} inputMode="tel" />
              <Input
                name="customerEmail"
                placeholder={t("customerEmail")}
                type="email"
                className="col-span-2"
              />
            </div>
          ) : (
            <div>
              <Input
                placeholder={t("searchCustomer")}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              <ul className="mt-1 max-h-32 divide-y overflow-y-auto rounded-md border text-sm">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerId(r.id);
                        setTerm(r.name);
                        setResults([]);
                      }}
                      className={`w-full p-2 text-left hover:bg-accent ${
                        customerId === r.id ? "bg-accent" : ""
                      }`}
                    >
                      {r.name} {r.phone ? `· ${r.phone}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <Label>{t("notes")}</Label>
          <Textarea name="notes" maxLength={500} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <SubmitButton>{t("create")}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

export function RescheduleDialog({
  appt,
  timezone,
  services,
  onClose,
}: {
  appt: Appt;
  timezone: string;
  services: ServiceOpt[];
  onClose: () => void;
}) {
  const t = useTranslations("agenda");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [state, action] = useActionState(rescheduleAppointmentAction, initial);
  const { slots, loading, error, load } = useSlots(timezone);
  const service = services.find((s) => s.name === appt.serviceName);
  const [dateISO, setDateISO] = useState(appt.startsAt.slice(0, 10));
  const [slot, setSlot] = useState("");

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const chosenEmployeeId = slots.find((s) => s.startsAt === slot)?.employeeId ?? appt.employee.id;

  return (
    <Modal open onClose={onClose} title={`${t("reschedule")} — ${appt.customer.name}`}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={appt.id} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="startsAt" value={slot} />
        <input type="hidden" name="employeeId" value={chosenEmployeeId} />
        {state.code && !state.ok && (
          <Alert variant="destructive" className="text-sm">
            {errText(t, state.code)}
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("pickDate")}</Label>
            <Input
              type="date"
              value={dateISO}
              onChange={(e) => {
                setDateISO(e.target.value);
                setSlot("");
              }}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!service || loading}
              onClick={() => service && load(service.id, dateISO, appt.employee.id)}
            >
              {loading ? t("loading") : t("pickSlot")}
            </Button>
          </div>
        </div>
        <div>
          <Label>{t("pickSlot")}</Label>
          <Select value={slot} onChange={(e) => setSlot(e.target.value)} required>
            <option value="">—</option>
            {slots.map((s) => (
              <option key={`${s.startsAt}-${s.employeeId}`} value={s.startsAt}>
                {s.label}
              </option>
            ))}
          </Select>
          {error && <p className="mt-1 text-xs text-destructive">{errText(t, error)}</p>}
          {!error && !loading && slots.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{t("noSlots")}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <SubmitButton>{t("reschedule")}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
