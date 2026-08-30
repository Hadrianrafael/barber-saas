"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { createCampaignAction, estimateAction, type CampaignState } from "../actions";

const initial: CampaignState = { ok: false };
const SEGMENTS = [
  "all",
  "active",
  "inactive",
  "new",
  "recurring",
  "by_service",
  "by_employee",
  "opted_in",
];
const VARS = ["nome", "barbearia", "barbeiro", "ultimo_servico", "link_agendamento"];

export function CampaignForm({
  services,
  employees,
}: {
  services: { id: string; name: string }[];
  employees: { id: string; name: string }[];
}) {
  const t = useTranslations("campaigns");
  const locale = useLocale();
  const [state, action] = useActionState(createCampaignAction, initial);
  const [channel, setChannel] = useState("EMAIL");
  const [segment, setSegment] = useState("all");
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);

  async function runEstimate(form: HTMLFormElement) {
    setEstimating(true);
    const fd = new FormData(form);
    const res = await estimateAction(fd);
    setEstimating(false);
    setEstimate(res.ok ? (res.data?.count ?? 0) : null);
  }

  return (
    <form action={action} className="space-y-4" onChange={() => setEstimate(null)}>
      <input type="hidden" name="locale" value={locale} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="c-name">{t("name")}</Label>
          <Input id="c-name" name="name" required minLength={2} maxLength={120} />
        </div>
        <div>
          <Label htmlFor="c-channel">{t("channel")}</Label>
          <Select
            id="c-channel"
            name="channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="EMAIL">{t("ch.EMAIL")}</option>
            <option value="WHATSAPP">{t("ch.WHATSAPP")}</option>
            <option value="SMS">{t("ch.SMS")}</option>
          </Select>
        </div>
      </div>

      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">{t("audience")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="c-seg">{t("segment")}</Label>
            <Select
              id="c-seg"
              name="segment"
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
            >
              {SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {t(`seg.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          {segment === "by_service" && (
            <div>
              <Label htmlFor="c-svc">{t("service")}</Label>
              <Select id="c-svc" name="serviceId">
                <option value="">—</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {segment === "by_employee" && (
            <div>
              <Label htmlFor="c-emp">{t("barber")}</Label>
              <Select id="c-emp" name="employeeId">
                <option value="">—</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {segment === "opted_in" && <input type="hidden" name="channel" value={channel} />}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={estimating}
          onClick={(e) => runEstimate(e.currentTarget.form!)}
        >
          {t("estimate")}
        </Button>
        {estimate !== null && (
          <p className="text-sm text-muted-foreground">
            {t("estimateResult", { n: String(estimate) })}
          </p>
        )}
      </fieldset>

      {channel === "EMAIL" && (
        <div>
          <Label htmlFor="c-subj">{t("subject")}</Label>
          <Input id="c-subj" name="subject" maxLength={200} />
        </div>
      )}
      <div>
        <Label htmlFor="c-body">{t("message")}</Label>
        <Textarea id="c-body" name="body" rows={6} required minLength={4} maxLength={4000} />
        <p className="mt-1 text-xs text-muted-foreground">
          {t("varsHelp")}: {VARS.map((v) => `{{${v}}}`).join(" ")}
        </p>
      </div>

      {state.fieldErrors && (
        <Alert variant="destructive" className="text-sm">
          {t("formError")}
        </Alert>
      )}

      <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
        {t("consentNote")}
      </div>

      <Button type="submit">{t("createDraft")}</Button>
    </form>
  );
}
