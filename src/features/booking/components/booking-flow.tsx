"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { formatMoney } from "@/lib/utils";
import { publicSlotsAction, submitBookingAction, type BookingState } from "../actions";

type Svc = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  currency: string;
  employeeIds: string[];
};
type Emp = { id: string; name: string; photoUrl: string | null; specialties: string[] };
type Slot = { startsAt: string; endsAt: string; employeeId: string };

export interface BookingFlowProps {
  slug: string;
  locale: string;
  timezone: string;
  services: Svc[];
  employees: Emp[];
  requireEmployeeSelection: boolean;
  paymentEnabled: boolean;
  maxAdvanceDays: number;
  minLeadTimeMin: number;
}

const initial: BookingState = { ok: false };

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function BookingFlow(props: BookingFlowProps) {
  const t = useTranslations("booking");
  const {
    slug,
    locale,
    timezone,
    services,
    employees,
    requireEmployeeSelection,
    paymentEnabled,
    maxAdvanceDays,
    minLeadTimeMin,
  } = props;

  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState("");
  const [employeeId, setEmployeeId] = useState(""); // "" = any available
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState<Slot | null>(null);

  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsPending, startSlots] = useTransition();
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const service = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );
  const eligibleEmployees = useMemo(
    () => (service ? employees.filter((e) => service.employeeIds.includes(e.id)) : []),
    [employees, service],
  );

  const minDate = useMemo(
    () => isoDate(new Date(Date.now() + minLeadTimeMin * 60_000)),
    [minLeadTimeMin],
  );
  const maxDate = useMemo(
    () => isoDate(new Date(Date.now() + maxAdvanceDays * 86_400_000)),
    [maxAdvanceDays],
  );

  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone }),
    [locale, timezone],
  );
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: timezone,
      }),
    [locale, timezone],
  );

  // Fetch slots whenever service + date (+ barber) are set.
  useEffect(() => {
    if (!serviceId || !date) {
      setSlots([]);
      return;
    }
    setSlot(null);
    setSlotsError(null);
    startSlots(async () => {
      const res = await publicSlotsAction(slug, {
        serviceId,
        dateISO: date,
        employeeId: employeeId || undefined,
      });
      if (res.ok && res.data?.slots) setSlots(res.data.slots);
      else {
        setSlots([]);
        setSlotsError(res.code ?? "invalid");
      }
    });
  }, [slug, serviceId, date, employeeId]);

  // --- final submit ---
  const [state, formAction, submitting] = useActionState(
    submitBookingAction.bind(null, slug),
    initial,
  );
  const redirected = useRef(false);
  useEffect(() => {
    if (state.ok && state.data && !redirected.current) {
      redirected.current = true;
      if (state.data.checkoutUrl) window.location.href = state.data.checkoutUrl;
      else if (state.data.token)
        window.location.href = `/${locale}/barber/${slug}/booking/${state.data.token}`;
    }
  }, [state, locale, slug]);

  const stepLabel = (n: number) => `${n}. ${t(`step${n}`)}`;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {[1, 2, 3, 4].map((n) => (
          <li key={n} className={n === step ? "font-semibold text-foreground" : ""}>
            {stepLabel(n)}
          </li>
        ))}
      </ol>

      {/* STEP 1 — service */}
      {step === 1 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("chooseService")}</h2>
          <ul className="divide-y rounded-lg border">
            {services.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    setServiceId(s.id);
                    setEmployeeId("");
                    setSlot(null);
                    setStep(2);
                  }}
                  className={`flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-accent ${
                    serviceId === s.id ? "bg-accent" : ""
                  }`}
                >
                  <span>
                    <span className="block text-sm font-medium">{s.name}</span>
                    {s.description && (
                      <span className="block text-xs text-muted-foreground">{s.description}</span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {t("minutes", { n: String(s.durationMin) })}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold">
                    {formatMoney(s.priceCents, s.currency, locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* STEP 2 — barber */}
      {step === 2 && service && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("chooseBarber")}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {!requireEmployeeSelection && (
              <button
                type="button"
                onClick={() => {
                  setEmployeeId("");
                  setStep(3);
                }}
                className={`rounded-lg border p-3 text-center text-sm hover:bg-accent ${
                  employeeId === "" ? "border-primary bg-accent" : ""
                }`}
              >
                {t("anyBarber")}
              </button>
            )}
            {eligibleEmployees.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setEmployeeId(e.id);
                  setStep(3);
                }}
                className={`rounded-lg border p-3 text-center hover:bg-accent ${
                  employeeId === e.id ? "border-primary bg-accent" : ""
                }`}
              >
                {e.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={e.photoUrl}
                    alt=""
                    className="mx-auto h-12 w-12 rounded-full object-cover"
                  />
                ) : (
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-base font-semibold">
                    {e.name.charAt(0)}
                  </span>
                )}
                <span className="mt-1 block text-sm font-medium">{e.name}</span>
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
            {t("back")}
          </Button>
        </section>
      )}

      {/* STEP 3 — date + slot */}
      {step === 3 && service && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("chooseTime")}</h2>
          <div>
            <Label htmlFor="bk-date">{t("date")}</Label>
            <Input
              id="bk-date"
              type="date"
              value={date}
              min={minDate}
              max={maxDate}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {slotsPending && <p className="text-sm text-muted-foreground">{t("loadingSlots")}</p>}
          {!slotsPending && date && slots.length === 0 && (
            <Alert className="text-sm">{slotsError ? t(`err.${slotsError}`) : t("noSlots")}</Alert>
          )}
          {slots.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => (
                <button
                  key={s.startsAt}
                  type="button"
                  onClick={() => {
                    setSlot(s);
                    setStep(4);
                  }}
                  className={`rounded-md border px-2 py-2 text-sm hover:bg-accent ${
                    slot?.startsAt === s.startsAt ? "border-primary bg-accent" : ""
                  }`}
                >
                  {timeFmt.format(new Date(s.startsAt))}
                </button>
              ))}
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
            {t("back")}
          </Button>
        </section>
      )}

      {/* STEP 4 — details + confirm */}
      {step === 4 && service && slot && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("yourDetails")}</h2>

          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{service.name}</p>
            <p className="text-muted-foreground">
              {dateFmt.format(new Date(slot.startsAt))} · {timeFmt.format(new Date(slot.startsAt))}
            </p>
            <p className="text-muted-foreground">
              {employeeId
                ? eligibleEmployees.find((e) => e.id === employeeId)?.name
                : t("anyBarber")}{" "}
              · {formatMoney(service.priceCents, service.currency, locale)}
            </p>
          </div>

          <form action={formAction} className="space-y-3">
            <input type="hidden" name="serviceId" value={service.id} />
            <input type="hidden" name="employeeId" value={employeeId} />
            <input type="hidden" name="startsAt" value={slot.startsAt} />
            <input type="hidden" name="locale" value={locale} />

            <div>
              <Label htmlFor="bk-name">{t("name")}</Label>
              <Input id="bk-name" name="name" required minLength={2} maxLength={120} />
              <FieldErr t={t} code={state.fieldErrors?.name} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="bk-email">{t("email")}</Label>
                <Input id="bk-email" name="email" type="email" maxLength={160} />
                <FieldErr t={t} code={state.fieldErrors?.email} />
              </div>
              <div>
                <Label htmlFor="bk-phone">{t("phone")}</Label>
                <Input id="bk-phone" name="phone" inputMode="tel" maxLength={32} />
                <FieldErr t={t} code={state.fieldErrors?.phone} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("contactHint")}</p>

            <div>
              <Label htmlFor="bk-notes">{t("notes")}</Label>
              <Textarea id="bk-notes" name="notes" maxLength={500} rows={2} />
            </div>

            <Switch name="whatsappOptIn" value="true" label={t("whatsappOptIn")} />

            {paymentEnabled && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="payNow" value="true" className="h-4 w-4" />
                {t("payNow")}
              </label>
            )}

            {state.code && !state.ok && (
              <Alert variant="destructive" className="text-sm">
                {t.has(`err.${state.code}`) ? t(`err.${state.code}`) : t("err.generic")}
              </Alert>
            )}
            {state.ok && (
              <Alert variant="success" className="text-sm">
                {t("submitting")}
              </Alert>
            )}

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep(3)}>
                {t("back")}
              </Button>
              <Button type="submit" disabled={submitting || state.ok}>
                {paymentEnabled ? t("confirmAndPay") : t("confirm")}
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

function FieldErr({ t, code }: { t: ReturnType<typeof useTranslations>; code?: string }) {
  if (!code) return null;
  const key = `err.${code}`;
  return <p className="mt-1 text-xs text-destructive">{t.has(key) ? t(key) : t("err.field")}</p>;
}
