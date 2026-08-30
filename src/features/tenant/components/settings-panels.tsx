"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/features/auth/components/form-bits";
import { COUNTRIES, ALL_TIMEZONES, SUPPORTED_CURRENCIES } from "@/lib/regions";
import {
  updateProfileAction,
  updateRegionalAction,
  updateHoursAction,
  addHolidayAction,
  removeHolidayAction,
  updateBookingConfigAction,
  updateChatbotConfigAction,
  updateLoyaltyConfigAction,
  uploadImageAction,
  type SettingsState,
} from "../actions";
import type { ChatbotConfig } from "@/features/chatbot/config";
import type { LoyaltyConfig } from "@/features/loyalty/config";

const initial: SettingsState = { ok: false };
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function Saved({ state }: { state: SettingsState }) {
  const t = useTranslations("settings");
  if (state.ok && state.code === "saved")
    return (
      <Alert variant="success" className="text-sm">
        {t("saved")}
      </Alert>
    );
  if (!state.ok && state.code)
    return (
      <Alert variant="destructive" className="text-sm">
        {t.has(`errors.${state.code}`) ? t(`errors.${state.code}`) : t("errors.generic")}
      </Alert>
    );
  return null;
}

export interface TenantData {
  name: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  currency: string;
  timezone: string;
  locale: string;
  logoUrl: string | null;
  coverUrl: string | null;
}

export function ProfilePanel({ tenant }: { tenant: TenantData }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [state, action] = useActionState(updateProfileAction, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <Saved state={state} />
      <Field label={t("name")} name="name" defaultValue={tenant.name} required />
      <div>
        <Label htmlFor="s-desc">{t("description")}</Label>
        <Textarea id="s-desc" name="description" defaultValue={tenant.description ?? ""} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("publicEmail")}
          name="email"
          type="email"
          defaultValue={tenant.email ?? ""}
        />
        <Field label={t("phone")} name="phone" defaultValue={tenant.phone ?? ""} inputMode="tel" />
        <Field
          label={t("whatsapp")}
          name="whatsapp"
          defaultValue={tenant.whatsapp ?? ""}
          inputMode="tel"
        />
        <Field label="Instagram" name="instagram" defaultValue={tenant.instagram ?? ""} />
        <Field label={t("website")} name="website" type="url" defaultValue={tenant.website ?? ""} />
      </div>
      <Field label={t("address")} name="addressLine1" defaultValue={tenant.addressLine1 ?? ""} />
      <Field label={t("address2")} name="addressLine2" defaultValue={tenant.addressLine2 ?? ""} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("city")} name="city" defaultValue={tenant.city ?? ""} />
        <Field label={t("state")} name="state" defaultValue={tenant.state ?? ""} />
        <Field label={t("postalCode")} name="postalCode" defaultValue={tenant.postalCode ?? ""} />
      </div>
      <SubmitButton>{t("save")}</SubmitButton>
    </form>
  );
}

export function RegionalPanel({ tenant }: { tenant: TenantData }) {
  const t = useTranslations("settings");
  const tc = useTranslations("countries");
  const locale = useLocale();
  const [state, action] = useActionState(updateRegionalAction, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <Saved state={state} />
      <p className="text-sm text-muted-foreground">{t("regionalHint")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="s-country">{t("country")}</Label>
          <Select id="s-country" name="country" defaultValue={tenant.country}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {tc(c.nameKey)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="s-locale">{t("language")}</Label>
          <Select id="s-locale" name="locale" defaultValue={tenant.locale}>
            <option value="pt-BR">Português</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="s-currency">{t("currency")}</Label>
          <Select id="s-currency" name="currency" defaultValue={tenant.currency}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="s-tz">{t("timezone")}</Label>
          <Select id="s-tz" name="timezone" defaultValue={tenant.timezone}>
            {Array.from(new Set([tenant.timezone, ...ALL_TIMEZONES])).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <SubmitButton>{t("save")}</SubmitButton>
    </form>
  );
}

export function HoursPanel({
  rows,
}: {
  rows: { weekday: number; startMin: number; endMin: number }[];
}) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [state, action] = useActionState(updateHoursAction, initial);

  const toHHMM = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const byDay = new Map(rows.map((r) => [r.weekday, r]));
  const [days, setDays] = useState(
    Array.from({ length: 7 }, (_, w) => {
      const r = byDay.get(w);
      return {
        weekday: w,
        open: !!r,
        start: r ? toHHMM(r.startMin) : "09:00",
        end: r ? toHHMM(r.endMin) : "19:00",
      };
    }),
  );

  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const hoursJson = JSON.stringify({
    rows: days.map((d) => ({
      weekday: d.weekday,
      open: d.open,
      startMin: toMin(d.start),
      endMin: toMin(d.end),
    })),
  });

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="hours" value={hoursJson} />
      <Saved state={state} />
      <div className="space-y-2">
        {days.map((d, i) => (
          <div key={d.weekday} className="flex items-center gap-3">
            <div className="w-28">
              <Switch
                checked={d.open}
                onChange={(e) =>
                  setDays((p) => p.map((x, j) => (j === i ? { ...x, open: e.target.checked } : x)))
                }
                label={t(`weekday.${WEEKDAY_KEYS[d.weekday]}`)}
              />
            </div>
            <Input
              type="time"
              className="w-32"
              value={d.start}
              disabled={!d.open}
              onChange={(e) =>
                setDays((p) => p.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))
              }
            />
            <span className="text-muted-foreground">—</span>
            <Input
              type="time"
              className="w-32"
              value={d.end}
              disabled={!d.open}
              onChange={(e) =>
                setDays((p) => p.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))
              }
            />
          </div>
        ))}
      </div>
      <SubmitButton>{t("save")}</SubmitButton>
    </form>
  );
}

export function HolidaysPanel({
  holidays,
}: {
  holidays: { id: string; date: string; name: string; isClosed: boolean }[];
}) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [state, action] = useActionState(addHolidayAction, initial);
  return (
    <div className="space-y-4">
      <Saved state={state} />
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="locale" value={locale} />
        <div>
          <Label htmlFor="h-date">{t("holidayDate")}</Label>
          <Input id="h-date" name="date" type="date" required />
        </div>
        <div className="flex-1">
          <Label htmlFor="h-name">{t("holidayName")}</Label>
          <Input id="h-name" name="name" required maxLength={120} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="isClosed" defaultChecked /> {t("holidayClosed")}
        </label>
        <SubmitButton>{t("add")}</SubmitButton>
      </form>

      <ul className="divide-y rounded-md border">
        {holidays.length === 0 && (
          <li className="p-3 text-sm text-muted-foreground">{t("noHolidays")}</li>
        )}
        {holidays.map((h) => (
          <li key={h.id} className="flex items-center justify-between p-3 text-sm">
            <span>
              <strong>{h.date}</strong> — {h.name}
              {h.isClosed ? "" : ` (${t("holidayOpen")})`}
            </span>
            <form action={removeHolidayAction}>
              <input type="hidden" name="id" value={h.id} />
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="ghost" size="sm">
                {t("remove")}
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BookingConfigPanel({
  config,
}: {
  config: {
    slotGranularityMin: number;
    minLeadTimeMin: number;
    maxAdvanceDays: number;
    onlineBookingEnabled: boolean;
    requireEmployeeSelection: boolean;
    clientCancellationCutoffHours: number;
    defaultBufferMin: number;
  };
}) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [state, action] = useActionState(updateBookingConfigAction, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <Saved state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <NumField
          label={t("slotGranularity")}
          name="slotGranularityMin"
          defaultValue={config.slotGranularityMin}
          min={5}
          max={120}
        />
        <NumField
          label={t("minLeadTime")}
          name="minLeadTimeMin"
          defaultValue={config.minLeadTimeMin}
          min={0}
          max={10080}
        />
        <NumField
          label={t("maxAdvanceDays")}
          name="maxAdvanceDays"
          defaultValue={config.maxAdvanceDays}
          min={1}
          max={365}
        />
        <NumField
          label={t("cancelCutoff")}
          name="clientCancellationCutoffHours"
          defaultValue={config.clientCancellationCutoffHours}
          min={0}
          max={168}
        />
        <NumField
          label={t("defaultBuffer")}
          name="defaultBufferMin"
          defaultValue={config.defaultBufferMin}
          min={0}
          max={120}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="onlineBookingEnabled"
          defaultChecked={config.onlineBookingEnabled}
        />
        {t("onlineBookingEnabled")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="requireEmployeeSelection"
          defaultChecked={config.requireEmployeeSelection}
        />
        {t("requireEmployeeSelection")}
      </label>
      <SubmitButton>{t("save")}</SubmitButton>
    </form>
  );
}

export function ChatbotPanel({ config }: { config: ChatbotConfig }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [state, action] = useActionState(updateChatbotConfigAction, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <Saved state={state} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={config.enabled} />
        {t("chatbotEnabled")}
      </label>
      <p className="text-xs text-muted-foreground">{t("chatbotEnabledHint")}</p>

      <div>
        <Label htmlFor="cb-name">{t("chatbotName")}</Label>
        <Input id="cb-name" name="displayName" defaultValue={config.displayName} maxLength={40} />
      </div>

      <div className="grid gap-3">
        <div>
          <Label htmlFor="cb-g-pt">{t("chatbotGreetingPt")}</Label>
          <Textarea
            id="cb-g-pt"
            name="greeting.pt-BR"
            rows={2}
            maxLength={400}
            defaultValue={config.greeting["pt-BR"]}
          />
        </div>
        <div>
          <Label htmlFor="cb-g-en">{t("chatbotGreetingEn")}</Label>
          <Textarea
            id="cb-g-en"
            name="greeting.en"
            rows={2}
            maxLength={400}
            defaultValue={config.greeting.en}
          />
        </div>
        <div>
          <Label htmlFor="cb-g-es">{t("chatbotGreetingEs")}</Label>
          <Textarea
            id="cb-g-es"
            name="greeting.es"
            rows={2}
            maxLength={400}
            defaultValue={config.greeting.es}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="cb-inst">{t("chatbotInstructions")}</Label>
        <Textarea
          id="cb-inst"
          name="instructions"
          rows={4}
          maxLength={2000}
          defaultValue={config.instructions}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("chatbotInstructionsHint")}</p>
      </div>

      <div>
        <Label htmlFor="cb-kw">{t("chatbotHandoffKeywords")}</Label>
        <Input
          id="cb-kw"
          name="handoffKeywords"
          defaultValue={config.handoffKeywords.join(", ")}
          placeholder="reclamação, gerente, urgente"
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("chatbotHandoffKeywordsHint")}</p>
      </div>

      <SubmitButton>{t("save")}</SubmitButton>
    </form>
  );
}

export function LoyaltyConfigPanel({ config }: { config: LoyaltyConfig }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [state, action] = useActionState(updateLoyaltyConfigAction, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <Saved state={state} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={config.enabled} />
        {t("loyaltyEnabled")}
      </label>
      <p className="text-xs text-muted-foreground">{t("loyaltyEnabledHint")}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <NumField
          label={t("pointsPerVisit")}
          name="pointsPerVisit"
          defaultValue={config.pointsPerVisit}
          min={0}
          max={10000}
        />
        <NumField
          label={t("pointsPerCurrencyCents")}
          name="pointsPerCurrencyCents"
          defaultValue={config.pointsPerCurrencyCents}
          min={0}
          max={1000000}
        />
        <NumField
          label={t("pointsExpireDays")}
          name="pointsExpireDays"
          defaultValue={config.pointsExpireDays}
          min={0}
          max={3650}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("pointsPerCurrencyHint")}</p>
      <SubmitButton>{t("save")}</SubmitButton>
    </form>
  );
}

export function BrandingPanel({ tenant }: { tenant: TenantData }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(formData: FormData) {
    formData.set("locale", locale);
    const res = await uploadImageAction(formData);
    setMsg(
      res.ok
        ? t("saved")
        : t.has(`errors.${res.code}`)
          ? t(`errors.${res.code}`)
          : t("errors.generic"),
    );
  }

  return (
    <div className="space-y-6">
      {msg && <Alert className="text-sm">{msg}</Alert>}
      {(["logo", "cover"] as const).map((kind) => (
        <form key={kind} action={upload} className="flex items-center gap-4">
          <div className="w-40">
            <Label>{t(kind)}</Label>
            {(kind === "logo" ? tenant.logoUrl : tenant.coverUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={(kind === "logo" ? tenant.logoUrl : tenant.coverUrl) as string}
                alt={t(kind)}
                className="mt-1 h-16 w-auto rounded border object-contain"
              />
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t("noImage")}</p>
            )}
          </div>
          <input type="hidden" name="kind" value={kind} />
          <input
            type="file"
            name="file"
            accept="image/png,image/jpeg,image/webp"
            required
            className="text-sm"
          />
          <Button type="submit" variant="outline" size="sm">
            {t("upload")}
          </Button>
        </form>
      ))}
      <p className="text-xs text-muted-foreground">{t("imageHint")}</p>
    </div>
  );
}

// ---- small field helpers ----------------------------------------------
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
      <Label htmlFor={`f-${name}`}>{label}</Label>
      <Input
        id={`f-${name}`}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        inputMode={inputMode}
      />
    </div>
  );
}

function NumField({
  label,
  name,
  defaultValue,
  min,
  max,
}: {
  label: string;
  name: string;
  defaultValue: number;
  min: number;
  max: number;
}) {
  return (
    <div>
      <Label htmlFor={`n-${name}`}>{label}</Label>
      <Input
        id={`n-${name}`}
        name={name}
        type="number"
        defaultValue={defaultValue}
        min={min}
        max={max}
      />
    </div>
  );
}
