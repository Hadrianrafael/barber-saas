"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/features/auth/components/form-bits";
import {
  saveSelfProfileAction,
  addTimeOffAction,
  removeTimeOffAction,
  type TeamState,
} from "../actions";

const initial: TeamState = { ok: false };

export function SelfProfile({
  employee,
  timeOff,
}: {
  employee: {
    id: string;
    bio: string | null;
    phone: string | null;
    photoUrl: string | null;
    specialties: string[];
  };
  timeOff: { id: string; kind: string; startsAt: string; endsAt: string; reason: string | null }[];
}) {
  const t = useTranslations("team");
  const locale = useLocale();
  const [pState, pAction] = useActionState(saveSelfProfileAction, initial);
  const [oState, oAction] = useActionState(addTimeOffAction, initial);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h3 className="mb-3 font-medium">{t("myProfile")}</h3>
        <form action={pAction} className="space-y-3">
          <input type="hidden" name="locale" value={locale} />
          {pState.ok && (
            <Alert variant="success" className="text-sm">
              {t("saved")}
            </Alert>
          )}
          <div>
            <Label>{t("bio")}</Label>
            <Textarea name="bio" defaultValue={employee.bio ?? ""} maxLength={600} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("phone")}</Label>
              <Input name="phone" defaultValue={employee.phone ?? ""} inputMode="tel" />
            </div>
            <div>
              <Label>{t("photoUrl")}</Label>
              <Input name="photoUrl" defaultValue={employee.photoUrl ?? ""} />
            </div>
          </div>
          <div>
            <Label>
              {t("specialties")} ({t("specialtiesHint")})
            </Label>
            <Input name="specialties" defaultValue={employee.specialties.join(", ")} />
          </div>
          <SubmitButton>{t("save")}</SubmitButton>
        </form>
      </div>

      <div className="rounded-lg border p-4">
        <h3 className="mb-3 font-medium">{t("timeOff")}</h3>
        <form action={oAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="employeeId" value={employee.id} />
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
        {oState.code && !oState.ok && (
          <Alert variant="destructive" className="mt-2 text-sm">
            {oState.code && t.has(`errors.${oState.code}`)
              ? t(`errors.${oState.code}`)
              : t("errors.generic")}
          </Alert>
        )}
        <ul className="mt-3 divide-y rounded-md border text-sm">
          {timeOff.length === 0 && <li className="p-3 text-muted-foreground">{t("noTimeOff")}</li>}
          {timeOff.map((r) => (
            <li key={r.id} className="flex items-center justify-between p-3">
              <span>
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
    </div>
  );
}
