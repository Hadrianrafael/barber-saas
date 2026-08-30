import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession } from "@/server/auth/current-user";
import { prisma } from "@/server/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.memberships.length > 0) redirect(`/${locale}/dashboard`);

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { emailVerifiedAt: true },
  });
  const t = await getTranslations("onboarding");

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {user?.emailVerifiedAt ? (
            <OnboardingWizard suggestedSlug="" />
          ) : (
            <p className="text-sm text-muted-foreground">{t("errors.emailNotVerified")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
