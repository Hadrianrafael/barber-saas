import { setRequestLocale, getTranslations } from "next-intl/server";
import { listPublicPlans } from "@/features/billing/service";
import { parsePlanLimits } from "@/features/billing/plan-limits";
import { PricingTable } from "@/features/billing/components/pricing-table";

export const dynamic = "force-dynamic";

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pricing");
  const plans = await listPublicPlans();

  return (
    <div className="container py-16">
      <h1 className="text-center text-3xl font-bold">{t("title")}</h1>
      <p className="mb-10 text-center text-sm text-muted-foreground">{t("subtitle")}</p>
      <PricingTable
        locale={locale}
        signedIn={false}
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
