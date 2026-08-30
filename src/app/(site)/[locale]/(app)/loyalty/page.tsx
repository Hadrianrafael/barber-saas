import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { prisma } from "@/server/db/client";
import { parseLoyaltyConfig } from "@/features/loyalty/config";
import { listRewards } from "@/features/loyalty/service";
import { LoyaltyManager } from "@/features/loyalty/components/loyalty-manager";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function LoyaltyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);
  if (!roleCan(active.role, "loyalty.manage")) redirect(`/${locale}/dashboard`);

  const t = await getTranslations("loyalty");
  const [tenant, rewards, services, recent] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: active.tenantId }, select: { loyaltyConfig: true } }),
    listRewards(active.tenantId),
    prisma.service.findMany({
      where: { tenantId: active.tenantId, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.loyaltyTransaction.findMany({
      where: { tenantId: active.tenantId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { customer: { select: { name: true } } },
    }),
  ]);
  const cfg = parseLoyaltyConfig(tenant?.loyaltyConfig);
  const df = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {!cfg.enabled ? (
        <Alert className="text-sm">
          {t("disabled")}{" "}
          <Link href={`/${locale}/settings`} className="underline">
            {t("goToSettings")}
          </Link>
        </Alert>
      ) : (
        <Alert variant="success" className="text-sm">
          {t("activeSummary", {
            visit: String(cfg.pointsPerVisit),
            value:
              cfg.pointsPerCurrencyCents > 0
                ? t("perValue", { cents: String(cfg.pointsPerCurrencyCents) })
                : "—",
          })}
        </Alert>
      )}

      <LoyaltyManager
        rewards={rewards.map((r) => ({
          id: r.id,
          name: r.name,
          pointsCost: r.pointsCost,
          kind: r.kind,
          isActive: r.isActive,
          percentOff: r.percentOff,
          amountOffCents: r.amountOffCents,
        }))}
        services={services}
      />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t("recent")}</h2>
        <Card>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{t("noActivity")}</p>
            ) : (
              <ul className="divide-y text-sm">
                {recent.map((tx) => (
                  <li key={tx.id} className="flex items-center justify-between p-3">
                    <span>
                      {tx.customer?.name ?? "—"}{" "}
                      <span className="text-xs text-muted-foreground">
                        {t.has(`activity.${tx.reason}`) ? t(`activity.${tx.reason}`) : tx.reason}
                      </span>
                    </span>
                    <span
                      className={`font-medium ${tx.points >= 0 ? "text-emerald-600" : "text-destructive"}`}
                    >
                      {tx.points >= 0 ? "+" : ""}
                      {tx.points}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {df.format(tx.createdAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
