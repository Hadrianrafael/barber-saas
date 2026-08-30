import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { getTenantById } from "@/features/tenant/service";
import { getDashboardSummary } from "@/features/dashboard/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);

  const tenant = await getTenantById(active.tenantId);
  if (!tenant) redirect(`/${locale}/onboarding`);

  const t = await getTranslations("dashboard");
  const ta = await getTranslations("agenda");
  const summary = await getDashboardSummary(active.tenantId, tenant.timezone);

  const fmtTime = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tenant.timezone,
  });

  const stats = [
    { label: t("todayAppointments"), value: summary.todaysCount },
    { label: t("workingToday"), value: summary.workingTodayCount },
    { label: t("openSlots"), value: summary.openSlotsEstimate },
    { label: t("cancellations"), value: summary.cancellations },
    { label: t("noShows"), value: summary.noShows },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("welcome", { name: session.name })}</h1>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("upcoming")}</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("nothingToday")}</p>
            ) : (
              <ul className="divide-y">
                {summary.upcoming.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <strong>{fmtTime.format(new Date(a.startsAt))}</strong> · {a.customerName}
                    </span>
                    <span className="text-muted-foreground">
                      {a.serviceName} · {a.employeeName}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("todayAppointments")}</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.todays.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("nothingToday")}</p>
            ) : (
              <ul className="divide-y">
                {summary.todays.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      {fmtTime.format(new Date(a.startsAt))} · {a.customerName}
                    </span>
                    <span className="text-xs text-muted-foreground">{ta(`status${a.status}`)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/${locale}/agenda`} className="mt-3 inline-block text-sm underline">
              {ta("title")}
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
