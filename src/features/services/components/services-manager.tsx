"use client";

import { useActionState, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/features/auth/components/form-bits";
import { formatMoney } from "@/lib/utils";
import { SUPPORTED_CURRENCIES } from "@/lib/regions";
import {
  saveServiceAction,
  setServiceStatusAction,
  deleteServiceAction,
  type ServiceState,
} from "../actions";

type Svc = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  durationMin: number;
  bufferMin: number;
  status: "ACTIVE" | "ARCHIVED";
  employeeIds: string[];
  appointmentCount: number;
};

const initial: ServiceState = { ok: false };

export function ServicesManager({
  services,
  employeeOptions,
  canEdit,
  defaultCurrency,
}: {
  services: Svc[];
  employeeOptions: { id: string; name: string }[];
  canEdit: boolean;
  defaultCurrency: string;
}) {
  const t = useTranslations("services");
  const locale = useLocale();
  const [editing, setEditing] = useState<Svc | null | "new">(null);

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>{t("new")}</Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">{t("name")}</th>
              <th className="p-3">{t("price")}</th>
              <th className="p-3">{t("duration")}</th>
              <th className="p-3">{t("buffer")}</th>
              <th className="p-3">{t("barbers")}</th>
              <th className="p-3">{t("status")}</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {services.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            )}
            {services.map((s) => (
              <tr key={s.id} className={s.status === "ARCHIVED" ? "opacity-60" : ""}>
                <td className="p-3 font-medium">
                  {s.name}
                  {s.description && (
                    <div className="text-xs font-normal text-muted-foreground">{s.description}</div>
                  )}
                </td>
                <td className="p-3">{formatMoney(s.priceCents, s.currency, locale)}</td>
                <td className="p-3 text-muted-foreground">{s.durationMin}</td>
                <td className="p-3 text-muted-foreground">{s.bufferMin}</td>
                <td className="p-3 text-muted-foreground">
                  {t("barbersCount", { n: String(s.employeeIds.length) })}
                </td>
                <td className="p-3">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {t(`status${s.status}`)}
                  </span>
                </td>
                <td className="p-3 text-right">
                  {canEdit && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        {t("edit")}
                      </Button>
                      <StatusForm svc={s} />
                      {s.appointmentCount === 0 && (
                        <form action={deleteServiceAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="locale" value={locale} />
                          <Button variant="ghost" size="sm" type="submit">
                            {t("delete")}
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ServiceFormModal
          svc={editing === "new" ? null : editing}
          employeeOptions={employeeOptions}
          defaultCurrency={defaultCurrency}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function StatusForm({ svc }: { svc: Svc }) {
  const t = useTranslations("services");
  const locale = useLocale();
  const next = svc.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE";
  return (
    <form action={setServiceStatusAction}>
      <input type="hidden" name="id" value={svc.id} />
      <input type="hidden" name="status" value={next} />
      <input type="hidden" name="locale" value={locale} />
      <Button variant="ghost" size="sm" type="submit">
        {next === "ARCHIVED" ? t("archive") : t("restore")}
      </Button>
    </form>
  );
}

function ServiceFormModal({
  svc,
  employeeOptions,
  defaultCurrency,
  onClose,
}: {
  svc: Svc | null;
  employeeOptions: { id: string; name: string }[];
  defaultCurrency: string;
  onClose: () => void;
}) {
  const t = useTranslations("services");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [state, action] = useActionState(saveServiceAction, initial);
  const [price, setPrice] = useState(svc ? String(svc.priceCents / 100) : "");

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <Modal open onClose={onClose} title={svc ? t("edit") : t("new")}>
      <form action={action} className="space-y-3">
        {svc && <input type="hidden" name="id" value={svc.id} />}
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="priceCents" value={Math.round(Number(price || 0) * 100)} />
        {state.code && !state.ok && (
          <Alert variant="destructive" className="text-sm">
            {state.code && t.has(`errors.${state.code}`)
              ? t(`errors.${state.code}`)
              : t("errors.generic")}
          </Alert>
        )}
        <div>
          <Label>{t("name")}</Label>
          <Input name="name" defaultValue={svc?.name} required minLength={2} />
        </div>
        <div>
          <Label>{t("description")}</Label>
          <Textarea name="description" defaultValue={svc?.description ?? ""} maxLength={1000} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("price")}</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>{t("currency")}</Label>
            <Select name="currency" defaultValue={svc?.currency ?? defaultCurrency}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{t("duration")}</Label>
            <Input
              name="durationMin"
              type="number"
              min={5}
              max={480}
              defaultValue={svc?.durationMin ?? 30}
              required
            />
          </div>
          <div>
            <Label>{t("buffer")}</Label>
            <Input
              name="bufferMin"
              type="number"
              min={0}
              max={120}
              defaultValue={svc?.bufferMin ?? 0}
            />
          </div>
          <div>
            <Label>{t("status")}</Label>
            <Select name="status" defaultValue={svc?.status ?? "ACTIVE"}>
              <option value="ACTIVE">{t("statusACTIVE")}</option>
              <option value="ARCHIVED">{t("statusARCHIVED")}</option>
            </Select>
          </div>
        </div>
        <div>
          <Label>{t("barbers")}</Label>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
            {employeeOptions.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
            {employeeOptions.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="employeeIds"
                  value={e.id}
                  defaultChecked={svc?.employeeIds.includes(e.id)}
                />
                {e.name}
              </label>
            ))}
          </div>
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
