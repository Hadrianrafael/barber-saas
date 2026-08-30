import Link from "next/link";
import { setRequestLocale } from "next-intl/server";
import { prisma } from "@/server/db/client";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Plans come from the DB; don't attempt to prerender at build time.
export const dynamic = "force-dynamic";

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const plans = await prisma.plan.findMany({
    where: { isPublic: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="container py-16">
      <h1 className="mb-10 text-center text-3xl font-bold">Planos</h1>
      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle>{p.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-3xl font-bold">
                {formatMoney(p.priceCents, p.currency, locale)}
                <span className="text-base font-normal text-muted-foreground">/mês</span>
              </div>
              <Button asChild className="w-full">
                <Link href={`/${locale}/sign-up?plan=${p.code}`}>Começar</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
        {plans.length === 0 && (
          <p className="text-muted-foreground">
            Nenhum plano publicado. Rode <code>npm run db:seed</code>.
          </p>
        )}
      </div>
      <p className="mt-10 text-center text-sm text-muted-foreground">
        Checkout via Stripe chega na Slice 5.
      </p>
    </div>
  );
}
