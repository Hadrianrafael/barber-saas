"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { openPortalAction } from "../actions";
import { PricingTable, type PlanView } from "./pricing-table";

interface Ent {
  planCode: string | null;
  planName: string | null;
  status: string;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  inGrace: boolean;
  blocked: boolean;
  blockReason: string | null;
  interval: string;
  priceCents: number | null;
  currency: string;
}
interface Inv {
  id: string;
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
  createdAt: string;
}

export function BillingPanel({
  locale,
  canManage,
  stripeConfigured,
  entitlements,
  invoices,
  plans,
}: {
  locale: string;
  canManage: boolean;
  stripeConfigured: boolean;
  entitlements: Ent;
  invoices: Inv[];
  plans: PlanView[];
}) {
  const t = useTranslations("billing");
  const e = entitlements;
  const [showPlans, setShowPlans] = useState(false);

  return (
    <div className="space-y-6">
      {!stripeConfigured && <Alert className="text-sm">{t("stripeNotConfigured")}</Alert>}
      {e.blocked && (
        <Alert variant="destructive" className="text-sm">
          {e.blockReason && t.has(`block.${e.blockReason}`)
            ? t(`block.${e.blockReason}`)
            : t("block.generic")}
        </Alert>
      )}
      {e.inGrace && (
        <Alert variant="destructive" className="text-sm">
          {t("grace")}
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("currentPlan")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("plan")}</span>
            <span className="font-medium">{e.planName ?? t("noPlan")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("status")}</span>
            <span>{t.has(`st.${e.status}`) ? t(`st.${e.status}`) : e.status}</span>
          </div>
          {e.priceCents != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("price")}</span>
              <span>
                {formatMoney(e.priceCents, e.currency, locale)} / {t(`per.${e.interval}`)}
              </span>
            </div>
          )}
          {e.currentPeriodEnd && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {e.status === "TRIALING" ? t("trialEnds") : t("renews")}
              </span>
              <span>{new Date(e.currentPeriodEnd).toLocaleDateString(locale)}</span>
            </div>
          )}
          {e.cancelAtPeriodEnd && <p className="text-xs text-amber-600">{t("cancelScheduled")}</p>}

          {canManage && (
            <div className="flex flex-wrap gap-2 pt-3">
              <form action={openPortalAction}>
                <input type="hidden" name="locale" value={locale} />
                <Button type="submit" variant="outline" size="sm" disabled={!stripeConfigured}>
                  {t("managePortal")}
                </Button>
              </form>
              <Button size="sm" variant="outline" onClick={() => setShowPlans((v) => !v)}>
                {e.planCode ? t("changePlan") : t("choosePlan")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {showPlans && (
        <PricingTable plans={plans} locale={locale} signedIn currentPlanCode={e.planCode} />
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("invoices")}</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noInvoices")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2">
                  <span>
                    {new Date(i.createdAt).toLocaleDateString(locale)} ·{" "}
                    {formatMoney(
                      i.status === "PAID" ? i.amountPaidCents : i.amountDueCents,
                      i.currency,
                      locale,
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {t.has(`inv.${i.status}`) ? t(`inv.${i.status}`) : i.status}
                    {i.hostedUrl && (
                      <a href={i.hostedUrl} target="_blank" rel="noreferrer" className="underline">
                        {t("view")}
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
