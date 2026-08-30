import { setRequestLocale, getTranslations } from "next-intl/server";

export default async function PaySuccessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("payResult");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-4xl">✓</p>
      <h1 className="text-xl font-semibold">{t("successTitle")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("successBody")}</p>
    </div>
  );
}
