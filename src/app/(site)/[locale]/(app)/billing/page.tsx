import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { isConfigured } from "@/env";
import { getBillingSummary } from "@/features/billing/service";
import { parsePlanLimits } from "@/features/billing/plan-limits";
import { BillingPanel } from "@/features/billing/components/billing-panel";

export const dynamic = "force-dynamic";

export default async function BillingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);

  const t = await getTranslations("billing");
  const canManage = roleCan(active.role, "tenant.billing.manage");
  const { ent, invoices, plans, sub } = await getBillingSummary(active.tenantId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <BillingPanel
        locale={locale}
        canManage={canManage}
        stripeConfigured={isConfigured.stripe}
        entitlements={{
          planCode: ent.planCode,
          planName: ent.planName,
          status: ent.status,
          currentPeriodEnd: ent.currentPeriodEnd ? ent.currentPeriodEnd.toISOString() : null,
          trialEndsAt: ent.trialEndsAt ? ent.trialEndsAt.toISOString() : null,
          cancelAtPeriodEnd: ent.cancelAtPeriodEnd,
          inGrace: ent.inGrace,
          blocked: ent.blocked,
          blockReason: ent.blockReason,
          interval: sub?.interval ?? "month",
          priceCents: sub?.priceCents ?? null,
          currency: sub?.currency ?? "BRL",
        }}
        invoices={invoices.map((i) => ({
          id: i.id,
          status: i.status,
          amountDueCents: i.amountDueCents,
          amountPaidCents: i.amountPaidCents,
          currency: i.currency,
          hostedUrl: i.hostedUrl,
          pdfUrl: i.pdfUrl,
          createdAt: i.createdAt.toISOString(),
        }))}
        plans={plans.map((p) => ({
          code: p.code,
          name: p.name,
          priceCents: p.priceCents,
          priceCentsYearly: p.priceCentsYearly,
          currency: p.currency,
          trialDays: p.trialDays,
          limits: parsePlanLimits(p.limits),
        }))}
      />
    </div>
  );
}
