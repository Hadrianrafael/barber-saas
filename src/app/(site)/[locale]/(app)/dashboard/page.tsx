import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession } from "@/server/auth/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.memberships.length === 0) redirect(`/${locale}/onboarding`);

  const t = await getTranslations("dashboard");

  const cards = [
    { title: t("todayAppointments"), value: "—" },
    { title: t("revenue"), value: "—" },
    { title: t("clients"), value: "—" },
    { title: t("team"), value: "—" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("welcome", { name: session.name })}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t("noData")}</p>
    </div>
  );
}
