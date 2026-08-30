import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetForm } from "@/features/auth/components/reset-form";

export default async function ResetPasswordPage({
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
        <CardTitle>{t("resetTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {token ? <ResetForm token={token} /> : <ClientlessError message={t("verifyInvalid")} />}
      </CardContent>
    </Card>
  );
}

function ClientlessError({ message }: { message: string }) {
  return <p className="text-sm text-destructive">{message}</p>;
}
