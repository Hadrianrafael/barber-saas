import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { prisma } from "@/server/db/client";
import { CampaignForm } from "@/features/campaigns/components/campaign-form";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);
  if (!roleCan(active.role, "campaign.write")) redirect(`/${locale}/campaigns`);

  const t = await getTranslations("campaigns");
  const [services, employees] = await Promise.all([
    prisma.service.findMany({
      where: { tenantId: active.tenantId, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.employee.findMany({
      where: { tenantId: active.tenantId, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/${locale}/campaigns`} className="text-sm text-muted-foreground underline">
        ← {t("backToList")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("newTitle")}</h1>
      <CampaignForm services={services} employees={employees} />
    </div>
  );
}
