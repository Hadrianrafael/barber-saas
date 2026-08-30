import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getBookingContext } from "@/features/booking/service";
import { BookingFlow } from "@/features/booking/components/booking-flow";
import { Alert } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const ctx = await getBookingContext(slug);
  return { title: ctx ? `${ctx.tenant.name}` : "Booking", robots: { index: false } };
}

export default async function BookPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const ctx = await getBookingContext(slug);
  if (!ctx) notFound();

  const t = await getTranslations("booking");

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="container max-w-2xl space-y-6 py-10">
        <div className="flex items-center gap-3">
          {ctx.tenant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ctx.tenant.logoUrl}
              alt={ctx.tenant.name}
              className="h-12 w-12 rounded-lg border bg-background object-contain p-1"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border bg-background font-bold">
              {ctx.tenant.name.charAt(0)}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold">{ctx.tenant.name}</h1>
            <Link
              href={`/${locale}/barber/${slug}`}
              className="text-xs text-muted-foreground underline"
            >
              {t("backToProfile")}
            </Link>
          </div>
        </div>

        {!ctx.onlineBookingEnabled ? (
          <Alert className="text-sm">{t("onlineBookingOff")}</Alert>
        ) : (
          <BookingFlow
            slug={slug}
            locale={locale}
            timezone={ctx.tenant.timezone}
            services={ctx.services}
            employees={ctx.employees}
            requireEmployeeSelection={ctx.config.requireEmployeeSelection}
            paymentEnabled={ctx.paymentEnabled}
            maxAdvanceDays={ctx.config.maxAdvanceDays}
            minLeadTimeMin={ctx.config.minLeadTimeMin}
          />
        )}
      </div>
    </div>
  );
}
