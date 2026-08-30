"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { SubmitButton } from "@/features/auth/components/form-bits";
import { Alert } from "@/components/ui/alert";
import { COUNTRIES, SUPPORTED_CURRENCIES } from "@/lib/regions";
import { normalizeSlug } from "@/features/tenant/slug";
import { createTenantAction, checkSlugAction, type OnboardingState } from "../actions";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DEFAULT_ROWS = WEEKDAY_KEYS.map((_, weekday) => ({
  weekday,
  open: weekday >= 1 && weekday <= 6,
  start: "09:00",
  end: "19:00",
}));

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const initial: OnboardingState = { ok: false };

export function OnboardingWizard({ suggestedSlug }: { suggestedSlug: string }) {
  const t = useTranslations("onboarding");
  const tc = useTranslations("countries");
  const uiLocale = useLocale();
  const [state, action] = useActionState(createTenantAction, initial);

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState(suggestedSlug);
  const [slugEdited, setSlugEdited] = useState(false);
  const [country, setCountry] = useState("BR");
  const [currency, setCurrency] = useState("BRL");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [locale, setLocale] = useState(uiLocale);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "ok" | "taken" | "invalid">(
    "idle",
  );

  const countryCfg = useMemo(
    () => COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0]!,
    [country],
  );

  // When country changes, follow its defaults (unless the user already picked).
  const currencyTouched = useRef(false);
  const tzTouched = useRef(false);
  useEffect(() => {
    if (!currencyTouched.current) setCurrency(countryCfg.currency);
    if (!tzTouched.current) setTimezone(countryCfg.timezones[0]!);
  }, [countryCfg]);

  // Derive slug from name until the user edits it manually.
  useEffect(() => {
    if (!slugEdited && name) setSlug(normalizeSlug(name));
  }, [name, slugEdited]);

  // Debounced slug availability check.
  useEffect(() => {
    if (!slug || slug.length < 3) {
      setSlugStatus(slug.length === 0 ? "idle" : "invalid");
      return;
    }
    setSlugStatus("checking");
    const id = setTimeout(async () => {
      const res = await checkSlugAction(slug);
      if (res.slug && res.slug !== slug) setSlug(res.slug);
      setSlugStatus(res.available ? "ok" : res.problem === "taken" ? "taken" : "invalid");
    }, 400);
    return () => clearTimeout(id);
  }, [slug]);

  const hoursJson = JSON.stringify({
    rows: rows.map((r) => ({
      weekday: r.weekday,
      open: r.open,
      startMin: toMin(r.start),
      endMin: toMin(r.end),
    })),
  });

  const step1Valid = name.trim().length >= 2 && slug.length >= 3 && slugStatus === "ok";

  return (
    <form action={action} className="space-y-6">
      {/* hidden canonical values */}
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="country" value={country} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="hours" value={hoursJson} />

      <ol className="flex gap-2 text-xs text-muted-foreground">
        {[1, 2, 3].map((n) => (
          <li
            key={n}
            className={`flex-1 rounded-full px-2 py-1 text-center ${
              step === n ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            {t(`step${n}`)}
          </li>
        ))}
      </ol>

      {state.code && !state.ok && (
        <Alert variant="destructive" className="text-sm">
          {t.has(`errors.${state.code}`) ? t(`errors.${state.code}`) : t("errors.error")}
        </Alert>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <Label htmlFor="ob-name">{t("name")}</Label>
            <Input
              id="ob-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              autoFocus
            />
            {state.fieldErrors?.name && (
              <p className="mt-1 text-xs text-destructive">{t("errors.name")}</p>
            )}
          </div>

          <div>
            <Label htmlFor="ob-slug">{t("slug")}</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">/barber/</span>
              <Input
                id="ob-slug"
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(normalizeSlug(e.target.value));
                }}
                required
              />
            </div>
            <p className="mt-1 text-xs">
              {slugStatus === "checking" && (
                <span className="text-muted-foreground">{t("slugChecking")}</span>
              )}
              {slugStatus === "ok" && (
                <span className="text-emerald-600">{t("slugAvailable")}</span>
              )}
              {slugStatus === "taken" && <span className="text-destructive">{t("slugTaken")}</span>}
              {slugStatus === "invalid" && (
                <span className="text-destructive">{t("slugInvalid")}</span>
              )}
            </p>
            {state.fieldErrors?.slug && (
              <p className="mt-1 text-xs text-destructive">{t("slugTaken")}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ob-country">{t("country")}</Label>
              <Select id="ob-country" value={country} onChange={(e) => setCountry(e.target.value)}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {tc(c.nameKey)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ob-locale">{t("language")}</Label>
              <Select id="ob-locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
                <option value="pt-BR">Português</option>
                <option value="en">English</option>
                <option value="es">Español</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="ob-currency">{t("currency")}</Label>
              <Select
                id="ob-currency"
                value={currency}
                onChange={(e) => {
                  currencyTouched.current = true;
                  setCurrency(e.target.value);
                }}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ob-tz">{t("timezone")}</Label>
              <Select
                id="ob-tz"
                value={timezone}
                onChange={(e) => {
                  tzTouched.current = true;
                  setTimezone(e.target.value);
                }}
              >
                {Array.from(new Set([timezone, ...countryCfg.timezones])).map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <Button
            type="button"
            className="w-full"
            disabled={!step1Valid}
            onClick={() => setStep(2)}
          >
            {t("continue")}
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("step2Hint")}</p>
          <div>
            <Label htmlFor="ob-desc">{t("description")}</Label>
            <Textarea id="ob-desc" name="description" maxLength={2000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ob-email">{t("publicEmail")}</Label>
              <Input id="ob-email" name="email" type="email" />
            </div>
            <div>
              <Label htmlFor="ob-phone">{t("phone")}</Label>
              <Input id="ob-phone" name="phone" inputMode="tel" placeholder={countryCfg.dialCode} />
            </div>
            <div>
              <Label htmlFor="ob-wa">{t("whatsapp")}</Label>
              <Input id="ob-wa" name="whatsapp" inputMode="tel" placeholder={countryCfg.dialCode} />
            </div>
            <div>
              <Label htmlFor="ob-ig">Instagram</Label>
              <Input id="ob-ig" name="instagram" placeholder="@" />
            </div>
          </div>
          <div>
            <Label htmlFor="ob-web">{t("website")}</Label>
            <Input id="ob-web" name="website" type="url" placeholder="https://" />
          </div>
          <div>
            <Label htmlFor="ob-addr1">{t("address")}</Label>
            <Input id="ob-addr1" name="addressLine1" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input name="city" placeholder={t("city")} />
            <Input name="state" placeholder={t("state")} />
            <Input name="postalCode" placeholder={t("postalCode")} />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              {t("back")}
            </Button>
            <Button type="button" className="flex-1" onClick={() => setStep(3)}>
              {t("continue")}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("step3Hint")}</p>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={r.weekday} className="flex items-center gap-3">
                <div className="w-28">
                  <Switch
                    checked={r.open}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, open: e.target.checked } : x)),
                      )
                    }
                    label={t(`weekday.${WEEKDAY_KEYS[r.weekday]}`)}
                  />
                </div>
                <Input
                  type="time"
                  value={r.start}
                  disabled={!r.open}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)),
                    )
                  }
                  className="w-32"
                />
                <span className="text-muted-foreground">—</span>
                <Input
                  type="time"
                  value={r.end}
                  disabled={!r.open}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                    )
                  }
                  className="w-32"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(2)}>
              {t("back")}
            </Button>
            <div className="flex-1">
              <SubmitButton>{t("createCta")}</SubmitButton>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
