import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getReviewContext } from "@/features/reviews/service";
import { ReviewForm } from "@/features/reviews/components/review-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review", robots: { index: false } };

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const ctx = await getReviewContext(token);
  if (!ctx) notFound();

  const t = await getTranslations("reviews");
  const df = new Intl.DateTimeFormat(ctx.locale || locale, { dateStyle: "long" });

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="container max-w-lg space-y-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("publicTitle", { shop: ctx.tenantName })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {ctx.serviceName} · {ctx.barberName} · {df.format(new Date(ctx.startsAt))}
            </p>

            {ctx.alreadyReviewed ? (
              <Alert variant="success" className="text-sm">
                {t("alreadyReviewed", { rating: String(ctx.submittedRating ?? "") })}
              </Alert>
            ) : !ctx.eligible ? (
              <Alert className="text-sm">{t("notEligible")}</Alert>
            ) : (
              <ReviewForm token={token} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
