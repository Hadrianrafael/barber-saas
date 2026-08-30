"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { formatMoney } from "@/lib/utils";
import type { PlanLimits } from "../plan-limits";
import { startCheckoutAction, type BillingState } from "../actions";

export interface PlanView {
  code: string;
  name: string;
  priceCents: number;
  priceCentsYearly: number | null;
  currency: string;
  trialDays: number;
  limits: PlanLimits;
}

const initial: BillingState = { ok: false };

export function PricingTable({
  plans,
  locale,
  signedIn,
  currentPlanCode,
}: {
  plans: PlanView[];
  locale: string;
  signedIn: boolean;
  currentPlanCode?: string | null;
}) {
  const t = useTranslations("pricing");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [state, action] = useActionState(startCheckoutAction, initial);

  return (
    <div className="space-y-6">
      <div className="flex justify-center gap-2">
        <button
          onClick={() => setInterval("month")}
          className={`rounded-md px-3 py-1 text-sm ${interval === "month" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
        >
          {t("monthly")}
        </button>
        <button
          onClick={() => setInterval("year")}
          className={`rounded-md px-3 py-1 text-sm ${interval === "year" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
        >
          {t("yearly")}
        </button>
      </div>

      {state.code && (
        <Alert
          variant={state.code === "stripeNotConfigured" ? "default" : "destructive"}
          className="text-sm"
        >
          {t.has(`notice.${state.code}`) ? t(`notice.${state.code}`) : t("notice.generic")}
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((p) => {
          const price =
            interval === "year" && p.priceCentsYearly != null ? p.priceCentsYearly : p.priceCents;
          const isCurrent = currentPlanCode === p.code;
          return (
            <Card key={p.code} className="flex flex-col">
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div className="text-3xl font-bold">
                  {formatMoney(price, p.currency, locale)}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{t(`per.${interval}`)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("trial", { days: String(p.trialDays) })}
                </p>
                <ul className="flex-1 space-y-1 text-sm text-muted-foreground">
                  <li>{t("lim.employees", { n: String(p.limits.maxEmployees) })}</li>
                  <li>{t("lim.appointments", { n: String(p.limits.maxMonthlyAppointments) })}</li>
                  <li>{t("lim.customers", { n: String(p.limits.maxCustomers) })}</li>
                  <li>{p.limits.whatsapp ? t("feat.whatsappYes") : t("feat.whatsappNo")}</li>
                  <li>{p.limits.chatbot ? t("feat.chatbotYes") : t("feat.chatbotNo")}</li>
                  <li>{p.limits.campaigns ? t("feat.campaignsYes") : t("feat.campaignsNo")}</li>
                </ul>

                {signedIn ? (
                  isCurrent ? (
                    <Button disabled className="w-full">
                      {t("current")}
                    </Button>
                  ) : (
                    <form action={action}>
                      <input type="hidden" name="planCode" value={p.code} />
                      <input type="hidden" name="interval" value={interval} />
                      <input type="hidden" name="locale" value={locale} />
                      <Button type="submit" className="w-full">
                        {currentPlanCode ? t("switch") : t("subscribe")}
                      </Button>
                    </form>
                  )
                ) : (
                  <Button asChild className="w-full">
                    <Link href={`/${locale}/sign-up?plan=${p.code}`}>{t("start")}</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
