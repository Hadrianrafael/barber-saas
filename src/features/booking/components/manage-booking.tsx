"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { publicSlotsAction, manageBookingAction, type BookingState } from "../actions";

type Slot = { startsAt: string; endsAt: string; employeeId: string };

export interface ManageBookingProps {
  token: string;
  slug: string;
  locale: string;
  timezone: string;
  serviceId: string;
  canCancel: boolean;
  canReschedule: boolean;
  cutoffHours: number;
}

const initial: BookingState = { ok: false };

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function ManageBooking(props: ManageBookingProps) {
  const t = useTranslations("booking");
  const { token, slug, locale, timezone, serviceId, canCancel, canReschedule, cutoffHours } = props;

  const [mode, setMode] = useState<"idle" | "reschedule">("idle");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [pending, startT] = useTransition();
  const [state, formAction] = useActionState(manageBookingAction, initial);

  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone }),
    [locale, timezone],
  );
  const minDate = isoDate(new Date(Date.now() + 3_600_000));

  useEffect(() => {
    if (mode !== "reschedule" || !date) return;
    startT(async () => {
      const res = await publicSlotsAction(slug, { serviceId, dateISO: date });
      setSlots(res.ok && res.data?.slots ? res.data.slots : []);
    });
  }, [mode, date, slug, serviceId]);

  if (state.ok && (state.code === "cancelled" || state.code === "rescheduled")) {
    return (
      <Alert variant="success" className="text-sm">
        {t(state.code === "cancelled" ? "cancelledOk" : "rescheduledOk")}
      </Alert>
    );
  }

  if (!canCancel && !canReschedule) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("changeCutoffPassed", { h: String(cutoffHours) })}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {state.code && !state.ok && (
        <Alert variant="destructive" className="text-sm">
          {t.has(`err.${state.code}`) ? t(`err.${state.code}`) : t("err.generic")}
        </Alert>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          {canReschedule && (
            <Button variant="outline" size="sm" onClick={() => setMode("reschedule")}>
              {t("reschedule")}
            </Button>
          )}
          {canCancel && (
            <form action={formAction}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="action" value="cancel" />
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="destructive" size="sm">
                {t("cancelBooking")}
              </Button>
            </form>
          )}
        </div>
      )}

      {mode === "reschedule" && (
        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <Label htmlFor="rs-date">{t("date")}</Label>
            <Input
              id="rs-date"
              type="date"
              value={date}
              min={minDate}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {pending && <p className="text-sm text-muted-foreground">{t("loadingSlots")}</p>}
          {!pending && date && slots.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("noSlots")}</p>
          )}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((s) => (
              <form action={formAction} key={s.startsAt}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="action" value="reschedule" />
                <input type="hidden" name="startsAt" value={s.startsAt} />
                <input type="hidden" name="employeeId" value={s.employeeId} />
                <input type="hidden" name="locale" value={locale} />
                <button
                  type="submit"
                  className="w-full rounded-md border px-2 py-2 text-sm hover:bg-accent"
                >
                  {timeFmt.format(new Date(s.startsAt))}
                </button>
              </form>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setMode("idle")}>
            {t("back")}
          </Button>
        </div>
      )}
    </div>
  );
}
