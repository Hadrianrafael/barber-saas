"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { formatMoney } from "@/lib/utils";
import { choosePlanAction, type OnboardingState } from "../actions";

interface PlanView {
  code: string;
  name: string;
  priceCents: number;
  currency: string;
  trialDays: number;
  limits: Record<string, unknown>;
}

const initial: OnboardingState = { ok: false };

export function PlanPicker({
  plans,
  stripeConfigured,
}: {
  plans: PlanView[];
  stripeConfigured: boolean;
}) {
  const t = useTranslations("plan");
  const locale = useLocale();
  const [state, action] = useActionState(choosePlanAction, initial);

  return (
    <div className="space-y-6">
      {!stripeConfigured && <Alert className="text-sm">{t("stripeNotConfigured")}</Alert>}
      {state.ok && state.code === "stripeRedirectPending" && (
        <Alert className="text-sm">{t("stripeRedirectPending")}</Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.code} className="flex flex-col">
            <CardHeader>
              <CardTitle>{p.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="text-2xl font-bold">
                {formatMoney(p.priceCents, p.currency, locale)}
                <span className="text-sm font-normal text-muted-foreground">
                  /{t("interval.month")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("trial", { days: String(p.trialDays) })}
              </p>
              <ul className="flex-1 space-y-1 text-sm text-muted-foreground">
                <li>{t("limitEmployees", { n: String(p.limits.maxEmployees ?? "—") })}</li>
                <li>
                  {t("limitAppointments", {
                    n: String(p.limits.maxMonthlyAppointments ?? "—"),
                  })}
                </li>
                <li>{p.limits.whatsapp ? t("featWhatsapp") : t("noWhatsapp")}</li>
                <li>{p.limits.chatbot ? t("featChatbot") : t("noChatbot")}</li>
              </ul>
              <form action={action}>
                <input type="hidden" name="planCode" value={p.code} />
                <input type="hidden" name="locale" value={locale} />
                <Button type="submit" className="w-full">
                  {stripeConfigured ? t("choosePaid") : t("startTrial")}
                </Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
