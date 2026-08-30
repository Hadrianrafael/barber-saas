import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="container flex items-center justify-between py-4">
        <span className="text-lg font-semibold">{t("common.appName")}</span>
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${locale}/sign-in`}>{t("auth.signInCta")}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/${locale}/sign-up`}>{t("auth.signUpCta")}</Link>
          </Button>
        </div>
      </header>

      <main className="container flex flex-1 flex-col items-center justify-center gap-6 py-24 text-center">
        <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          {t("marketing.heroTitle")}
        </h1>
        <p className="max-w-2xl text-pretty text-lg text-muted-foreground">
          {t("marketing.heroSubtitle")}
        </p>
        <div className="flex gap-3">
          <Button asChild size="lg">
            <Link href={`/${locale}/sign-up`}>{t("marketing.ctaPrimary")}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={`/${locale}/pricing`}>{t("marketing.ctaSecondary")}</Link>
          </Button>
        </div>
      </main>

      <footer className="container py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} {t("common.appName")}
      </footer>
    </div>
  );
}
