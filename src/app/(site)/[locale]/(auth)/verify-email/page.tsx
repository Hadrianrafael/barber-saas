import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyEmailClient } from "@/features/auth/components/verify-email-client";

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("auth");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("verifyTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <VerifyEmailClient token={token} />
      </CardContent>
    </Card>
  );
}
