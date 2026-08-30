import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession } from "@/server/auth/current-user";
import { prisma } from "@/server/db/client";
import { isConfigured } from "@/env";
import { PlanPicker } from "@/features/onboarding/components/plan-picker";

export const dynamic = "force-dynamic";

export default async function OnboardingPlanPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.memberships.length === 0) redirect(`/${locale}/onboarding`);

  const t = await getTranslations("plan");
  const plans = await prisma.plan.findMany({
    where: { isPublic: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="mx-auto max-w-4xl py-10">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mb-8 text-sm text-muted-foreground">{t("subtitle")}</p>
      <PlanPicker
        stripeConfigured={isConfigured.stripe}
        plans={plans.map((p) => ({
          code: p.code,
          name: p.name,
          priceCents: p.priceCents,
          currency: p.currency,
          interval: p.interval,
          trialDays: p.trialDays,
          limits: (p.limits ?? {}) as Record<string, unknown>,
        }))}
      />
    </div>
  );
}
