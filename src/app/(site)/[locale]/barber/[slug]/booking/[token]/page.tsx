import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getBookingByToken } from "@/features/booking/service";
import { ManageBooking } from "@/features/booking/components/manage-booking";
import { formatMoney } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Booking", robots: { index: false } };

export default async function BookingConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string; token: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { locale, slug, token } = await params;
  const { paid } = await searchParams;
  setRequestLocale(locale);

  const booking = await getBookingByToken(token);
  if (!booking) notFound();

  const t = await getTranslations("booking");
  const df = new Intl.DateTimeFormat(booking.locale || locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: booking.timezone,
  });

  const statusKey = `status.${booking.status}`;
  const isCanceled = booking.status === "CANCELED";

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="container max-w-lg space-y-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isCanceled ? t("confirmTitleCanceled") : t("confirmTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {paid === "1" && !isCanceled && (
              <Alert variant="success" className="text-sm">
                {t("paymentReceived")}
              </Alert>
            )}
            <dl className="space-y-1">
              <Row label={t("shop")} value={booking.tenantName} />
              <Row label={t("serviceLabel")} value={booking.serviceName} />
              <Row label={t("withBarber")} value={booking.employeeName} />
              <Row label={t("when")} value={df.format(new Date(booking.startsAt))} />
              <Row
                label={t("price")}
                value={formatMoney(booking.priceCents, booking.currency, booking.locale || locale)}
              />
              <Row
                label={t("statusLabel")}
                value={t.has(statusKey) ? t(statusKey) : booking.status}
              />
              <Row label={t("paymentLabel")} value={booking.paid ? t("paid") : t("payAtShop")} />
            </dl>

            {!isCanceled && (
              <div className="border-t pt-3">
                <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  {t("manageTitle")}
                </p>
                <ManageBooking
                  token={token}
                  slug={slug}
                  locale={locale}
                  timezone={booking.timezone}
                  serviceId={booking.serviceId}
                  canCancel={booking.canCancel}
                  canReschedule={booking.canReschedule}
                  cutoffHours={booking.cutoffHours}
                />
              </div>
            )}

            {booking.status === "COMPLETED" && (
              <Link
                href={`/${locale}/barber/${slug}/review/${token}`}
                className="inline-block rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                {t("leaveReview")}
              </Link>
            )}

            <Link
              href={`/${locale}/barber/${slug}`}
              className="block text-xs text-muted-foreground underline"
            >
              {t("backToProfile")}
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
