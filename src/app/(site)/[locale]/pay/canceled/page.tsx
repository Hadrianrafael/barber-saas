import { setRequestLocale, getTranslations } from "next-intl/server";

export default async function PayCanceledPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("payResult");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">{t("canceledTitle")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("canceledBody")}</p>
    </div>
  );
}
