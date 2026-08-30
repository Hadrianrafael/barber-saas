"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/features/auth/components/form-bits";
import { formatMoney } from "@/lib/utils";
import {
  saveCustomerAction,
  getCustomerDetailAction,
  setConsentAction,
  anonymizeCustomerAction,
  type CrmState,
  type CustomerDetail,
} from "../actions";

const initial: CrmState = { ok: false };
type Detail = CustomerDetail;

export function CustomerModal({
  mode,
  locale,
  customer,
  employees,
  currency = "BRL",
  canWrite = true,
  canDelete = false,
  onClose,
}: {
  mode: "edit" | "detail";
  locale: string;
  customer: { id: string } | null;
  employees: { id: string; name: string }[];
  currency?: string;
  canWrite?: boolean;
  canDelete?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("crm");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(!!customer);
  const [tab, setTab] = useState<"profile" | "history" | "consent">(
    mode === "detail" ? "history" : "profile",
  );
  const [state, action] = useActionState(saveCustomerAction, initial);

  useEffect(() => {
    if (!customer) {
      setLoading(false);
      return;
    }
    getCustomerDetailAction(customer.id).then((res) => {
      if (res.ok && res.data) setDetail(res.data.customer as Detail);
      setLoading(false);
    });
  }, [customer]);

  useEffect(() => {
    if (state.ok) {
      if (customer)
        getCustomerDetailAction(customer.id).then(
          (r) => r.ok && r.data && setDetail(r.data.customer as Detail),
        );
      else onClose();
    }
  }, [state.ok, customer, onClose]);

  const c = detail;

  return (
    <Modal open onClose={onClose} title={c ? c.name : t("new")} className="max-w-2xl">
      {loading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : (
        <div className="space-y-4">
          {c && (
            <div className="flex gap-2 text-sm">
              {(["profile", "history", "consent"] as const).map((x) => (
                <button
                  key={x}
                  onClick={() => setTab(x)}
                  className={`rounded-md px-3 py-1 ${tab === x ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  {t(`tab_${x}`)}
                </button>
              ))}
            </div>
          )}

          {(tab === "profile" || !c) && (
            <form action={action} className="space-y-3">
              {c && <input type="hidden" name="id" value={c.id} />}
              <input type="hidden" name="locale" value={locale} />
              {state.code && !state.ok && (
                <Alert variant="destructive" className="text-sm">
                  {state.code && t.has(`errors.${state.code}`)
                    ? t(`errors.${state.code}`)
                    : t("errors.generic")}
                </Alert>
              )}
              {state.ok && (
                <Alert variant="success" className="text-sm">
                  {t("saved")}
                </Alert>
              )}
              <fieldset disabled={!canWrite || !!c?.anonymizedAt} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("name")} name="name" defaultValue={c?.name} required />
                  <div>
                    <Label>{t("clientLocale")}</Label>
                    <Select name="locale" defaultValue={c?.locale ?? "pt-BR"}>
                      <option value="pt-BR">Português</option>
                      <option value="en">English</option>
                      <option value="es">Español</option>
                    </Select>
                  </div>
                  <Field
                    label={t("email")}
                    name="email"
                    type="email"
                    defaultValue={c?.email ?? ""}
                  />
                  <Field
                    label={t("phone")}
                    name="phone"
                    defaultValue={c?.phone ?? ""}
                    inputMode="tel"
                  />
                  <Field
                    label={t("whatsapp")}
                    name="whatsapp"
                    defaultValue={c?.whatsapp ?? ""}
                    inputMode="tel"
                  />
                  <Field
                    label={t("birthDate")}
                    name="birthDate"
                    type="date"
                    defaultValue={c?.birthDate ?? ""}
                  />
                  <div>
                    <Label>{t("preferredBarber")}</Label>
                    <Select name="preferredEmployeeId" defaultValue={c?.preferredEmployeeId ?? ""}>
                      <option value="">—</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label>{t("status")}</Label>
                    <Select name="status" defaultValue={c?.status ?? "ACTIVE"}>
                      <option value="ACTIVE">{t("statusACTIVE")}</option>
                      <option value="INACTIVE">{t("statusINACTIVE")}</option>
                      <option value="BLOCKED">{t("statusBLOCKED")}</option>
                    </Select>
                  </div>
                </div>
                <Field
                  label={`${t("tags")} (${t("tagsHint")})`}
                  name="tags"
                  defaultValue={c?.tags?.join(", ") ?? ""}
                />
                <div>
                  <Label>{t("notes")}</Label>
                  <Textarea name="notes" defaultValue={c?.notes ?? ""} maxLength={2000} />
                </div>
                <div className="flex justify-end">
                  <SubmitButton>{t("save")}</SubmitButton>
                </div>
              </fieldset>
            </form>
          )}

          {c && tab === "history" && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Stat label={t("visits")} value={String(c.visitsCount)} />
                <Stat
                  label={t("totalSpent")}
                  value={formatMoney(c.totalSpentCents, currency, locale)}
                />
                <Stat
                  label={t("lastVisit")}
                  value={c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString(locale) : "—"}
                />
              </div>
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
                {c.appointments.length === 0 && (
                  <li className="p-3 text-muted-foreground">{t("noHistory")}</li>
                )}
                {c.appointments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between p-3">
                    <span>
                      {new Date(a.startsAt).toLocaleString(locale)} · {a.serviceName} ·{" "}
                      {a.employeeName}
                    </span>
                    <span className="text-muted-foreground">
                      {formatMoney(a.priceCents, a.currency, locale)} ·{" "}
                      {t(`apptStatus.${a.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {c && tab === "consent" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("consentHint")}</p>
              {(["WHATSAPP", "EMAIL", "SMS"] as const).map((ch) => {
                const granted = c.consents.find((x) => x.channel === ch)?.granted ?? false;
                return (
                  <ConsentRow
                    key={ch}
                    channel={ch}
                    granted={granted}
                    customerId={c.id}
                    locale={locale}
                    disabled={!canWrite || !!c.anonymizedAt}
                    onChanged={() =>
                      getCustomerDetailAction(c.id).then(
                        (r) => r.ok && r.data && setDetail(r.data.customer as Detail),
                      )
                    }
                  />
                );
              })}
            </div>
          )}

          {c && canDelete && !c.anonymizedAt && (
            <div className="border-t pt-3">
              <form action={anonymizeCustomerAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="locale" value={locale} />
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  onClick={(e) => {
                    if (!confirm(t("anonymizeConfirm"))) e.preventDefault();
                  }}
                >
                  {t("anonymize")}
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">{t("anonymizeHint")}</p>
              </form>
            </div>
          )}
          {c?.anonymizedAt && <p className="text-xs text-muted-foreground">{t("anonymized")}</p>}
        </div>
      )}
    </Modal>
  );
}

function ConsentRow({
  channel,
  granted,
  customerId,
  locale,
  disabled,
  onChanged,
}: {
  channel: "WHATSAPP" | "EMAIL" | "SMS";
  granted: boolean;
  customerId: string;
  locale: string;
  disabled: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("crm");
  const [state, action] = useActionState(setConsentAction, initial);
  useEffect(() => {
    if (state.ok) onChanged();
  }, [state.ok, onChanged]);
  return (
    <form action={action} className="flex items-center justify-between rounded-md border p-3">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="granted" value={(!granted).toString()} />
      <span className="text-sm">{t(`channel_${channel}`)}</span>
      <div className="flex items-center gap-2">
        <span className={`text-xs ${granted ? "text-emerald-600" : "text-muted-foreground"}`}>
          {granted ? t("optedIn") : t("optedOut")}
        </span>
        <Button type="submit" size="sm" variant="outline" disabled={disabled}>
          {granted ? t("optOut") : t("optIn")}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required,
  inputMode,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  inputMode?: "tel" | "text" | "email" | "url";
}) {
  return (
    <div>
      <Label htmlFor={`c-${name}`}>{label}</Label>
      <Input
        id={`c-${name}`}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        inputMode={inputMode}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
