import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { getAppSession } from "@/server/auth/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Placeholder for Slice 2 (tenant creation flow: name → slug → plan → Stripe).
 * A user with no tenant membership lands here after sign-in.
 */
export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.memberships.length > 0) redirect(`/${locale}/dashboard`);

  return (
    <div className="mx-auto max-w-lg py-16">
      <Card>
        <CardHeader>
          <CardTitle>Criar barbearia</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          O fluxo de criação de barbearia + escolha de plano chega na Slice 2. Sua conta (
          {session.email}) já está autenticada e verificada.
        </CardContent>
      </Card>
    </div>
  );
}
